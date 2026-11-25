/**
 *	@Project: @cldmv/digby-ext-zones
 *	@Filename: /tests/zones/codec.test.vitest.mjs
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
 * @fileoverview The wire seam's suite (`src/lib/codec.mjs`): every named export routes to exactly the `self.wire.*` leaf
 * path the adapter contract fixes (the fake's shape is that contract — `tests/helpers/fake-wire.mjs`), the surface is
 * read per call (never captured at module-eval time), `setWire` fails fast on a wrong-shaped surface, and nothing is
 * reachable before the surface is captured. Also the `ZoneError` contract: its own error type (not the wire's), its
 * codes, and a wire failure arriving as `cause`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	CLASS,
	TYPE,
	WireError,
	WireErrorCode,
	canonicalName,
	classToString,
	decodeRdataBytes,
	encodeRdataBytes,
	formatName,
	formatRdata,
	formatRecord,
	nameKey,
	parseName,
	parseRdata,
	parseRecord,
	parseTtl,
	setWire,
	typeToString
} from "../../src/lib/codec.mjs";
import { ZoneError, ZoneErrorCode } from "../../src/lib/errors.mjs";
import { FakeWireError, fakeCLASS, fakeCodes, fakeTYPE, fakeWire } from "../helpers/fake-wire.mjs";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

beforeEach(() => {
	setWire(fakeWire);
	fakeWire.calls.length = 0;
});

/** The last stub call the fake recorded, or undefined. */
function lastCall() {
	return fakeWire.calls[fakeWire.calls.length - 1];
}

describe("delegation — every named export routes to its self.wire.* leaf", () => {
	it("parseRecord -> wire.record.parse, arguments passed through", () => {
		const out = parseRecord("example. 3600 IN SOA ns1.example. host.example. 1 2 3 4 5", { origin: "example." });
		expect(lastCall()).toEqual({ leaf: "record.parse", args: ["example. 3600 IN SOA ns1.example. host.example. 1 2 3 4 5", { origin: "example." }] });
		expect(out).toEqual({ name: "example.", type: fakeTYPE.SOA, class: fakeCLASS.IN, ttl: 3600, data: { line: "example. 3600 IN SOA ns1.example. host.example. 1 2 3 4 5" } });
	});

	it("formatRecord -> wire.record.format", () => {
		expect(formatRecord(fakeTYPE.A, { address: "10.0.0.1" })).toBe(`record(${fakeTYPE.A}, {"address":"10.0.0.1"})`);
		expect(lastCall()).toEqual({ leaf: "record.format", args: [fakeTYPE.A, { address: "10.0.0.1" }] });
	});

	it("parseName -> wire.name.parse, labels back as bytes", () => {
		const labels = parseName("app.example.");
		expect(lastCall()).toEqual({ leaf: "name.parse", args: ["app.example."] });
		expect(labels.map((label) => decoder.decode(label))).toEqual(["app", "example"]);
	});

	it("formatName -> wire.name.format", () => {
		expect(formatName(parseName("a.b."))).toBe("a.b.");
		expect(lastCall()).toEqual({ leaf: "name.format", args: [parseName("a.b.")] });
	});

	it("canonicalName -> wire.name.canonical, origin passed through", () => {
		expect(canonicalName("www", "example.")).toBe("www"); // the fake canonicalizes nothing
		expect(lastCall()).toEqual({ leaf: "name.canonical", args: ["www", "example."] });
	});

	it("nameKey -> wire.name.key, case folded", () => {
		expect(nameKey("APP.Example.")).toBe("app.example.");
		expect(lastCall()).toEqual({ leaf: "name.key", args: ["APP.Example."] });
	});

	it("parseTtl -> wire.ttl.parse", () => {
		expect(parseTtl("900")).toBe(900);
		expect(lastCall()).toEqual({ leaf: "ttl.parse", args: ["900"] });
	});

	it("parseRdata -> wire.rdata.parse", () => {
		expect(parseRdata(fakeTYPE.A, "10.0.0.1")).toBe(`rdata-parsed(${fakeTYPE.A}, 10.0.0.1)`);
		expect(lastCall()).toEqual({ leaf: "rdata.parse", args: [fakeTYPE.A, "10.0.0.1"] });
	});

	it("formatRdata -> wire.rdata.format", () => {
		expect(formatRdata(fakeTYPE.TXT, { strings: ["x"] })).toBe(`rdata(${fakeTYPE.TXT}, {"strings":["x"]})`);
		expect(lastCall()).toEqual({ leaf: "rdata.format", args: [fakeTYPE.TXT, { strings: ["x"] }] });
	});

	it("encodeRdataBytes -> wire.rdata.encode", () => {
		expect(Array.from(encodeRdataBytes(fakeTYPE.A, { address: "10.0.0.1" }))).toEqual(Array.from(encoder.encode("bytes(1)")));
		expect(lastCall()).toEqual({ leaf: "rdata.encode", args: [fakeTYPE.A, { address: "10.0.0.1" }] });
	});

	it("decodeRdataBytes -> wire.rdata.decode", () => {
		expect(decodeRdataBytes(fakeTYPE.AAAA, new Uint8Array([1]))).toBe(`decoded(${fakeTYPE.AAAA})`);
		expect(lastCall()).toEqual({ leaf: "rdata.decode", args: [fakeTYPE.AAAA, new Uint8Array([1])] });
	});

	it("typeToString -> wire.type.name (a leaf is never named toString)", () => {
		expect(typeToString(fakeTYPE.CNAME)).toBe("CNAME");
		expect(typeToString(999)).toBe("TYPE999");
		expect(lastCall()).toEqual({ leaf: "type.name", args: [999] });
	});

	it("classToString -> wire.class.name", () => {
		expect(classToString(fakeCLASS.IN)).toBe("IN");
		expect(classToString(255)).toBe("CLASS255");
		expect(lastCall()).toEqual({ leaf: "class.name", args: [255] });
	});
});

