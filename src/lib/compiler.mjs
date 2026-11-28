/**
 *	@Project: @cldmv/digby-ext-zones
 *	@Filename: /src/lib/compiler.mjs
 *	@Date: 2026-11-22T09:39:54-08:00
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-22T09:39:54-08:00
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview The zone compiler: zone + rrset values (the shapes of CLDMV/digby#14, already parsed by the reader) into an
 * immutable per-view snapshot shaped for authoritative lookup. Pure: no I/O, no rummage calls, no filesystem — values in,
 * frozen value out, one {@link ZoneError} refusal per invalid input.
 *
 * The exact snapshot shape, the refusal rules, the override precedence and the serial policies are documented in
 * `docs/snapshot.md`; that document and this file are meant to be read together.
 */

import { TYPE, formatName, parseName } from "./codec.mjs";
import { ZoneError, ZoneErrorCode, refuse } from "./errors.mjs";

/** The rrset source values (#14). `manual` outranks the others inside one view. */
export const SOURCES = Object.freeze(["manual", "machines", "transfer", "acme"]);

/** The zone kinds (#14). */
export const ZONE_KINDS = Object.freeze(["primary", "secondary", "forward", "stub"]);

/** The serial policies. */
export const SERIAL_POLICIES = Object.freeze(["date", "increment"]);

/** The single view key of a zone with no `views[]` (every rrset is view-null there). */
export const IMPLICIT_VIEW = "all";

/** The ttl used when an rrset has none and the zone has no `defaultTtl`. */
export const DEFAULT_TTL = 3600;

/**
 * The glue address types: A/AAAA at a delegation name. Read from the seam PER CALL — the seam's surface may not be
 * captured when this module loads (nothing may read it at module-eval time).
 * @returns {number[]}
 */
function glueTypes() {
	return [TYPE.A, TYPE.AAAA];
}

/**
 * Compile one zone into its frozen, per-view snapshot.
 *
 * @param {object} zone - the zone value (#14): `name`, `kind`, `views[]`, `soa`, `serialPolicy`, `defaultTtl`, `disabled`, ...
 * @param {object[]} rrsets - the rrset values belonging to this zone (#14)
 * @param {object|null} [previous] - the previous snapshot for this zone, or null on first compile
 * @param {{ now?: Date|number }} [options] - `now` pins the clock for the `date` serial policy (tests); default the real clock
 * @returns {object} the frozen snapshot (shape in docs/snapshot.md)
 * @throws {import("./errors.mjs").ZoneError} on any refused input (codes in {@link ZoneErrorCode})
 */
export function compileZone(zone, rrsets, previous, options = {}) {
	const now = options.now instanceof Date ? options.now : typeof options.now === "number" ? new Date(options.now) : new Date();
	validateZone(zone);

	if (zone.disabled) return disabledSnapshot(zone, previous, now);

	if (!zone.soa || typeof zone.soa !== "object") {
		refuse(ZoneErrorCode.APEX_SOA_REQUIRED, `zone "${zone.name}" carries no soa rdata`, { zone: zone.name });
	}

	const zoneLabels = parseOwner(zone.name, { zone: zone.name });
	const zoneKey = foldKey(zone.name);
	const hasViews = Array.isArray(zone.views) && zone.views.length > 0;
	const viewNames = hasViews ? [...zone.views].sort() : [IMPLICIT_VIEW];

	const rrsetList = Array.isArray(rrsets) ? rrsets : [];
	for (let i = 0; i < rrsetList.length; i++) validateRrset(zone, zoneLabels, zoneKey, hasViews, viewNames, rrsetList[i], i);

	// The synthesized apex SOA, one frozen object shared by every view (the zone value owns the SOA; an rrset never carries
	// one — SOA-typed rrsets on input are ignored).
	const soa = { ttl: ttlOf(zone), records: [zone.soa], source: "manual", comment: null };

	const views = {};
	for (const view of viewNames) views[view] = compileView(zone, zoneKey, view, rrsetList, soa);

	const serial = nextSerial(zone, views, previous, now);

	return deepFreeze({
		zone: zone.name,
		kind: zone.kind,
		disabled: false,
		serial,
		defaultTtl: ttlOf(zone),
		soa,
		views
	});
}

