/**
 *	@Project: @cldmv/digby-ext-zones
 *	@Filename: /src/lib/export.mjs
 *	@Date: 2026-11-22T10:20:00-08:00 (1795370400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-22T10:20:00-08:00
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview The master-file exporter: zone + rrset values and compiled snapshots back to RFC 1035 master-file text
 * that the reader parses back. Pure — no I/O, no rummage calls. The minimal-faithful forms, the round-trip contract and
 * what deliberately does not round-trip through text are documented in `docs/export.md`; that document and this file are
 * meant to be read together.
 *
 * Every rdata value is rendered by the codec's `formatRdata`, which validates by encoding and re-decoding before
 * formatting (CLDMV/digby#37). A wire failure — a name that does not parse, rdata the formatter refuses — is wrapped in
 * the exporter's own `ZoneError` with the wire failure underneath as `cause`: the package's error contract (errors.mjs)
 * holds everywhere, and the seam's `isWireError` predicate is how the wire failure is recognized (the wire's error class
 * is not a leaf). Refusals that are the exporter's own judgment (a view tag, no SOA, a bad type number) are `ZoneError`s
 * with the compiler's codes.
 */

import { TYPE, formatName, formatRdata, isWireError, parseName, typeToString } from "./codec.mjs";
import { ZoneErrorCode, refuse } from "./errors.mjs";

/**
 * Export a zone value and its rrset values as one master file.
 *
 * Emission (see docs/export.md for the reasoning): `$ORIGIN <zone name>` once, then `$TTL <defaultTtl>` only when the
 * zone's `defaultTtl` is a number that differs from the SOA's `minimum` (when they are equal the reader derives the same
 * default from the minimum, so the directive would be redundant). The SOA renders first as `@ <defaultTtl> SOA <rdata>` —
 * an explicit TTL, because a TTL-less record is only legal after a `$TTL` and the directive is not always emitted; the
 * reader discards the SOA record's own TTL, so the choice cannot affect the round-trip. Then one line per record of each
 * rrset, in the rrsets' given order: owner, TTL token (omitted when the rrset's ttl equals the zone default or is
 * null/undefined), type mnemonic, rdata. An rrset `comment` becomes a trailing `; comment` on the record line that opens
 * the group.
 *
 * @param {object} zone - the zone value; `name` must be absolute, `soa` must carry the SOA rdata
 * @param {object[]} [rrsets] - the zone's rrset values (view-null; a view tag is refused — per-view text is exportSnapshot's job)
 * @returns {string} the master file, with a trailing newline
 * @throws {import("./errors.mjs").ZoneError} BAD_ZONE / APEX_SOA_REQUIRED / BAD_VIEW / BAD_RECORD / BAD_TTL for the
 *   exporter's own refusals; a wire failure underneath (an unparseable zone or owner name, rdata the formatter refuses)
 *   arrives as `cause`
 */
export function exportZone(zone, rrsets) {
	if (!zone || typeof zone !== "object") refuse(ZoneErrorCode.BAD_ZONE, "a zone must be an object");
	if (typeof zone.name !== "string" || zone.name.length === 0) refuse(ZoneErrorCode.BAD_ZONE, "a zone needs a name");
	const originLabels = wireParseName(ZoneErrorCode.BAD_ZONE, `zone name "${zone.name}" does not parse as an absolute name`, { zone: zone.name }, zone.name);
	if (!zone.soa || typeof zone.soa !== "object") {
		refuse(ZoneErrorCode.APEX_SOA_REQUIRED, `zone "${zone.name}" carries no soa rdata`, { zone: zone.name });
	}

	const def = defaultTtlOf(zone);
	const lines = [`$ORIGIN ${zone.name}`];
	if (typeof zone.defaultTtl === "number" && def !== zone.soa.minimum) lines.push(`$TTL ${def}`);
	lines.push(`@ ${def} SOA ${wireFormatRdata(ZoneErrorCode.BAD_RECORD, "the zone's SOA rdata does not format", { zone: zone.name, type: TYPE.SOA }, TYPE.SOA, zone.soa)}`);

	for (const rrset of Array.isArray(rrsets) ? rrsets : []) {
		checkRrset(zone, rrset);
		const owner = ownerForm(
			wireParseName(ZoneErrorCode.BAD_OWNER, `rrset for "${rrset.name}" has an owner that does not parse as an absolute name`, { zone: zone.name, owner: rrset.name }, rrset.name),
			originLabels
		);
		emitRrset(lines, owner, rrset.type, rrset.ttl, def, rrset.records, rrset.comment, { zone: zone.name });
	}
	return lines.join("\n") + "\n";
}