describe("constants — per-property reads on the captured surface", () => {
	it("TYPE and CLASS resolve to the wire's tables", () => {
		expect(TYPE.A).toBe(fakeTYPE.A);
		expect(TYPE.CNAME).toBe(fakeTYPE.CNAME);
		expect(CLASS.IN).toBe(fakeCLASS.IN);
		expect(Object.keys(TYPE)).toEqual(Object.keys(fakeTYPE));
	});

	it("resolves per property read: a re-captured surface is reflected immediately (never module-eval time)", () => {
		const variant = { ...fakeWire, constants: { TYPE: { ...fakeTYPE, A: 777 }, CLASS: fakeCLASS } };
		setWire(variant);
		expect(TYPE.A).toBe(777);
		expect(parseTtl("1")).toBe(1); // the other leaves still route through the (shared) stubs
	});
});

describe("errors — the wire's error class and codes", () => {
	it("WireError constructs the wire's error class", () => {
		const err = new WireError(fakeCodes.BAD_RDATA, "boom", 7);
		expect(err).toBeInstanceOf(FakeWireError);
		expect(err).not.toBeInstanceOf(ZoneError);
		expect(err.code).toBe(fakeCodes.BAD_RDATA);
		expect(err.message).toBe("boom");
		expect(err.offset).toBe(7);
	});

	it("a wire error instance is an instance of the seam's WireError", () => {
		expect(new FakeWireError(fakeCodes.BAD_PRESENTATION, "x")).toBeInstanceOf(WireError);
	});

	it("WireErrorCode resolves to the wire's code table", () => {
		expect(WireErrorCode.BAD_PRESENTATION).toBe(fakeCodes.BAD_PRESENTATION);
		expect(Object.keys(WireErrorCode)).toEqual(Object.keys(fakeCodes));
	});
});

describe("setWire — fail fast on a wrong-shaped surface", () => {
	it("accepts the full fake (beforeEach does this every time)", () => {
		expect(() => setWire(fakeWire)).not.toThrow();
	});

	it("refuses a surface missing a leaf", () => {
		const broken = { ...fakeWire, rdata: { ...fakeWire.rdata, encode: undefined } };
		expect(() => setWire(broken)).toThrowError(TypeError);
		expect(() => setWire(broken)).toThrowError(/rdata\.encode/);
	});

	it("refuses a surface missing a whole subtree", () => {
		const broken = { ...fakeWire, name: undefined };
		expect(() => setWire(broken)).toThrowError(TypeError);
		expect(() => setWire(broken)).toThrowError(/name\.parse/);
	});

	it("refuses a non-function where a function is expected", () => {
		const broken = { ...fakeWire, ttl: { parse: 5 } };
		expect(() => setWire(broken)).toThrowError(TypeError);
	});

	it("refuses a non-object", () => {
		expect(() => setWire(null)).toThrowError(TypeError);
		expect(() => setWire(42)).toThrowError(TypeError);
	});

	it("a refused setWire leaves the previous surface intact", () => {
		expect(() => setWire({ ...fakeWire, type: {} })).toThrowError(TypeError);
		expect(typeToString(fakeTYPE.A)).toBe("A");
	});
});

describe("not ready — nothing is reachable before the surface is captured", () => {
	it("a delegating export throws ZoneError WIRE_NOT_READY on a fresh module (surface never set)", async () => {
		vi.resetModules();
		const fresh = await import("../../src/lib/codec.mjs");
		const { ZoneError: FreshZoneError, ZoneErrorCode: FreshZoneErrorCode } = await import("../../src/lib/errors.mjs");
		let err;
		try {
			fresh.parseName("x.");
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(FreshZoneError);
		expect(err.code).toBe(FreshZoneErrorCode.WIRE_NOT_READY);
		expect(err.message).toMatch(/setWire/);
	});
});

describe("ZoneError — its own error type", () => {
	it("is an Error, not a WireError", () => {
		const err = new ZoneError(ZoneErrorCode.BAD_ZONE, "bad zone");
		expect(err).toBeInstanceOf(Error);
		expect(err).not.toBeInstanceOf(FakeWireError);
		expect(err.name).toBe("ZoneError");
		expect(err.code).toBe(ZoneErrorCode.BAD_ZONE);
		expect(err.message).toBe("bad zone");
	});

	it("carries the context fields", () => {
		const err = new ZoneError(ZoneErrorCode.BAD_OWNER, "outside", { zone: "example.", owner: "other.example.", view: "lan", type: 1 });
		expect(err.zone).toBe("example.");
		expect(err.owner).toBe("other.example.");
		expect(err.view).toBe("lan");
		expect(err.type).toBe(1);
	});

	it("carries a wire failure underneath as cause", () => {
		const wire = new FakeWireError(fakeCodes.BAD_PRESENTATION, "bad name");
		const err = new ZoneError(ZoneErrorCode.BAD_OWNER, "does not parse", { zone: "example.", cause: wire });
		expect(err.cause).toBe(wire);
		expect(err.cause).toBeInstanceOf(FakeWireError);
	});

	it("knows WIRE_NOT_READY", () => {
		expect(ZoneErrorCode.WIRE_NOT_READY).toBe("WIRE_NOT_READY");
	});
});