/** @param {object} zone @returns {number} */
function ttlOf(zone) {
	return zone.defaultTtl ?? DEFAULT_TTL;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate the zone value itself. Runs even for a disabled zone (a malformed zone is malformed either way).
 * @param {object} zone
 */
function validateZone(zone) {
	if (!zone || typeof zone !== "object") refuse(ZoneErrorCode.BAD_ZONE, "a zone must be an object");
	if (typeof zone.name !== "string" || zone.name.length === 0) refuse(ZoneErrorCode.BAD_ZONE, "a zone needs a name", { zone: String(zone.name) });
	try {
		parseName(zone.name);
	} catch (err) {
		// A ZoneError escaping the seam is this package's own wiring refusal (e.g. WIRE_NOT_READY) — never a
		// name-parse failure; only a wire failure gets mapped, with the original as cause.
		if (err instanceof ZoneError) throw err;
		refuse(ZoneErrorCode.BAD_ZONE, `zone name "${zone.name}" does not parse as an absolute name`, { zone: zone.name, cause: err });
	}
	if (!ZONE_KINDS.includes(zone.kind)) refuse(ZoneErrorCode.BAD_ZONE, `zone kind ${JSON.stringify(zone.kind)} is not one of ${ZONE_KINDS.join(", ")}`, { zone: zone.name });
	if (zone.views !== undefined && zone.views !== null) {
		if (!Array.isArray(zone.views)) refuse(ZoneErrorCode.BAD_ZONE, "zone.views must be an array of view names", { zone: zone.name });
		const seen = new Set();
		for (const v of zone.views) {
			if (typeof v !== "string" || v.length === 0) refuse(ZoneErrorCode.BAD_ZONE, "every view name must be a non-empty string", { zone: zone.name });
			if (seen.has(v)) refuse(ZoneErrorCode.BAD_ZONE, `duplicate view "${v}"`, { zone: zone.name });
			seen.add(v);
		}
	}
	if (zone.defaultTtl !== undefined && zone.defaultTtl !== null && !isTtl(zone.defaultTtl)) {
		refuse(ZoneErrorCode.BAD_ZONE, `zone.defaultTtl ${JSON.stringify(zone.defaultTtl)} is not a non-negative integer`, { zone: zone.name });
	}
	if (zone.serialPolicy !== undefined && zone.serialPolicy !== null && !SERIAL_POLICIES.includes(zone.serialPolicy)) {
		refuse(ZoneErrorCode.BAD_SERIAL_POLICY, `serialPolicy ${JSON.stringify(zone.serialPolicy)} is not one of ${SERIAL_POLICIES.join(", ")}`, { zone: zone.name });
	}
}

/**
 * Validate one rrset against its zone: owner inside the zone, wildcard placement, ttl, view tag, source, records.
 * @param {object} zone
 * @param {Uint8Array[]} zoneLabels
 * @param {string} zoneKey
 * @param {boolean} hasViews
 * @param {string[]} viewNames
 * @param {object} rr
 * @param {number} index
 */
function validateRrset(zone, zoneLabels, zoneKey, hasViews, viewNames, rr, index) {
	const ctx = { zone: zone.name, view: rr?.view ?? null };
	if (!rr || typeof rr !== "object") refuse(ZoneErrorCode.BAD_RECORD, `rrset #${index} is not an object`, ctx);
	if (typeof rr.name !== "string" || rr.name.length === 0) refuse(ZoneErrorCode.BAD_OWNER, `rrset #${index} has no name`, ctx);
	const labels = parseOwner(rr.name, ctx);
	ctx.owner = rr.name;
	ctx.type = rr.type;
	if (!insideZone(labels, zoneLabels)) refuse(ZoneErrorCode.BAD_OWNER, `"${rr.name}" is not inside zone "${zone.name}"`, ctx);
	if (rr.zone !== undefined && rr.zone !== null) {
		try {
			if (foldKey(rr.zone) !== zoneKey) {
				refuse(ZoneErrorCode.BAD_OWNER, `rrset for "${rr.name}" claims zone ${JSON.stringify(rr.zone)}, not "${zone.name}"`, ctx);
			}
		} catch (err) {
			// A zone claim that does not parse is a caller shape error, mapped like every other owner-side refusal —
			// the wire failure underneath as cause; a raw WireError never escapes the compiler (errors.mjs's contract).
			if (err instanceof ZoneError) throw err;
			refuse(ZoneErrorCode.BAD_OWNER, `rrset for "${rr.name}" claims zone ${JSON.stringify(rr.zone)}, which does not parse as an absolute name`, { ...ctx, cause: err });
		}
	}
	checkWildcard(labels, rr.name, ctx);
	if (!Number.isInteger(rr.type) || rr.type < 0 || rr.type > 0xffff) {
		refuse(ZoneErrorCode.BAD_RECORD, `rrset for "${rr.name}" has type ${JSON.stringify(rr.type)}, which is not a type number (0-65535)`, ctx);
	}
	if (rr.view !== undefined && rr.view !== null) {
		if (!hasViews) refuse(ZoneErrorCode.BAD_VIEW, `rrset for "${rr.name}" is tagged view "${rr.view}" but the zone has no views`, ctx);
		if (!viewNames.includes(rr.view)) refuse(ZoneErrorCode.BAD_VIEW, `rrset for "${rr.name}" is tagged view "${rr.view}", which the zone does not list`, ctx);
	}
	if (!isTtl(rr.ttl)) refuse(ZoneErrorCode.BAD_TTL, `rrset for "${rr.name}" (${rr.type}) has ttl ${JSON.stringify(rr.ttl)}`, ctx);
	if (!Array.isArray(rr.records) || rr.records.length === 0) refuse(ZoneErrorCode.BAD_RECORD, `rrset for "${rr.name}" (${rr.type}) carries no records`, ctx);
	const source = rr.source ?? "manual";
	if (!SOURCES.includes(source)) refuse(ZoneErrorCode.BAD_SOURCE, `rrset for "${rr.name}" (${rr.type}) has source ${JSON.stringify(source)}`, ctx);
}

/**
 * Parse an owner name into labels, mapping a codec parse failure to {@link ZoneErrorCode.BAD_OWNER}.
 * @param {string} name
 * @param {{ zone: string, view: string|null }} ctx
 * @returns {Uint8Array[]}
 */
function parseOwner(name, ctx) {
	try {
		return parseName(name);
	} catch (err) {
		// Same rule as validateZone: a ZoneError from the seam is a wiring refusal, not a parse failure.
		if (err instanceof ZoneError) throw err;
		return refuse(ZoneErrorCode.BAD_OWNER, `"${name}" does not parse as an absolute name`, { ...ctx, cause: err });
	}
}

/** @param {unknown} ttl @returns {boolean} */
function isTtl(ttl) {
	return ttl === undefined || ttl === null || (typeof ttl === "number" && Number.isInteger(ttl) && ttl >= 0);
}

/**
 * The wildcard rule: a `*` may appear only as the sole character of the owner's FIRST label (a normal `*.example.` style
 * wildcard one or more labels below the apex); a `*` in any other label, or inside a label (`ab*d`), is refused. The apex
 * itself can never carry the `*` (it is a different name), so no separate apex check is needed. Escapes do NOT exempt a
 * star: the parser decodes presentation escapes before labels reach this check, so `\*` and `\052` arrive as the byte
 * 0x2a like any other star — inside a label it is refused, and as the sole character of the first label it IS the wildcard.
 * @param {Uint8Array[]} labels
 * @param {string} name - for the message only
 * @param {{ zone: string, view: string|null }} ctx
 */
function checkWildcard(labels, name, ctx) {
	for (let i = 0; i < labels.length; i++) {
		let stars = 0;
		for (const byte of labels[i]) if (byte === 0x2a) stars++;
		if (stars === 0) continue;
		if (i === 0 && labels[i].length === 1) continue;
		refuse(ZoneErrorCode.BAD_WILDCARD, `"${name}" places a \`*\` outside the owner's first label`, ctx);
	}
}

/**
 * Is `labels` the zone itself or strictly inside it? Case-insensitive per label (the DNS way).
 * @param {Uint8Array[]} labels
 * @param {Uint8Array[]} zoneLabels
 * @returns {boolean}
 */
function insideZone(labels, zoneLabels) {
	if (labels.length < zoneLabels.length) return false;
	for (let i = 0; i < zoneLabels.length; i++) {
		if (!labelEquals(labels[labels.length - zoneLabels.length + i], zoneLabels[i])) return false;
	}
	return true;
}

/** @param {Uint8Array} a @param {Uint8Array} b @returns {boolean} ASCII case-insensitive label equality */
function labelEquals(a, b) {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		const x = a[i], y = b[i];
		if (x !== y && fold(x) !== fold(y)) return false;
	}
	return true;
}

