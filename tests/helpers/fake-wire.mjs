/**
 *	@Project: @cldmv/digby-ext-zones
 *	@Filename: /tests/helpers/fake-wire.mjs
 *	@Date: 2026-11-25T00:00:00-08:00
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
 * @fileoverview The fake wire surface the unit suites run against. Its SHAPE is exactly the adapter's contract —
 * the nested `self.wire.*` leaf paths the delegation tests in `tests/zones/codec.test.vitest.mjs` pin, in the wire's
 * landed form (e835c9f): `domain.*` for names, `type.mnemonic` / `class.mnemonic`, the constants and error codes as
 * zero-arg data leaves answering frozen tables, and `errors.is` as the error predicate (the wire's error class is not a
 * leaf). The stubs are behaviour-free and record their calls; the only name handling the compiler suite needs is plain,
 * unescaped, absolute names (the fixtures never use escapes, wildcards only as whole labels). It has no codec logic of
 * its own: the real-codec suites in `tests/wire/` run against the real codec through the seam (`tests/helpers/real-wire.mjs`), and the composed-host suite against the wire extension's own surface — never this stand-in.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Literal type numbers (RFC 1035 data, not logic): the ones the compiler fixtures reference. */
export const fakeTYPE = Object.freeze({ A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, AAAA: 28 });

/** Literal class numbers (RFC 1035 data). */
export const fakeCLASS = Object.freeze({ IN: 1 });

/** The fake wire's error class — a stand-in for the real `WireError`, distinct from `ZoneError`. */
export class FakeWireError extends Error {
	/**
	 * @param {string} code - one of {@link fakeCodes}
	 * @param {string} message
	 * @param {number} [offset] - character offset into the presentation text, where the codec gives one
	 */
	constructor(code, message, offset) {
		super(message);
		this.name = "WireError";
		this.code = code;
		this.offset = offset;
	}
}

/** The fake wire's error-code table (what its `errors.codes()` leaf answers — a stand-in for the real one). */
export const fakeCodes = Object.freeze({ BAD_PRESENTATION: "BAD_PRESENTATION", RELATIVE_NAME: "RELATIVE_NAME", BAD_RDATA: "BAD_RDATA" });

/**
 * Record one stub call. The delegation tests assert the routing by inspecting `fakeWire.calls`.
 * @param {string} leaf - the `self.wire.*` path that was reached
 * @param {unknown[]} args
 */
function log(leaf, args) {
	fakeWire.calls.push({ leaf, args });
}

/**
 * The fake's name parser: split on dots, require the trailing dot. No escapes, no compression — the compiler suite's
 * fixtures are plain names, and the real parser (digby-ext-wire, #42) replaces this.
 * @param {string} name
 * @returns {Uint8Array[]}
 */
function parseFakeName(name) {
	if (typeof name !== "string" || name.length === 0) throw new FakeWireError(fakeCodes.BAD_PRESENTATION, `not a name: ${JSON.stringify(name)}`);
	if (!name.endsWith(".")) throw new FakeWireError(fakeCodes.RELATIVE_NAME, `relative name "${name}" — the fake only parses absolute names`);
	const text = name.slice(0, -1);
	if (text.length === 0) return [];
	return text.split(".").map((label) => encoder.encode(label));
}

/**
 * The fake's name formatter: the labels joined with dots and terminated. Inverse of {@link parseFakeName}.
 * @param {Uint8Array[]} labels
 * @returns {string}
 */
function formatFakeName(labels) {
	if (!Array.isArray(labels)) throw new FakeWireError(fakeCodes.BAD_PRESENTATION, `not a label sequence: ${JSON.stringify(labels)}`);
	return labels.length === 0 ? "." : labels.map((label) => decoder.decode(label)).join(".") + ".";
}

/**
 * The fake `self.wire` surface. Every stub passes its arguments straight into recorded canned behaviour; nothing here
 * implements the wire codec.
 * @type {object}
 */
export const fakeWire = {
	/** Every stub's calls, in order: `{ leaf, args }`. */
	calls: [],
	record: {
		parse: (line, options) => {
			log("record.parse", [line, options]);
			// One canned record: an apex SOA, so the reader's single-record path routes into zone.soa.
			return { name: "example.", type: fakeTYPE.SOA, class: fakeCLASS.IN, ttl: 3600, data: { line } };
		},
		format: (type, data) => {
			log("record.format", [type, data]);
			return `record(${type}, ${JSON.stringify(data)})`;
		}
	},
	domain: {
		parse: (name) => {
			log("domain.parse", [name]);
			return parseFakeName(name);
		},
		format: (labels) => {
			log("domain.format", [labels]);
			return formatFakeName(labels);
		},
		canonical: (name, origin) => {
			log("domain.canonical", [name, origin]);
			return name; // the fake canonicalizes nothing
		},
		key: (name) => {
			log("domain.key", [name]);
			return String(name).toLowerCase();
		}
	},
	ttl: {
		parse: (text) => {
			log("ttl.parse", [text]);
			return Number(text);
		}
	},
	rdata: {
		parse: (type, text) => {
			log("rdata.parse", [type, text]);
			return `rdata-parsed(${type}, ${text})`;
		},
		format: (type, data) => {
			log("rdata.format", [type, data]);
			return `rdata(${type}, ${JSON.stringify(data)})`;
		},
		encode: (type, data) => {
			log("rdata.encode", [type, data]);
			return encoder.encode(`bytes(${type})`);
		},
		decode: (type, bytes) => {
			log("rdata.decode", [type, bytes]);
			return `decoded(${type})`;
		}
	},
	type: {
		mnemonic: (type) => {
			log("type.mnemonic", [type]);
			return fakeMnemonic(type);
		}
	},
	class: {
		mnemonic: (cls) => {
			log("class.mnemonic", [cls]);
			return cls === fakeCLASS.IN ? "IN" : `CLASS${cls}`;
		}
	},
	// The data leaves are zero-arg functions answering frozen tables (the wire's A1 form) — silent, they carry no calls.
	constants: {
		type: () => fakeTYPE,
		class: () => fakeCLASS
	},
	errors: {
		is: (err) => {
			log("errors.is", [err]);
			return err instanceof FakeWireError;
		},
		codes: () => fakeCodes
	}
};

/**
 * The fake's type mnemonic table (data). Unlisted types render generically.
 * @param {number} type
 * @returns {string}
 */
function fakeMnemonic(type) {
	for (const [name, value] of Object.entries(fakeTYPE)) if (value === type) return name;
	return `TYPE${type}`;
}
