/**
 *	@Project: @cldmv/digby-ext-zones
 *	@Filename: /tests/zones/leaves.test.vitest.mjs
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
 * @fileoverview The api leaves' suite: `self.zones.import.file`, `self.zones.compile`, `self.zones.export.zone` and
 * `self.zones.export.snapshot` are thin leaves over the lib, and the root leaf's `activate()` captures `self.wire` into
 * the seam. Called before activate (no captured surface), every leaf refuses with `ZoneError WIRE_NOT_READY`; after
 * activate (the setup file captures the fake — `tests/setup-wire.mjs`), they route through the fake wire. No leaf test
 * imports another extension: the wire arrives only through the seam.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import importFile from "../../src/api/zones/import/file.mjs";
import compile from "../../src/api/zones/compile.mjs";
import exportSnapshot from "../../src/api/zones/export/snapshot.mjs";
import exportZone from "../../src/api/zones/export/zone.mjs";
import { TYPE, setWire } from "../../src/lib/codec.mjs";
import { ZoneErrorCode } from "../../src/lib/errors.mjs";
import { fakeWire } from "../helpers/fake-wire.mjs";

/** 2026-11-25, pinned so the `date` serial policy is deterministic. */
const NOW = new Date(Date.UTC(2026, 10, 25));

const SOA = { mname: "ns1.example.", rname: "host.example.", serial: 5, refresh: 7200, retry: 900, expire: 1209600, minimum: 3600 };

const ZONE = { name: "example.", kind: "primary", soa: SOA, defaultTtl: 3600 };

const RRSETS = [
	{ zone: "example.", name: "example.", type: TYPE.NS, view: null, ttl: null, records: [{ ns: "ns1.example." }], comment: null, source: "manual" },
	{ zone: "example.", name: "gw.example.", type: TYPE.A, view: null, ttl: null, records: [{ address: "10.0.0.1" }], comment: null, source: "manual" }
];

beforeEach(() => {
	setWire(fakeWire);
	fakeWire.calls.length = 0;
});

describe("leaf shape", () => {
	it("each leaf is a plain default-exported function", () => {
		expect(typeof importFile).toBe("function");
		expect(typeof compile).toBe("function");
		expect(typeof exportZone).toBe("function");
		expect(typeof exportSnapshot).toBe("function");
	});
});

describe("after activate — the leaves route through the captured surface", () => {
	it("import.file parses a master file through wire.record.parse", () => {
		const text = "example. 3600 IN SOA ns1.example. host.example. 1 2 3 4 5";
		const out = importFile(text);
		// The fake's record.parse returns one canned apex SOA record; the reader routes it into zone.soa.
		expect(fakeWire.calls.map((c) => c.leaf)).toEqual(["record.parse"]);
		expect(out.zone.name).toBe("example.");
		expect(out.zone.soa).toEqual({ line: text });
		expect(out.rrsets).toEqual([]);
	});

	it("compile compiles a zone through the fake wire", () => {
		const snap = compile(ZONE, RRSETS, null, { now: NOW });
		expect(snap.zone).toBe("example.");
		expect(snap.serial).toBe(2026112501);
		expect(snap.views.all.nodes["gw.example."].rrsets[TYPE.A].records).toEqual([{ address: "10.0.0.1" }]);
	});

	it("export.zone renders through wire.rdata.format", () => {
		const out = exportZone({ name: "example.", soa: SOA });
		expect(out).toBe(`$ORIGIN example.\n@ 3600 SOA rdata(6, ${JSON.stringify(SOA)})\n`);
	});

	it("export.snapshot renders a compiled snapshot through the fake wire", () => {
		const snap = compile(ZONE, RRSETS, null, { now: NOW });
		const out = exportSnapshot(snap);
		const soaLine = `rdata(6, ${JSON.stringify({ ...SOA, serial: snap.serial })})`;
		expect(out).toBe(`$ORIGIN example.\n@ 3600 SOA ${soaLine}\n@ NS rdata(2, ${JSON.stringify({ ns: "ns1.example." })})\ngw A rdata(1, ${JSON.stringify({ address: "10.0.0.1" })})\n`);
	});
});

describe("before activate — no captured surface", () => {
	it("a leaf called before activate throws ZoneError WIRE_NOT_READY", async () => {
		vi.resetModules();
		const freshLeaf = (await import("../../src/api/zones/import/file.mjs")).default;
		const freshCompile = (await import("../../src/api/zones/compile.mjs")).default;
		const freshExportZone = (await import("../../src/api/zones/export/zone.mjs")).default;
		const freshExportSnapshot = (await import("../../src/api/zones/export/snapshot.mjs")).default;
		const { ZoneError: FreshZoneError, ZoneErrorCode: FreshZoneErrorCode } = await import("../../src/lib/errors.mjs");

		let err;
		try {
			freshLeaf("example. 3600 IN SOA ns1.example. host.example. 1 2 3 4 5");
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(FreshZoneError);
		expect(err.code).toBe(FreshZoneErrorCode.WIRE_NOT_READY);

		err = undefined;
		try {
			freshCompile(ZONE, RRSETS);
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(FreshZoneError);
		expect(err.code).toBe(FreshZoneErrorCode.WIRE_NOT_READY);

		err = undefined;
		try {
			freshExportZone(ZONE);
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(FreshZoneError);
		expect(err.code).toBe(FreshZoneErrorCode.WIRE_NOT_READY);

		err = undefined;
		try {
			// A snapshot-shaped value: the exporter checks the SOA and the view resolution before it reaches the
			// seam, so the fixture carries both.
			freshExportSnapshot({ zone: "example.", soa: { records: [SOA] }, views: { all: { nodes: {} } } });
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(FreshZoneError);
		expect(err.code).toBe(FreshZoneErrorCode.WIRE_NOT_READY);
	});
});