/**
 * Export one view of a compiled snapshot as a master file.
 *
 * The text carries records only — `kind`, `serialPolicy`, `disabled`, rrset `source` and the view structure are store
 * concepts with no master-file form, and do not round-trip (docs/export.md). Emission: `$ORIGIN <snapshot.zone>`, then
 * `$TTL <snapshot.defaultTtl>` under the same rule as {@link exportZone} (omitted when it equals the SOA's minimum), then
 * the apex node first — the SOA with the snapshot's serial INLINED over the rdata's own serial field (exactly what the
 * server does when serving an answer), then the apex's remaining types by type number — followed by every other node in
 * ascending order of the snapshot's folded node keys, each node's types in ascending type number. Nodes with no rrsets
 * (empty non-terminals) emit nothing; delegation NS and glue A/AAAA are exported like any other data (they belong in a
 * master file). Each node rrset renders as one group of consecutive record lines with the group's TTL (omitted when it
 * equals the effective default) and the group's comment on its first line.
 *
 * @param {object} snapshot - a compiled snapshot (docs/snapshot.md), not disabled
 * @param {{ view?: string }} [options] - which view to export; defaults to the snapshot's only view, or the implicit
 *   "all" view of a viewless zone; a multi-view snapshot must name one
 * @returns {string} the master file, with a trailing newline
 * @throws {import("./errors.mjs").ZoneError} BAD_ZONE for a disabled snapshot, a missing SOA, an unresolved view, an
 *   unparseable zone or node-key name, or rdata the formatter refuses (the wire failure underneath as `cause`)
 */