/** @param {number} c @returns {number} */
function fold(c) {
	return c >= 0x41 && c <= 0x5a ? c + 0x20 : c;
}

// ---------------------------------------------------------------------------
// Per-view compilation
// ---------------------------------------------------------------------------

/**
 * Compile one view: expand the null-view rrsets into it, apply the override precedence, merge, check the CNAME rules,
 * mark delegations, glue and empty non-terminals.
 * @param {object} zone
 * @param {string} zoneKey
 * @param {string} view
 * @param {object[]} rrsetList
 * @param {object} soa - the synthesized apex SOA (shared frozen object, placed on the apex node of every view)
 * @returns {{ nodes: object }}
 */
function compileView(zone, zoneKey, view, rrsetList, soa) {
	// 1. Group every rrset visible in this view (its own tag, or null = all views) by name+type.
	const groups = new Map();
	for (const rr of rrsetList) {
		if (rr.type === TYPE.SOA) continue; // the SOA lives on the zone value; an rrset cannot override it
		if (rr.view !== view && rr.view !== null && rr.view !== undefined) continue;
		const gk = foldKey(rr.name) + "\u0000" + rr.type;
		let group = groups.get(gk);
		if (!group) groups.set(gk, (group = { name: foldKey(rr.name), type: rr.type, entries: [] }));
		group.entries.push(rr);
	}

	// 2. Override precedence: within one group, a manual entry drops the sourced entries carrying the SAME view tag (the
	//    tag exactly — null included). So a manual rrset tagged view V overrides a sourced rrset tagged view V for the
	//    same name+type; a manual record tagged view A does NOT override a sourced record tagged view B, nor a sourced
	//    record tagged null (that one serves every view, and the manual one was scoped to A alone). On a viewless zone
	//    every tag is null, so a manual record overrides the sourced record it shares the name+type with.
	for (const group of groups.values()) {
		const tags = new Set(group.entries.map((e) => e.view ?? null));
		for (const tag of tags) {
			const hasManual = group.entries.some((e) => (e.source ?? "manual") === "manual" && (e.view ?? null) === tag);
			if (hasManual) group.entries = group.entries.filter((e) => (e.source ?? "manual") === "manual" || (e.view ?? null) !== tag);
		}
	}

	// 3. Merge the surviving entries of each group into one snapshot rrset.
	const nodes = { [zoneKey]: { ent: false, delegation: false, glue: false, rrsets: { [TYPE.SOA]: soa } } };
	for (const group of groups.values()) {
		let node = nodes[group.name];
		if (!node) nodes[group.name] = node = { ent: false, delegation: false, glue: false, rrsets: {} };
		const manual = group.entries.filter((e) => (e.source ?? "manual") === "manual");
		const records = group.entries.flatMap((e) => e.records);
		const withTtl = group.entries.find((e) => typeof e.ttl === "number");
		node.rrsets[group.type] = {
			ttl: withTtl ? withTtl.ttl : ttlOf(zone),
			records,
			source: manual.length > 0 ? "manual" : group.entries[0].source ?? "manual",
			comment: group.entries.map((e) => e.comment ?? null).find((c) => c !== null) ?? null
		};
	}

	// 4. CNAME rules, per view, on the merged data.
	for (const [key, node] of Object.entries(nodes)) {
		const cname = node.rrsets[TYPE.CNAME];
		if (!cname) continue;
		if (key === zoneKey) refuse(ZoneErrorCode.CNAME_AT_APEX, "a CNAME at the zone apex", { zone: zone.name, view, type: TYPE.CNAME, owner: key });
		if (cname.records.length > 1) refuse(ZoneErrorCode.CNAME_MULTIPLE, `"${key}" carries ${cname.records.length} CNAME records in view "${view}"`, { zone: zone.name, view, type: TYPE.CNAME, owner: key });
		if (Object.keys(node.rrsets).length > 1) refuse(ZoneErrorCode.CNAME_COEXISTENCE, `"${key}" has a CNAME beside other data in view "${view}"`, { zone: zone.name, view, type: TYPE.CNAME, owner: key });
	}

	// 5. Zone cuts: a non-apex name with an NS rrset. Its A/AAAA are glue; everything strictly below a cut is glue-only.
	const cutKeys = [];
	for (const [key, node] of Object.entries(nodes)) {
		if (key !== zoneKey && node.rrsets[TYPE.NS]) {
			node.delegation = true;
			cutKeys.push(key);
		}
	}
	for (const [key, node] of Object.entries(nodes)) {
		if (cutKeys.some((cut) => key !== cut && below(key, cut))) node.glue = true;
		if (!node.delegation) continue;
		for (const type of glueTypes()) if (node.rrsets[type]) node.rrsets[type].glue = true;
	}

	// 6. The apex needs its NS (the SOA is already in place from the zone value).
	if (!nodes[zoneKey].rrsets[TYPE.NS]) {
		refuse(ZoneErrorCode.APEX_NS_REQUIRED, `zone "${zone.name}" has no NS rrset at its apex`, { zone: zone.name, view, type: TYPE.NS });
	}

	// 7. Empty non-terminals: a name with no records of its own but with descendants that have them EXISTS (the server
	//    answers empty NOERROR there). Added for every ancestor of a record-owning name, up to but excluding the apex —
	//    and never at or below a zone cut, where the child zone owns the name space.
	const recordKeys = Object.keys(nodes).filter((k) => k !== zoneKey && Object.keys(nodes[k].rrsets).length > 0);
	for (const key of recordKeys) {
		for (let parent = parentOf(key); parent && parent !== zoneKey; parent = parentOf(parent)) {
			if (nodes[parent]) continue;
			if (cutKeys.some((cut) => parent === cut || below(parent, cut))) continue;
			nodes[parent] = { ent: true, delegation: false, glue: false, rrsets: {} };
		}
	}

	return { nodes: deepFreeze(nodes) };
}

