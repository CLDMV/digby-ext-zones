/**
 *	@Project: @cldmv/digby-ext-zones
 *	@Filename: /src/lib/codec.mjs
 *	@Date: 2026-11-22T09:39:54-08:00
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-25T00:00:00-08:00
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview The one seam between digby-ext-zones and the DNS wire codec — and the ADAPTER onto the wire extension.
 *
 * No extension may import another composed extension's lib, so the wire codec (today in `digby-ext-server/src/lib/wire/`,
 * moving to its own extension package `@cldmv/digby-ext-wire`, CLDMV/digby#42) reaches this package only through a
 * captured surface: the root leaf's `activate()` reads `self.wire` and hands it to {@link setWire}, and every named
 * export below delegates to the matching `self.wire.*` leaf — read PER CALL, never at module-eval time, so a re-captured
 * surface takes effect immediately and nothing here holds an unbound `self` reference.
 *
 * The leaf paths this module names (the ONE place in the package that does):
 *
 *   parseRecord      -> self.wire.record.parse      formatRecord    -> self.wire.record.format
 *   parseName        -> self.wire.name.parse        formatName      -> self.wire.name.format
 *   canonicalName    -> self.wire.name.canonical    nameKey         -> self.wire.name.key
 *   parseTtl         -> self.wire.ttl.parse
 *   parseRdata       -> self.wire.rdata.parse       formatRdata     -> self.wire.rdata.format
 *   encodeRdataBytes -> self.wire.rdata.encode      decodeRdataBytes-> self.wire.rdata.decode
 *   typeToString     -> self.wire.type.name         classToString   -> self.wire.class.name
 *   TYPE / CLASS     -> self.wire.constants.TYPE / .CLASS
 *   WireError        -> self.wire.errors.WireError  WireErrorCode   -> self.wire.errors.codes
 *
 * (Leaf names are provisional until #42 builds the wire extension; this adapter is the single place to change them.
 * The message codec and framer — decode/encode/encodeCapped/framer — are not part of zones' surface and are left out,
 * here and in the fake, on purpose.)
 *
 * The committed suite runs against a shape-only fake of this surface (`tests/helpers/fake-wire.mjs`, captured by
 * `tests/setup-wire.mjs`); the parked reader/exporter suites in `tests/needs-wire/` run against the real codec once #42
 * composes the wire extension next to zones.
 */

import { ZoneError, ZoneErrorCode } from "./errors.mjs";

/** The captured wire surface (`self.wire`), set by {@link setWire} from the root leaf's `activate()`. */
let surface = null;

/**
 * Everything the seam needs from the surface, as `[leaf path, expected typeof]`. Kept next to the delegations below —
 * both change together with #42.
 */
const REQUIRED = [
	["constants.TYPE", "object"],
	["constants.CLASS", "object"],
	["errors.WireError", "function"],
	["errors.codes", "object"],
	["record.parse", "function"],
	["record.format", "function"],
	["name.parse", "function"],
	["name.format", "function"],
	["name.canonical", "function"],
	["name.key", "function"],
	["ttl.parse", "function"],
	["rdata.parse", "function"],
	["rdata.format", "function"],
	["rdata.encode", "function"],
	["rdata.decode", "function"],
	["type.name", "function"],
	["class.name", "function"]
];

/**
 * Capture the wire surface for this extension. Called once from the root leaf's `activate()` with `self.wire`; the test
 * setup calls it with the fake. Fails fast on a wrong-shaped surface — a surface missing anything in {@link REQUIRED}
 * (or carrying a non-function where a function is expected) is refused BEFORE replacing the current one, so a bad
 * capture leaves the previous surface intact.
 *
 * @param {object} wire - the wire extension's composed surface (`self.wire`)
 * @throws {TypeError} when `wire` is not an object, or is missing/mistyped anything in {@link REQUIRED}
 */
export function setWire(wire) {
	if (!wire || typeof wire !== "object") throw new TypeError(`setWire: the wire surface must be an object, got ${typeof wire}`);
	const missing = [];
	for (const [path, kind] of REQUIRED) {
		let node = wire;
		for (const segment of path.split(".")) node = node?.[segment];
		if (typeof node !== kind) missing.push(`${path} (${kind})`);
	}
	if (missing.length > 0) throw new TypeError(`setWire: the wire surface is missing or mistyped: ${missing.join(", ")}`);
	surface = wire;
}

/**
 * The captured surface, or a refusal. Every delegation calls this — the surface is read at CALL time, never when a
 * module loads.
 * @returns {object}
 * @throws {import("./errors.mjs").ZoneError} WIRE_NOT_READY when nothing has been captured yet
 */
