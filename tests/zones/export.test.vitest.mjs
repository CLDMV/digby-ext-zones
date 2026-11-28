/**
 *	@Project: @cldmv/digby-ext-zones
 *	@Filename: /tests/zones/export.test.vitest.mjs
 */

/**
 * @fileoverview The exporter's error contract: a wire failure (an unparseable name, rdata the formatter refuses) is
 * WRAPPED in the exporter's own `ZoneError` with the wire failure underneath as `cause` — nothing raw escapes the
 * public functions (errors.mjs's contract; the Friday review's should-fix). Run against the fake wire: the fake's
 * stubs raise `FakeWireError`s, which its `errors.is` leaf recognizes, exactly as the real wire's predicate does for
 * its own errors.
 */

// The fake wire, captured before anything else evaluates — THIS suite's stand-in only (see tests/setup-wire.mjs).
import "../setup-wire.mjs";

import { beforeEach, describe, expect, it } from "vitest";
import { exportSnapshot, exportZone } from "../../src/lib/export.mjs";
import { TYPE, isWireError, setWire } from "../../src/lib/codec.mjs";
import { ZoneErrorCode } from "../../src/lib/errors.mjs";
import { FakeWireError, fakeCodes, fakeWire } from "../helpers/fake-wire.mjs";

const SOA = { mname: "ns1.example.", rname: "host.example.", serial: 5, refresh: 7200, retry: 900, expire: 1209600, minimum: 3600 };

const ZONE = { name: "example.", kind: "primary", soa: SOA, defaultTtl: 3600 };

beforeEach(() => {
	setWire(fakeWire);
	fakeWire.calls.length = 0;
});

/** The refusal `fn` raises, with its code asserted. */
function refusal(fn, code) {
	let err;
	try {
		fn();
	} catch (e) {
		err = e;
	}
	expect(err, `expected a ${code} refusal`).toBeInstanceOf(Error);
	expect(err.code).toBe(code);
	return err;
}

describe("wire failures arrive wrapped, the wire failure underneath as cause", () => {
	it("a relative owner name refuses BAD_OWNER, the wire's RELATIVE_NAME as cause", () => {
		const err = refusal(() => exportZone(ZONE, [{ name: "a.example", type: TYPE.A, records: [{ address: "10.0.0.1" }] }]), ZoneErrorCode.BAD_OWNER);
		expect(err).not.toBeInstanceOf(FakeWireError);
		expect(isWireError(err.cause)).toBe(true);
		expect(err.cause.code).toBe(fakeCodes.RELATIVE_NAME);
		expect(err.zone).toBe("example.");
		expect(err.owner).toBe("a.example");
	});

	it("a relative zone name refuses BAD_ZONE, the wire failure as cause", () => {
		const err = refusal(() => exportZone({ name: "example", soa: SOA }, []), ZoneErrorCode.BAD_ZONE);
		expect(isWireError(err.cause)).toBe(true);
		expect(err.message).toMatch(/does not parse as an absolute name/);
	});

	it("rdata the formatter refuses refuses BAD_RECORD, the wire failure as cause", () => {
		setWire({ ...fakeWire, rdata: { ...fakeWire.rdata, format: () => { throw new FakeWireError(fakeCodes.BAD_RDATA, "not an IPv4 address"); } } });
		const err = refusal(() => exportZone(ZONE, [{ name: "a.example.", type: TYPE.A, records: [{ address: "nope" }] }]), ZoneErrorCode.BAD_RECORD);
		expect(isWireError(err.cause)).toBe(true);
		expect(err.cause.message).toMatch(/not an IPv4 address/);
		expect(err.message).toMatch(/does not format/);
	});

	it("exportSnapshot wraps an unparseable zone name the same way", () => {
		const err = refusal(() => exportSnapshot({ zone: "example", soa: { records: [SOA] }, serial: 1, defaultTtl: 3600, views: { all: { nodes: {} } } }), ZoneErrorCode.BAD_ZONE);
		expect(isWireError(err.cause)).toBe(true);
	});
});

describe("the exporter's own refusals stay bare ZoneErrors", () => {
	it("a view-tagged rrset refuses BAD_VIEW with no cause", () => {
		const err = refusal(() => exportZone(ZONE, [{ name: "a.example.", type: TYPE.A, view: "lan", records: [{ address: "10.0.0.1" }] }]), ZoneErrorCode.BAD_VIEW);
		expect(err.cause).toBeUndefined();
	});

	it("a zone without soa rdata refuses APEX_SOA_REQUIRED with no cause", () => {
		const err = refusal(() => exportZone({ name: "example.", soa: undefined }, []), ZoneErrorCode.APEX_SOA_REQUIRED);
		expect(err.cause).toBeUndefined();
	});
});