/**
 * The snapshot's node key for a name: the codec's canonical form (escape-normalized, absolute) with ASCII case folded.
 * For ordinary names that is simply the lowercase absolute name — `formatName` only ever emits `\DDD`-style escapes, so
 * lowercasing the whole string folds exactly the letters.
 * @param {string} name
 * @returns {string}
 */
function foldKey(name) {
	return formatName(parseName(name)).toLowerCase();
}

/**
 * Is `key` strictly below `cut`? Both are dotted absolute keys in the codec's canonical folded form, so the test is a
 * LABEL-SEQUENCE suffix match — only the unescaped dots separate labels, because `\.` inside a label is label content
 * (`a\.b.example.` is NOT below the cut `b.example.`, though the raw string ends with ".b.example."). A root cut `.`
 * matches everything, which is correct — everything is below the root.
 * @param {string} key
 * @param {string} cut
 * @returns {boolean}
 */
export function below(key, cut) {
	if (cut === ".") return key !== ".";
	const cutLabels = splitLabels(cut);
	const keyLabels = splitLabels(key);
	if (keyLabels.length <= cutLabels.length) return false;
	return cutLabels.every((label, i) => keyLabels[keyLabels.length - cutLabels.length + i] === label);
}

/**
 * Split a canonical dotted key into its labels. The trailing dot TERMINATES the last label — an absolute name's labels
 * never end in an empty string, and the root key's single label is the empty string. Only unescaped dots separate
 * labels; a `\X` escape (a literal dot in a label among them) is label content.
 * @param {string} key
 * @returns {string[]}
 */