export function exportSnapshot(snapshot, { view } = {}) {
	if (!snapshot || typeof snapshot !== "object") refuse(ZoneErrorCode.BAD_ZONE, "a snapshot must be an object");
	if (snapshot.disabled) {
		refuse(ZoneErrorCode.BAD_ZONE, `zone "${snapshot.zone}" is disabled and carries no content to export`, { zone: snapshot.zone });
	}
	if (!snapshot.soa || typeof snapshot.soa !== "object" || !Array.isArray(snapshot.soa.records) || !snapshot.soa.records[0]) {
		refuse(ZoneErrorCode.APEX_SOA_REQUIRED, `zone "${snapshot.zone}" carries no soa rdata`, { zone: snapshot.zone });
	}

	const views = snapshot.views ?? {};
	const names = Object.keys(views);
	const chosen = view ?? (names.length === 1 ? names[0] : names.includes("all") ? "all" : null);
	if (chosen === null) {
		refuse(ZoneErrorCode.BAD_ZONE, `zone "${snapshot.zone}" has ${names.length} views (${names.join(", ")}); pass the view to export`, {
			zone: snapshot.zone
		});
	}
	if (!views[chosen]) {
		refuse(ZoneErrorCode.BAD_ZONE, `view "${view}" is not in the snapshot; its views are ${names.join(", ")}`, { zone: snapshot.zone, view: chosen });
	}

	const originLabels = wireParseName(ZoneErrorCode.BAD_ZONE, `zone name "${snapshot.zone}" does not parse as an absolute name`, { zone: snapshot.zone }, snapshot.zone);
	const nodes = views[chosen].nodes ?? {};
	const def = snapshot.defaultTtl;
	const lines = [`$ORIGIN ${snapshot.zone}`];
	if (typeof def === "number" && def !== snapshot.soa.records[0].minimum) lines.push(`$TTL ${def}`);

	// The apex SOA, with the snapshot's serial inlined over the rdata's own (stale) serial field.
	lines.push(`@ ${def} SOA ${wireFormatRdata(ZoneErrorCode.BAD_RECORD, "the snapshot's SOA rdata does not format", { zone: snapshot.zone, type: TYPE.SOA }, TYPE.SOA, { ...snapshot.soa.records[0], serial: snapshot.serial })}`);

	const apexKey = formatName(originLabels).toLowerCase(); // the compiler's foldKey, recomputed
	const keys = Object.keys(nodes).sort();
	// The apex renders first in full (the SOA above, then its remaining types), then every other node in key order.
	const apexTypes = Object.keys(nodes[apexKey]?.rrsets ?? {})
		.map(Number)
		.sort((a, b) => a - b);
	for (const type of apexTypes) {
		if (type === TYPE.SOA) continue; // emitted above, with the inlined serial
		const rrset = nodes[apexKey].rrsets[type];
		emitRrset(lines, "@", type, rrset.ttl, def, rrset.records, rrset.comment, { zone: snapshot.zone });
	}
	for (const key of keys) {
		if (key === apexKey) continue;
		const node = nodes[key];
		const types = Object.keys(node.rrsets ?? {})
			.map(Number)
			.sort((a, b) => a - b);
		const ownerLabels = wireParseName(ZoneErrorCode.BAD_ZONE, `snapshot node key "${key}" does not parse as an absolute name`, { zone: snapshot.zone }, key);
		for (const type of types) {
			const rrset = node.rrsets[type];
			emitRrset(lines, ownerForm(ownerLabels, originLabels), type, rrset.ttl, def, rrset.records, rrset.comment, { zone: snapshot.zone });
		}
	}
	return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Shared emission
// ---------------------------------------------------------------------------

/**
 * The effective TTL default of a zone value: `zone.defaultTtl` when it is a number, else the SOA's minimum — the same
 * precedence the reader applies. A zone value without a `defaultTtl` therefore reads back with `defaultTtl` set to the
 * SOA minimum (documented normalization in docs/export.md).
 * @param {object} zone
 * @returns {number}
 */
function defaultTtlOf(zone) {
	return typeof zone.defaultTtl === "number" ? zone.defaultTtl : zone.soa.minimum;
}

/**
 * Validate one rrset value for export. The shape rules mirror the compiler's, so anything the compiler accepted exports.
 * @param {object} zone
 * @param {object} rrset
 */
function checkRrset(zone, rrset) {
	const ctx = { zone: zone.name, owner: rrset?.name };
	if (!rrset || typeof rrset !== "object") refuse(ZoneErrorCode.BAD_RECORD, "an rrset must be an object", ctx);
	if (rrset.view !== undefined && rrset.view !== null) {
		refuse(ZoneErrorCode.BAD_VIEW, `rrset for "${rrset.name}" is tagged view "${rrset.view}" — a master file has no views; per-view text is exportSnapshot's job`, { ...ctx, view: rrset.view });
	}
	if (!Number.isInteger(rrset.type) || rrset.type < 0 || rrset.type > 0xffff) {
		refuse(ZoneErrorCode.BAD_RECORD, `rrset for "${rrset.name}" has type ${JSON.stringify(rrset.type)}, which is not a type number (0-65535)`, ctx);
	}
	if (rrset.ttl !== undefined && rrset.ttl !== null && !(typeof rrset.ttl === "number" && Number.isInteger(rrset.ttl) && rrset.ttl >= 0)) {
		refuse(ZoneErrorCode.BAD_TTL, `rrset for "${rrset.name}" (${rrset.type}) has ttl ${JSON.stringify(rrset.ttl)}`, ctx);
	}
	if (!Array.isArray(rrset.records) || rrset.records.length === 0) {
		refuse(ZoneErrorCode.BAD_RECORD, `rrset for "${rrset.name}" (${rrset.type}) carries no records`, ctx);
	}
}

/**
 * Append one rrset as a group of record lines: the owner and type fixed, the TTL token omitted when the ttl equals the
 * effective default (the reader then inherits it back) or is null/undefined, each record's rdata on its own line, and
 * the comment on the line that opens the group (the reader attaches a group's comment to its first record).
 * @param {string[]} lines
 * @param {string} owner
 * @param {number} type
 * @param {number|null|undefined} ttl
 * @param {number} def - the effective TTL default
 * @param {object[]} records
 * @param {string|null} comment
 * @param {{ zone?: string }} ctx - the zone context for a wrapped wire refusal
 */
function emitRrset(lines, owner, type, ttl, def, records, comment, ctx = {}) {
	const ttlToken = ttl === def || ttl === undefined || ttl === null ? "" : ` ${ttl}`;
	const mnemonic = typeToString(type);
	records.forEach((data, i) => {
		const note = i === 0 && comment ? ` ; ${comment}` : "";
		const rdata = wireFormatRdata(ZoneErrorCode.BAD_RECORD, `rdata for "${owner} ${mnemonic}" does not format`, { ...ctx, owner, type }, type, data);
		lines.push(`${owner}${ttlToken} ${mnemonic} ${rdata}${note}`);
	});
}

/**
 * Parse a name for the exporter, wrapping a wire refusal in the exporter's own (the wire failure underneath as
 * `cause`). A ZoneError of this package's own passes through untouched, and so does anything else — a bug escapes as-is.
 * @param {string} code - the {@link ZoneErrorCode} the refusal carries
 * @param {string} message
 * @param {{ zone?: string, owner?: string, view?: string|null, type?: number }} ctx
 * @param {string} name
 * @returns {Uint8Array[]}
 */
function wireParseName(code, message, ctx, name) {
	try {
		return parseName(name);
	} catch (err) {
		if (isWireError(err)) refuse(code, message, { ...ctx, cause: err });
		throw err;
	}
}

/**
 * Format rdata for the exporter, with the same wire-refusal guard as {@link wireParseName}.
 * @param {string} code
 * @param {string} message
 * @param {{ zone?: string, owner?: string, view?: string|null, type?: number }} ctx
 * @param {number} type
 * @param {object} data
 * @returns {string}
 */
function wireFormatRdata(code, message, ctx, type, data) {
	try {
		return formatRdata(type, data);
	} catch (err) {
		if (isWireError(err)) refuse(code, message, { ...ctx, cause: err });
		throw err;
	}
}

/**
 * The owner form for a record line: `@` when the name IS the origin, the relative prefix when the name is the origin plus
 * leading labels, and the absolute canonical form otherwise. The suffix match is by label count and exact bytes on the
 * parsed labels — never a string suffix test, so an escaped dot inside a label (`router\.point`) stays label content —
 * and it is case-SENSITIVE on purpose: a name whose trailing labels merely case-fold to the origin's keeps the absolute
 * form, so the original spelling survives the round-trip.
 * @param {Uint8Array[]} labels - the owner's parsed labels
 * @param {Uint8Array[]} originLabels - the zone name's parsed labels
 * @returns {string}
 */
function ownerForm(labels, originLabels) {
	const name = formatName(labels);
	const origin = formatName(originLabels);
	if (name === origin) return "@";
	const skip = labels.length - originLabels.length;
	if (skip > 0 && sameLabels(labels.slice(skip), originLabels)) {
		// formatName always terminates a non-root name with ".", so the relative form is that string minus the final dot.
		return name.slice(0, name.length - origin.length - 1);
	}
	return name;
}

/**
 * Byte-exact label sequence equality (the case-sensitive suffix test behind {@link ownerForm}).
 * @param {Uint8Array[]} a
 * @param {Uint8Array[]} b
 * @returns {boolean}
 */
function sameLabels(a, b) {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i].length !== b[i].length) return false;
		for (let j = 0; j < a[i].length; j++) if (a[i][j] !== b[i][j]) return false;
	}
	return true;
}
