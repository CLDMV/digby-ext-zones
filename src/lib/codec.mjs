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
 * No extension may import another composed extension's lib, so the wire codec (its own extension package
 * `@cldmv/digby-ext-wire` since CLDMV/digby#42) reaches this package only through a
 * captured surface: the root leaf's `activate()` reads `self.wire` and hands it to {@link setWire}, and every named
 * export below delegates to the matching `self.wire.*` leaf — read PER CALL, never at module-eval time, so a re-captured
 * surface takes effect immediately and nothing here holds an unbound `self` reference.
 *
 * The leaf paths this module names (the ONE place in the package that does) — the wire's landed surface (e835c9f):
 *
 *   parseRecord      -> self.wire.record.parse      formatRecord    -> self.wire.record.format
 *   parseName        -> self.wire.domain.parse      formatName      -> self.wire.domain.format
 *   canonicalName    -> self.wire.domain.canonical  nameKey         -> self.wire.domain.key
 *   parseTtl         -> self.wire.ttl.parse
 *   parseRdata       -> self.wire.rdata.parse       formatRdata     -> self.wire.rdata.format
 *   encodeRdataBytes -> self.wire.rdata.encode      decodeRdataBytes-> self.wire.rdata.decode
 *   typeToString     -> self.wire.type.mnemonic     classToString   -> self.wire.class.mnemonic
 *   TYPE / CLASS     -> self.wire.constants.type() / .class()  (zero-arg data leaves answering the frozen tables;
 *                     the class leaf is file `class.mjs`, whose function is `klass` — `class` is a reserved word —
 *                     re-exported as `class`)
 *   isWireError      -> self.wire.errors.is(err)    WireErrorCode   -> self.wire.errors.codes()
 *
 * (The wire's error CLASS is not a leaf — it cannot be published, and `instanceof` across the composed boundary is
 * false anyway — so nothing here constructs or tests one: a wire failure is recognized with the `errors.is` predicate,
 * and zones' own refusals carry it as `cause`. The message codec and framer — decode/encode/encodeCapped/framer — are
 * not part of zones' surface and are left out, here and in the fake, on purpose.)
 *
 * The unit suites run against a shape-only fake of this surface (`tests/helpers/fake-wire.mjs`, captured per suite by
 * `tests/setup-wire.mjs`); the reader/exporter suites in `tests/wire/` run against the REAL codec
 * (`tests/helpers/real-wire.mjs`), and the composed-host suite against the wire extension's own surface through
 * activate's capture.
 */

import { ZoneError, ZoneErrorCode } from "./errors.mjs";

/** The captured wire surface (`self.wire`), set by {@link setWire} from the root leaf's `activate()`. */
let surface = null;

/**
 * Everything the seam needs from the surface, as `[leaf path, expected typeof]`. Kept next to the delegations below —
 * both change together with #42.
 */
const REQUIRED = [
	["constants.type", "function"],
	["constants.class", "function"],
	["errors.is", "function"],
	["errors.codes", "function"],
	["record.parse", "function"],
	["record.format", "function"],
	["domain.parse", "function"],
	["domain.format", "function"],
	["domain.canonical", "function"],
	["domain.key", "function"],
	["ttl.parse", "function"],
	["rdata.parse", "function"],
	["rdata.format", "function"],
	["rdata.encode", "function"],
	["rdata.decode", "function"],
	["type.mnemonic", "function"],
	["class.mnemonic", "function"]
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
 * The frozen table a zero-arg data leaf answers, read per call.
 * @param {string} path - the `self.wire.*` leaf path of the zero-arg function
 * @returns {object}
 */
function table(path) {
	return at(path)();
}

/**
 * A delegating namespace over a zero-arg data leaf: reads the captured surface per property access, so constant
 * tables and code enums always reflect the surface that is captured NOW (forwarding traps so enumeration and `in`
 * work too).
 * @param {string} path
 * @returns {object}
 */
function liveNamespace(path) {
	return new Proxy({}, {
		get: (_target, key) => (typeof key === "symbol" ? undefined : Reflect.get(table(path), key)),
		has: (_target, key) => Reflect.has(table(path), key),
		ownKeys: () => Reflect.ownKeys(table(path)),
		getOwnPropertyDescriptor: (_target, key) => {
			const desc = Reflect.getOwnPropertyDescriptor(table(path), key);
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

/** Parse an absolute domain name into labels — `self.wire.domain.parse`. */
export const parseName = delegate("parseName", "domain.parse");

/** Format parsed labels back to an absolute name — `self.wire.domain.format`. */
export const formatName = delegate("formatName", "domain.format");

/** Canonicalize a name against an origin — `self.wire.domain.canonical`. */
export const canonicalName = delegate("canonicalName", "domain.canonical");

/** The lookup key of a name (case-folded, escaped-normalized) — `self.wire.domain.key`. */
export const nameKey = delegate("nameKey", "domain.key");

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

/** A type number's mnemonic — `self.wire.type.mnemonic`. */
export const typeToString = delegate("typeToString", "type.mnemonic");

/** A class number's mnemonic — `self.wire.class.mnemonic`. */
export const classToString = delegate("classToString", "class.mnemonic");

/** The wire's type-number table (RFC 1035 et al) — `self.wire.constants.type()`, read per property. */
export const TYPE = liveNamespace("constants.type");

/** The wire's class-number table — `self.wire.constants.class()`, read per property. */
export const CLASS = liveNamespace("constants.class");

/**
 * Is this error one of the wire's? — `self.wire.errors.is(err)`, read per call. The wire's error class is not a leaf
 * (it cannot be published, and `instanceof` is false across the composed boundary), so this predicate is the contract
 * for recognizing a wire failure — the seam's refusals carry one underneath as `cause`.
 */
export const isWireError = delegate("isWireError", "errors.is");

/** The wire's error-code table — `self.wire.errors.codes()`, read per property. */
export const WireErrorCode = liveNamespace("errors.codes");