function splitLabels(key) {
	const labels = [];
	let label = "";
	for (let i = 0; i < key.length; i++) {
		const ch = key[i];
		if (ch === "\\") {
			label += ch + (key[i + 1] ?? "");
			i++;
		} else if (ch === ".") {
			labels.push(label);
			label = "";
		} else label += ch;
	}
	return labels;
}

/**
 * The parent of a dotted key (drop the first label). The root returns "". Label boundaries are the unescaped dots —
 * escaped dots (`\.`) are label content, not separators.
 * @param {string} key
 * @returns {string}
 */
function parentOf(key) {
	const labels = splitLabels(key);
	if (labels.length <= 1) return "";
	return labels.slice(1).join(".") + "."; // re-terminate: the absolute form keeps its trailing dot
}

// ---------------------------------------------------------------------------
// Serial
// ---------------------------------------------------------------------------

/**
 * The new serial. The zone has one serial (its SOA's); it bumps only when some view's CONTENT changed — content being the
 * set of (name, type, ttl, records) tuples, comments excluded. Unchanged content keeps the previous serial exactly.
 * @param {object} zone
 * @param {object} views - the freshly compiled views
 * @param {object|null} previous
 * @param {Date} now
 * @returns {number}
 */
function nextSerial(zone, views, previous, now) {
	const prev = previous && typeof previous.serial === "number" ? previous.serial : null;
	if (!contentChanged(views, previous) && prev !== null) return prev;

	const policy = zone.serialPolicy ?? "date";
	// +1 in the 32-bit space: at the top of the range the increment wraps to 0 — the RFC 1982 rollover, not a regression.
	if (policy === "increment") return wrapSerial((prev ?? 0) + 1);

	// date: YYYYMMDDNN (RFC 1912). Same calendar day as the previous serial -> NN+1; NN saturating at 99 rolls to the
	// next day at 01. Anything else starts the day at 01. Monotonic guard last: a candidate at or below the previous
	// serial (a clock stepped back, or an increment-era serial larger than today's date form) becomes prev + 1. The
	// serial is a 32-bit space (RFC 1982), so every path wraps through wrapSerial — a serial past 2^32-1 rolls to 0 and
	// is never emitted past the space.
	const day = now.getUTCFullYear() * 10000 + (now.getUTCMonth() + 1) * 100 + now.getUTCDate();
	let candidate;
	if (prev !== null && Math.floor(prev / 100) === day) {
		candidate = prev % 100 >= 99 ? dayAfter(now) * 100 + 1 : prev + 1;
	} else {
		candidate = day * 100 + 1;
	}
	if (prev !== null && candidate <= prev) candidate = prev + 1;
	return wrapSerial(candidate);
}