function wire() {
	if (surface === null) {
		throw new ZoneError(
			ZoneErrorCode.WIRE_NOT_READY,
			"the wire surface has not been captured yet — the zones extension's activate() has not run (it captures self.wire and calls setWire)"
		);
	}
	return surface;
}

/**
 * Resolve a dotted leaf path on the captured surface, at call time.
 * @param {string} path
 * @returns {unknown}
 */
function at(path) {
	let node = wire();
	for (const segment of path.split(".")) node = node[segment];
	return node;
}

/**
 * A delegating named export: a plain function that reads the surface per call and passes everything through.
 * @param {string} name - the export's name (kept on the function for stack traces)
 * @param {string} path - the `self.wire.*` leaf path it delegates to
 * @returns {(...args: unknown[]) => unknown}
 */
function delegate(name, path) {
	const fn = (...args) => at(path)(...args);
	Object.defineProperty(fn, "name", { value: name });
	return fn;
}

/**
 * A delegating namespace: reads the captured surface per property access, so constant tables and code enums always
 * reflect the surface that is captured NOW (forwarding traps so enumeration and `in` work too).
 * @param {string} path
 * @returns {object}
 */
function liveNamespace(path) {
	return new Proxy({}, {
		get: (_target, key) => (typeof key === "symbol" ? undefined : Reflect.get(at(path), key)),
		has: (_target, key) => Reflect.has(at(path), key),
		ownKeys: () => Reflect.ownKeys(at(path)),
		getOwnPropertyDescriptor: (_target, key) => {
			const desc = Reflect.getOwnPropertyDescriptor(at(path), key);
			// The real tables are frozen; a reported non-configurable descriptor on an empty extensible target
			// violates the proxy invariants — report it configurable so Object.keys/enumeration keep working.
			return desc ? { ...desc, configurable: true } : undefined;
		}
	});
}

// ---------------------------------------------------------------------------
// The delegations (see the module doc's table)
// ---------------------------------------------------------------------------

/** Parse one master-file record line — `self.wire.record.parse`. */
export const parseRecord = delegate("parseRecord", "record.parse");

/** Format one record line — `self.wire.record.format`. */
export const formatRecord = delegate("formatRecord", "record.format");

/** Parse an absolute domain name into labels — `self.wire.name.parse`. */
export const parseName = delegate("parseName", "name.parse");

/** Format parsed labels back to an absolute name — `self.wire.name.format`. */
export const formatName = delegate("formatName", "name.format");

/** Canonicalize a name against an origin — `self.wire.name.canonical`. */
export const canonicalName = delegate("canonicalName", "name.canonical");

/** The lookup key of a name (case-folded, escaped-normalized) — `self.wire.name.key`. */
export const nameKey = delegate("nameKey", "name.key");

/** Parse a TTL token — `self.wire.ttl.parse`. */
export const parseTtl = delegate("parseTtl", "ttl.parse");

/** Parse one rdata's presentation text — `self.wire.rdata.parse`. */
export const parseRdata = delegate("parseRdata", "rdata.parse");

/** Format one rdata value — `self.wire.rdata.format`. */
export const formatRdata = delegate("formatRdata", "rdata.format");

/** Encode one rdata value to wire bytes — `self.wire.rdata.encode`. */
export const encodeRdataBytes = delegate("encodeRdataBytes", "rdata.encode");

/** Decode wire bytes to one rdata value — `self.wire.rdata.decode`. */
export const decodeRdataBytes = delegate("decodeRdataBytes", "rdata.decode");

/** A type number's mnemonic — `self.wire.type.name`. */
export const typeToString = delegate("typeToString", "type.name");

/** A class number's mnemonic — `self.wire.class.name`. */
export const classToString = delegate("classToString", "class.name");

/** The wire's type-number table (RFC 1035 et al) — `self.wire.constants.TYPE`, read per property. */
export const TYPE = liveNamespace("constants.TYPE");

/** The wire's class-number table — `self.wire.constants.CLASS`, read per property. */
export const CLASS = liveNamespace("constants.CLASS");

/**
 * The wire's error class — `self.wire.errors.WireError`, read per access: `new WireError(...)` constructs the wire's
 * class and `instanceof` checks against it resolve through the live `prototype`.
 */
export const WireError = new Proxy(class {}, {
	construct: (_target, args) => Reflect.construct(at("errors.WireError"), args),
	apply: (_target, thisArg, args) => Reflect.apply(at("errors.WireError"), thisArg, args),
	get: (_target, key) => {
		const real = at("errors.WireError");
		if (key === "prototype") return real.prototype;
		const value = Reflect.get(real, key, real);
		return typeof value === "function" ? value.bind(real) : value;
	},
	has: (_target, key) => Reflect.has(at("errors.WireError"), key)
});

/** The wire's error-code table — `self.wire.errors.codes`, read per property. */
export const WireErrorCode = liveNamespace("errors.codes");