/**
 * Wrap a candidate serial into the 32-bit space the DNS protocol carries (RFC 1982 serial arithmetic): a serial past
 * 2^32-1 rolls to 0. The single place the wrap applies — the increment path and the date path's day and monotonic
 * guard all produce plain candidates, and this closes each of them into [0, 2^32-1].
 * @param {number} candidate
 * @returns {number} the serial, in [0, 2^32-1]
 */
function wrapSerial(candidate) {
	return ((candidate % 0x100000000) + 0x100000000) % 0x100000000;
}

/**
 * The calendar day after `now`, as YYYYMMDD.
 * @param {Date} now
 * @returns {number}
 */
function dayAfter(now) {
	const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
	return t.getUTCFullYear() * 10000 + (t.getUTCMonth() + 1) * 100 + t.getUTCDate();
}

/**
 * Did any view's content change against the previous snapshot? A view added or removed counts as a change.
 * @param {object} views
 * @param {object|null} previous
 * @returns {boolean}
 */
function contentChanged(views, previous) {
	const prevViews = previous && typeof previous === "object" ? previous.views ?? {} : {};
	const now = Object.keys(views);
	const before = Object.keys(prevViews);
	if (now.length !== before.length || now.some((v) => !(v in prevViews))) return true;
	for (const v of now) {
		if (viewFingerprint(views[v].nodes) !== viewFingerprint(prevViews[v]?.nodes ?? {})) return true;
	}
	return false;
}

/**
 * The content fingerprint of one compiled view: every non-ENT node, every type, as `name|type|ttl|records`, names and
 * types sorted. Comments and the derived markers (delegation/glue/ENT) are excluded — the markers derive from the records.
 * @param {object} nodes
 * @returns {string}
 */
function viewFingerprint(nodes) {
	const lines = [];
	for (const key of Object.keys(nodes).sort()) {
		const node = nodes[key];
		if (node.ent && Object.keys(node.rrsets).length === 0) continue;
		for (const type of Object.keys(node.rrsets).sort()) {
			const rrset = node.rrsets[type];
			lines.push(`${key}|${type}|${rrset.ttl}|${canon(rrset.records)}`);
		}
	}
	return lines.join("\n");
}

/**
 * A canonical string for a parsed rdata value (or any JSON-ish value), with object keys sorted so equal values compare
 * equal regardless of property order. Uint8Array values (the codec uses them for TXT character-strings and the like)
 * serialize as their byte sequence.
 * @param {unknown} v
 * @returns {string}
 */
function canon(v) {
	if (v === null) return "n";
	if (typeof v === "number") return `${Number.isInteger(v) ? "i" : "f"}${v}`;
	if (typeof v === "boolean") return v ? "b1" : "b0";
	if (typeof v === "string") return `s${JSON.stringify(v)}`;
	if (v instanceof Uint8Array) return `u${Array.from(v).join(",")}`;
	if (Array.isArray(v)) return `a[${v.map(canon).join("|")}]`;
	if (typeof v === "object") {
		const keys = Object.keys(v).sort();
		return `o{${keys.map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;
	}
	return `?${String(v)}`;
}

// ---------------------------------------------------------------------------
// Disabled zones and freezing
// ---------------------------------------------------------------------------

/**
 * A disabled zone compiles to a snapshot marked `disabled: true` with NO content (`views: {}`): the server consumes it
 * through `self.server.snapshot.set` and serves nothing from it. The zone value itself is still validated; the rrsets are
 * not inspected and the content rules (apex SOA+NS, CNAME rules) are not applied — a zone may be disabled while
 * half-built. The serial stands still at the previous one, or at the policy's base for a first compile.
 * @param {object} zone
 * @param {object|null} previous
 * @param {Date} now
 * @returns {object}
 */
function disabledSnapshot(zone, previous, now) {
	const prev = previous && typeof previous.serial === "number" ? previous.serial : null;
	const serial = prev ?? baseSerial(zone.serialPolicy ?? "date", now);
	return deepFreeze({
		zone: zone.name,
		kind: zone.kind,
		disabled: true,
		serial,
		defaultTtl: ttlOf(zone),
		soa: null,
		views: {}
	});
}

/**
 * The base serial of a policy with no previous snapshot: `date` starts the day at 01, `increment` at 1.
 * @param {string} policy
 * @param {Date} now
 * @returns {number}
 */
function baseSerial(policy, now) {
	if (policy === "increment") return 1;
	const day = now.getUTCFullYear() * 10000 + (now.getUTCMonth() + 1) * 100 + now.getUTCDate();
	return day * 100 + 1;
}

/**
 * Freeze a value deeply (plain objects and arrays). An ArrayBuffer view (a Uint8Array rdata value, most often) is
 * SKIPPED, not frozen: `Object.freeze` on a typed array with elements throws ("Cannot freeze array buffer views with
 * elements"), so freezing one would refuse every zone carrying TXT, DS, SSHFP or generic `\#` rdata. The bytes stay
 * unfrozen and read-only by convention — noted in docs/snapshot.md.
 * @template T
 * @param {T} v
 * @returns {T}
 */
export function deepFreeze(v) {
	if (v !== null && typeof v === "object" && !ArrayBuffer.isView(v)) {
		for (const k of Object.keys(v)) deepFreeze(v[k]);
		Object.freeze(v);
	}
	return v;
}
