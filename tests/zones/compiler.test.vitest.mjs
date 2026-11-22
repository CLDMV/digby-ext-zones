/**
 *	@Project: @cldmv/digby-ext-zones
 *	@Filename: /tests/zones/compiler.test.vitest.mjs
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
 * @fileoverview The zone compiler's suite: every rule of docs/snapshot.md, fixture-driven. Zone and rrset values are
 * constructed inline as JS values — parsing master-file text is the reader's job, not this suite's. The `date` serial
 * tests pin the clock through `compileZone`'s `now` option so the suite is deterministic.
 */

import { describe, expect, it } from "vitest";
import { compileZone, DEFAULT_TTL, IMPLICIT_VIEW } from "../../src/lib/compiler.mjs";
import { TYPE } from "../../src/lib/codec.mjs";
import { ZoneError, ZoneErrorCode } from "../../src/lib/errors.mjs";

/** 2026-11-22, pinned for every `date` serial test. */
const NOW = new Date(Date.UTC(2026, 10, 22));

const SOA = { mname: "ns1.homelab.cldmv.net.", rname: "host.homelab.cldmv.net.", serial: 2026112200, refresh: 7200, retry: 900, expire: 1209600, minimum: 86400 };

/**
 * A homelab.cldmv.net zone value with overrides.
 * @param {object} [over]
 * @returns {object}
 */
function homelabZone(over = {}) {
	return { name: "homelab.cldmv.net.", kind: "primary", views: ["lan", "tailnet"], soa: SOA, serialPolicy: "date", defaultTtl: 3600, disabled: false, ...over };
}

/**
 * An rrset value in homelab.cldmv.net.
 * @param {string} name
 * @param {string} type
 * @param {unknown[]} records
 * @param {{ view?: string|null, ttl?: number|null, source?: string, comment?: string|null, zone?: string }} [over]
 * @returns {object}
 */
function rr(name, type, records, over = {}) {
	return { zone: over.zone ?? "homelab.cldmv.net.", name, type, view: over.view ?? null, ttl: over.ttl ?? null, records, comment: over.comment ?? null, source: over.source ?? "manual" };
}

const A = (address) => ({ address });
const NS = (ns) => ({ ns });
const PTR = (ptr) => ({ ptr });
const CNAME = (target) => ({ target });

/**
 * Assert `fn` refuses with exactly `code`, and (optionally) carries the context fields.
 * @param {() => unknown} fn
 * @param {string} code
 * @param {{ zone?: string, owner?: string, view?: string|null, type?: string }} [ctx]
 */
function expectRefusal(fn, code, ctx = {}) {
	let err;
	try {
		fn();
	} catch (e) {
		err = e;
	}
	expect(err, `expected a refusal, got a snapshot`).toBeInstanceOf(ZoneError);
	expect(err.code).toBe(code);
	for (const [k, v] of Object.entries(ctx)) expect(err[k], `context ${k}`).toBe(v);
}

/**
 * Assert a value and everything under it is frozen.
 * @param {unknown} v
 */
function assertDeepFrozen(v) {
	if (v === null || typeof v !== "object") return;
	if (v instanceof Uint8Array) return; // typed arrays cannot freeze elements — by convention read-only
	expect(Object.isFrozen(v)).toBe(true);
	for (const k of Object.keys(v)) assertDeepFrozen(v[k]);
}

describe("apex requirements", () => {
	it("refuses a zone with no soa rdata", () => {
		expectRefusal(() => compileZone(homelabZone({ soa: undefined }), [], null, { now: NOW }), ZoneErrorCode.APEX_SOA_REQUIRED, { zone: "homelab.cldmv.net." });
	});

	it("refuses a zone with no NS at its apex", () => {
		expectRefusal(() => compileZone(homelabZone(), [rr("gw.homelab.cldmv.net.", TYPE.A, [A("10.0.0.1")])], null, { now: NOW }), ZoneErrorCode.APEX_NS_REQUIRED, { zone: "homelab.cldmv.net." });
	});

	it("accepts a zone whose apex NS comes from an rrset and synthesizes the SOA from zone.soa", () => {
		const snap = compileZone(homelabZone(), [rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")])], null, { now: NOW });
		expect(snap.soa.records).toEqual([SOA]);
		expect(snap.soa.ttl).toBe(3600);
		expect(snap.views.lan.nodes["homelab.cldmv.net."].rrsets[TYPE.SOA].records).toEqual([SOA]);
	});

	it("ignores SOA-typed rrsets on input (the SOA lives on the zone value)", () => {
		const snap = compileZone(homelabZone(), [rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")]), rr("homelab.cldmv.net.", TYPE.SOA, [{ mname: "evil.", rname: "e.", serial: 1, refresh: 1, retry: 1, expire: 1, minimum: 1 }])], null, { now: NOW });
		expect(snap.soa.records).toEqual([SOA]);
	});
});

describe("zone value validation", () => {
	it("refuses an unknown kind", () => {
		expectRefusal(() => compileZone(homelabZone({ kind: "tertiary" }), [], null, { now: NOW }), ZoneErrorCode.BAD_ZONE);
	});

	it("refuses an unknown serialPolicy", () => {
		expectRefusal(() => compileZone(homelabZone({ serialPolicy: "moon" }), [], null, { now: NOW }), ZoneErrorCode.BAD_SERIAL_POLICY);
	});

	it("refuses duplicate view names", () => {
		expectRefusal(() => compileZone(homelabZone({ views: ["lan", "lan"] }), [], null, { now: NOW }), ZoneErrorCode.BAD_ZONE);
	});

	it("refuses an rrset tagged a view the zone does not list", () => {
		const rs = [rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")]), rr("gw.homelab.cldmv.net.", TYPE.A, [A("10.0.0.1")], { view: "guest" })];
		expectRefusal(() => compileZone(homelabZone(), rs, null, { now: NOW }), ZoneErrorCode.BAD_VIEW, { view: "guest" });
	});

	it("refuses a view tag on a viewless zone", () => {
		const zone = homelabZone({ views: undefined });
		const rs = [rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")], { view: "lan" })];
		expectRefusal(() => compileZone(zone, rs, null, { now: NOW }), ZoneErrorCode.BAD_VIEW);
	});

	it("refuses an rrset outside the zone", () => {
		const rs = [rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")]), rr("other.example.", TYPE.A, [A("10.0.0.1")])];
		expectRefusal(() => compileZone(homelabZone(), rs, null, { now: NOW }), ZoneErrorCode.BAD_OWNER, { owner: "other.example." });
	});

	it("refuses an rrset claiming another zone", () => {
		const rs = [rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")]), rr("gw.homelab.cldmv.net.", TYPE.A, [A("10.0.0.1")], { zone: "other.example." })];
		expectRefusal(() => compileZone(homelabZone(), rs, null, { now: NOW }), ZoneErrorCode.BAD_OWNER);
	});

	it("refuses a bad ttl", () => {
		const rs = [rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")]), rr("gw.homelab.cldmv.net.", TYPE.A, [A("10.0.0.1")], { ttl: -5 })];
		expectRefusal(() => compileZone(homelabZone(), rs, null, { now: NOW }), ZoneErrorCode.BAD_TTL);
	});

	it("refuses an rrset with no records", () => {
		const rs = [rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")]), rr("gw.homelab.cldmv.net.", TYPE.A, [])];
		expectRefusal(() => compileZone(homelabZone(), rs, null, { now: NOW }), ZoneErrorCode.BAD_RECORD);
	});

	it("refuses an unknown source", () => {
		const rs = [rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")]), rr("gw.homelab.cldmv.net.", TYPE.A, [A("10.0.0.1")], { source: "dns" })];
		expectRefusal(() => compileZone(homelabZone(), rs, null, { now: NOW }), ZoneErrorCode.BAD_SOURCE);
	});

	it("refuses a mnemonic string where a type number belongs (types are numeric)", () => {
		const rs = [rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")]), rr("gw.homelab.cldmv.net.", "A", [A("10.0.0.1")])];
		expectRefusal(() => compileZone(homelabZone(), rs, null, { now: NOW }), ZoneErrorCode.BAD_RECORD);
	});

	it("refuses a type number out of the 0-65535 range", () => {
		const rs = [rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")]), rr("gw.homelab.cldmv.net.", 65536, [A("10.0.0.1")])];
		expectRefusal(() => compileZone(homelabZone(), rs, null, { now: NOW }), ZoneErrorCode.BAD_RECORD);
	});
});

describe("wildcards", () => {
	it("accepts a leftmost wildcard and stores it under its literal name", () => {
		const rs = [rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")]), rr("*.labs.homelab.cldmv.net.", TYPE.A, [A("10.0.0.100")])];
		const snap = compileZone(homelabZone(), rs, null, { now: NOW });
		expect(snap.views.lan.nodes["*.labs.homelab.cldmv.net."].rrsets[TYPE.A].records).toEqual([A("10.0.0.100")]);
	});

	it("refuses a `*` in a non-first label", () => {
		const rs = [rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")]), rr("foo.*.homelab.cldmv.net.", TYPE.A, [A("10.0.0.1")])];
		expectRefusal(() => compileZone(homelabZone(), rs, null, { now: NOW }), ZoneErrorCode.BAD_WILDCARD, { owner: "foo.*.homelab.cldmv.net." });
	});

	it("refuses a `*` inside a label", () => {
		const rs = [rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")]), rr("ab*d.homelab.cldmv.net.", TYPE.A, [A("10.0.0.1")])];
		expectRefusal(() => compileZone(homelabZone(), rs, null, { now: NOW }), ZoneErrorCode.BAD_WILDCARD);
	});

	it("refuses a second `*` anywhere", () => {
		const rs = [rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")]), rr("*.*.homelab.cldmv.net.", TYPE.A, [A("10.0.0.1")])];
		expectRefusal(() => compileZone(homelabZone(), rs, null, { now: NOW }), ZoneErrorCode.BAD_WILDCARD);
	});
});

describe("CNAME rules", () => {
	it("refuses a CNAME at the apex", () => {
		const rs = [rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")]), rr("homelab.cldmv.net.", TYPE.CNAME, [CNAME("gw.homelab.cldmv.net.")])];
		expectRefusal(() => compileZone(homelabZone(), rs, null, { now: NOW }), ZoneErrorCode.CNAME_AT_APEX);
	});

	it("refuses a CNAME beside other data in the same view", () => {
		const rs = [
			rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")]),
			rr("app.homelab.cldmv.net.", TYPE.CNAME, [CNAME("gw.homelab.cldmv.net.")], { view: "lan" }),
			rr("app.homelab.cldmv.net.", TYPE.A, [A("10.0.0.2")], { view: "lan" })
		];
		expectRefusal(() => compileZone(homelabZone(), rs, null, { now: NOW }), ZoneErrorCode.CNAME_COEXISTENCE, { view: "lan" });
	});

	it("accepts a CNAME in one view and other data in another", () => {
		const rs = [
			rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")]),
			rr("app.homelab.cldmv.net.", TYPE.CNAME, [CNAME("gw.homelab.cldmv.net.")], { view: "lan" }),
			rr("app.homelab.cldmv.net.", TYPE.A, [A("10.0.0.2")], { view: "tailnet" })
		];
		const snap = compileZone(homelabZone(), rs, null, { now: NOW });
		expect(snap.views.lan.nodes["app.homelab.cldmv.net."].rrsets[TYPE.CNAME].records).toEqual([CNAME("gw.homelab.cldmv.net.")]);
		expect(snap.views.tailnet.nodes["app.homelab.cldmv.net."].rrsets[TYPE.A].records).toEqual([A("10.0.0.2")]);
	});

	it("refuses two CNAME records for one name in one view (merged from two rrsets)", () => {
		const rs = [
			rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")]),
			rr("app.homelab.cldmv.net.", TYPE.CNAME, [CNAME("gw.homelab.cldmv.net.")], { view: null }),
			rr("app.homelab.cldmv.net.", TYPE.CNAME, [CNAME("app2.homelab.cldmv.net.")], { view: "lan" })
		];
		expectRefusal(() => compileZone(homelabZone(), rs, null, { now: NOW }), ZoneErrorCode.CNAME_MULTIPLE);
	});

	it("refuses one CNAME rrset carrying two records", () => {
		const rs = [rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")]), rr("app.homelab.cldmv.net.", TYPE.CNAME, [CNAME("gw.homelab.cldmv.net."), CNAME("app2.homelab.cldmv.net.")])];
		expectRefusal(() => compileZone(homelabZone(), rs, null, { now: NOW }), ZoneErrorCode.CNAME_MULTIPLE);
	});

	it("lets the override precedence resolve an apparent exclusivity conflict (manual CNAME drops the sourced A)", () => {
		const rs = [
			rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")]),
			rr("app.homelab.cldmv.net.", TYPE.A, [A("10.0.0.2")], { view: "lan", source: "machines" }),
			rr("app.homelab.cldmv.net.", TYPE.CNAME, [CNAME("gw.homelab.cldmv.net.")], { view: "lan" })
		];
		const snap = compileZone(homelabZone(), rs, null, { now: NOW });
		const node = snap.views.lan.nodes["app.homelab.cldmv.net."];
		expect(Object.keys(node.rrsets)).toEqual([String(TYPE.CNAME)]);
	});
});

describe("empty non-terminals", () => {
	it("marks a name with no records of its own but with descendants as an ENT", () => {
		const rs = [rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")]), rr("deep.labs.homelab.cldmv.net.", TYPE.A, [A("10.0.0.101")])];
		const snap = compileZone(homelabZone(), rs, null, { now: NOW });
		const labs = snap.views.lan.nodes["labs.homelab.cldmv.net."];
		expect(labs.ent).toBe(true);
		expect(labs.rrsets).toEqual({});
		expect(labs.delegation).toBe(false);
	});

	it("does not mark the apex as an ENT", () => {
		const snap = compileZone(homelabZone(), [rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")])], null, { now: NOW });
		expect(snap.views.lan.nodes["homelab.cldmv.net."].ent).toBe(false);
	});

	it("does not add ENTs at or below a zone cut", () => {
		const rs = [
			rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")]),
			rr("sub.homelab.cldmv.net.", TYPE.NS, [NS("ns1.sub.homelab.cldmv.net.")]),
			rr("x.sub.homelab.cldmv.net.", TYPE.A, [A("10.0.0.54")])
		];
		const snap = compileZone(homelabZone(), rs, null, { now: NOW });
		const x = snap.views.lan.nodes["x.sub.homelab.cldmv.net."];
		expect(x.ent).toBe(false);
		expect(x.glue).toBe(true); // below the cut: glue-only territory, not an ENT
	});
});

describe("delegation and glue", () => {
	const rs = [
		rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")]),
		rr("sub.homelab.cldmv.net.", TYPE.NS, [NS("ns1.sub.homelab.cldmv.net.")], { ttl: 86400 }),
		rr("ns1.sub.homelab.cldmv.net.", TYPE.A, [A("10.0.0.53")], { ttl: 86400 })
	];

	it("marks a non-apex name with NS as a zone cut and keeps its NS served", () => {
		const snap = compileZone(homelabZone(), rs, null, { now: NOW });
		const sub = snap.views.lan.nodes["sub.homelab.cldmv.net."];
		expect(sub.delegation).toBe(true);
		expect(sub.rrsets[TYPE.NS].records).toEqual([NS("ns1.sub.homelab.cldmv.net.")]);
	});

	it("includes the delegation's address records marked as glue", () => {
		const snap = compileZone(homelabZone(), rs, null, { now: NOW });
		const ns1 = snap.views.lan.nodes["ns1.sub.homelab.cldmv.net."];
		expect(ns1.glue).toBe(true); // below the cut: node-level glue
		expect(ns1.rrsets[TYPE.A].records).toEqual([A("10.0.0.53")]);
		expect(ns1.rrsets[TYPE.A].glue).toBeUndefined(); // rrset-level glue is only on A/AAAA AT the cut name
	});

	it("marks A and AAAA glue at the cut name itself", () => {
		const withAddresses = [
			...rs,
			rr("sub.homelab.cldmv.net.", TYPE.A, [A("10.0.0.250")]),
			rr("sub.homelab.cldmv.net.", TYPE.AAAA, [{ address: "fd7a::250" }])
		];
		const snap = compileZone(homelabZone(), withAddresses, null, { now: NOW });
		const sub = snap.views.lan.nodes["sub.homelab.cldmv.net."];
		expect(sub.rrsets[TYPE.A].glue).toBe(true);
		expect(sub.rrsets[TYPE.AAAA].glue).toBe(true);
		expect(sub.rrsets[TYPE.NS].glue).toBeUndefined(); // only addresses are glue
	});

	it("compiles glue per view like any other data", () => {
		const lanOnly = [...rs.slice(0, 2), rr("ns1.sub.homelab.cldmv.net.", TYPE.A, [A("10.0.0.53")], { view: "lan" })];
		const snap = compileZone(homelabZone(), lanOnly, null, { now: NOW });
		expect(snap.views.lan.nodes["ns1.sub.homelab.cldmv.net."].rrsets[TYPE.A].glue).toBe(true);
		expect(snap.views.tailnet.nodes["ns1.sub.homelab.cldmv.net."]).toBeUndefined();
	});
});

describe("per-view compilation and overrides", () => {
	it("propagates view-null rrsets into every view", () => {
		const snap = compileZone(homelabZone(), [rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")]), rr("gw.homelab.cldmv.net.", TYPE.A, [A("10.0.0.1")])], null, { now: NOW });
		for (const view of ["lan", "tailnet"]) {
			expect(snap.views[view].nodes["gw.homelab.cldmv.net."].rrsets[TYPE.A].records).toEqual([A("10.0.0.1")]);
		}
	});

	it("keeps a view-scoped rrset out of the other views", () => {
		const snap = compileZone(homelabZone(), [rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")]), rr("app.homelab.cldmv.net.", TYPE.A, [A("10.0.0.2")], { view: "lan" })], null, { now: NOW });
		expect(snap.views.lan.nodes["app.homelab.cldmv.net."]).toBeDefined();
		expect(snap.views.tailnet.nodes["app.homelab.cldmv.net."]).toBeUndefined();
	});

	it("manual drops the sourced rrset in the same view, and nothing leaks into the other views", () => {
		const rs = [
			rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")]),
			rr("app.homelab.cldmv.net.", TYPE.A, [A("10.0.0.9")], { view: "lan", source: "machines" }),
			rr("app.homelab.cldmv.net.", TYPE.A, [A("10.0.0.2")], { view: "lan", source: "manual" })
		];
		const snap = compileZone(homelabZone(), rs, null, { now: NOW });
		expect(snap.views.lan.nodes["app.homelab.cldmv.net."].rrsets[TYPE.A].records).toEqual([A("10.0.0.2")]);
		expect(snap.views.lan.nodes["app.homelab.cldmv.net."].rrsets[TYPE.A].source).toBe("manual");
		expect(snap.views.tailnet.nodes["app.homelab.cldmv.net."]).toBeUndefined();
	});

	it("a manual record tagged view A does NOT override a sourced record tagged null", () => {
		const rs = [
			rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")]),
			rr("app.homelab.cldmv.net.", TYPE.A, [A("10.0.0.9")], { view: null, source: "machines" }),
			rr("app.homelab.cldmv.net.", TYPE.A, [A("10.0.0.2")], { view: "lan", source: "manual" })
		];
		const snap = compileZone(homelabZone(), rs, null, { now: NOW });
		expect(snap.views.lan.nodes["app.homelab.cldmv.net."].rrsets[TYPE.A].records).toEqual([A("10.0.0.9"), A("10.0.0.2")]);
		expect(snap.views.tailnet.nodes["app.homelab.cldmv.net."].rrsets[TYPE.A].records).toEqual([A("10.0.0.9")]);
	});

	it("a manual record tagged null overrides the sourced record tagged null in every view", () => {
		const rs = [
			rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")]),
			rr("app.homelab.cldmv.net.", TYPE.A, [A("10.0.0.9")], { view: null, source: "machines" }),
			rr("app.homelab.cldmv.net.", TYPE.A, [A("10.0.0.2")], { view: null, source: "manual" })
		];
		const snap = compileZone(homelabZone(), rs, null, { now: NOW });
		for (const view of ["lan", "tailnet"]) {
			expect(snap.views[view].nodes["app.homelab.cldmv.net."].rrsets[TYPE.A].records).toEqual([A("10.0.0.2")]);
		}
	});

	it("a manual record tagged view A does NOT override a sourced record tagged view B", () => {
		const rs = [
			rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")]),
			rr("app.homelab.cldmv.net.", TYPE.A, [A("10.0.0.9")], { view: "tailnet", source: "machines" }),
			rr("app.homelab.cldmv.net.", TYPE.A, [A("10.0.0.2")], { view: "lan", source: "manual" })
		];
		const snap = compileZone(homelabZone(), rs, null, { now: NOW });
		expect(snap.views.lan.nodes["app.homelab.cldmv.net."].rrsets[TYPE.A].records).toEqual([A("10.0.0.2")]);
		expect(snap.views.tailnet.nodes["app.homelab.cldmv.net."].rrsets[TYPE.A].records).toEqual([A("10.0.0.9")]);
	});

	it("merges surviving same-name+type rrsets: records concatenate, first explicit ttl wins, first comment wins", () => {
		const rs = [
			rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")]),
			rr("pool.homelab.cldmv.net.", TYPE.A, [A("10.0.0.10")], { view: null, ttl: 120, comment: "from machines" }),
			rr("pool.homelab.cldmv.net.", TYPE.A, [A("10.0.0.11")], { view: "lan", comment: "lan box" })
		];
		const snap = compileZone(homelabZone(), rs, null, { now: NOW });
		const pool = snap.views.lan.nodes["pool.homelab.cldmv.net."].rrsets[TYPE.A];
		expect(pool.records).toEqual([A("10.0.0.10"), A("10.0.0.11")]);
		expect(pool.ttl).toBe(120);
		expect(pool.comment).toBe("from machines");
	});

	it("uses the zone defaultTtl for rrsets with a null ttl", () => {
		const snap = compileZone(homelabZone({ defaultTtl: 900 }), [rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")]), rr("gw.homelab.cldmv.net.", TYPE.A, [A("10.0.0.1")], { ttl: null })], null, { now: NOW });
		expect(snap.views.lan.nodes["gw.homelab.cldmv.net."].rrsets[TYPE.A].ttl).toBe(900);
		expect(DEFAULT_TTL).toBe(3600); // the fallback when the zone has no defaultTtl either
	});

	it("folds owner-name case: one node per case-insensitive name", () => {
		const rs = [
			rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")]),
			rr("App.HOMELAB.cldmv.net.", TYPE.A, [A("10.0.0.2")]),
			rr("app.homelab.cldmv.net.", TYPE.A, [A("10.0.0.9")])
		];
		const snap = compileZone(homelabZone(), rs, null, { now: NOW });
		const node = snap.views.lan.nodes["app.homelab.cldmv.net."];
		expect(node.rrsets[TYPE.A].records).toEqual([A("10.0.0.2"), A("10.0.0.9")]);
		expect(Object.keys(snap.views.lan.nodes).filter((k) => k.startsWith("app."))).toEqual(["app.homelab.cldmv.net."]);
	});

	it("compiles a viewless zone into the single implicit view", () => {
		const zone = homelabZone({ views: undefined });
		const snap = compileZone(zone, [rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")]), rr("gw.homelab.cldmv.net.", TYPE.A, [A("10.0.0.1")])], null, { now: NOW });
		expect(Object.keys(snap.views)).toEqual([IMPLICIT_VIEW]);
		expect(snap.views[IMPLICIT_VIEW].nodes["gw.homelab.cldmv.net."].rrsets[TYPE.A].records).toEqual([A("10.0.0.1")]);
	});
});

describe("serial", () => {
	const base = [rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")]), rr("gw.homelab.cldmv.net.", TYPE.A, [A("10.0.0.1")])];

	it("date policy: first compile is YYYYMMDD01 for the pinned day", () => {
		const snap = compileZone(homelabZone(), base, null, { now: NOW });
		expect(snap.serial).toBe(2026112201);
	});

	it("date policy: same day as the previous serial bumps NN", () => {
		const first = compileZone(homelabZone(), base, null, { now: NOW });
		const again = compileZone(homelabZone(), [...base, rr("app.homelab.cldmv.net.", TYPE.A, [A("10.0.0.2")])], first, { now: NOW });
		expect(again.serial).toBe(2026112202);
	});

	it("date policy: a previous serial from another day starts today at 01", () => {
		const previous = { serial: 2026112107, views: {} };
		const snap = compileZone(homelabZone(), base, previous, { now: NOW });
		expect(snap.serial).toBe(2026112201);
	});

	it("date policy: NN saturating at 99 rolls to tomorrow at 01", () => {
		const previous = { serial: 2026112299, views: {} };
		const snap = compileZone(homelabZone(), [...base, rr("app.homelab.cldmv.net.", TYPE.A, [A("10.0.0.2")])], previous, { now: NOW });
		expect(snap.serial).toBe(2026112301);
	});

	it("date policy: monotonic guard — a candidate at or below the previous serial becomes previous + 1", () => {
		const previous = { serial: 2027010101, views: {} }; // a serial from the future relative to the pinned clock
		const snap = compileZone(homelabZone(), [...base, rr("app.homelab.cldmv.net.", TYPE.A, [A("10.0.0.2")])], previous, { now: NOW });
		expect(snap.serial).toBe(2027010102);
	});

	it("increment policy: previous + 1, and 1 with no previous", () => {
		const zone = homelabZone({ serialPolicy: "increment" });
		expect(compileZone(zone, base, null, { now: NOW }).serial).toBe(1);
		const first = compileZone(zone, base, null, { now: NOW });
		expect(compileZone(zone, [...base, rr("app.homelab.cldmv.net.", TYPE.A, [A("10.0.0.2")])], first, { now: NOW }).serial).toBe(2);
	});

	it("no bump when the content is unchanged", () => {
		const first = compileZone(homelabZone(), base, null, { now: NOW });
		const again = compileZone(homelabZone(), [...base], first, { now: NOW });
		expect(again.serial).toBe(first.serial);
	});

	it("bumps when a record's ttl changes", () => {
		const first = compileZone(homelabZone(), base, null, { now: NOW });
		const changed = [base[0], rr("gw.homelab.cldmv.net.", TYPE.A, [A("10.0.0.1")], { ttl: 60 })];
		expect(compileZone(homelabZone(), changed, first, { now: NOW }).serial).toBe(first.serial + 1);
	});

	it("bumps when a record's rdata changes", () => {
		const first = compileZone(homelabZone(), base, null, { now: NOW });
		const changed = [base[0], rr("gw.homelab.cldmv.net.", TYPE.A, [A("10.0.0.254")])];
		expect(compileZone(homelabZone(), changed, first, { now: NOW }).serial).toBe(first.serial + 1);
	});

	it("bumps when a record is added or removed, or a view's membership changes", () => {
		const first = compileZone(homelabZone(), base, null, { now: NOW });
		const removed = [base[0]];
		expect(compileZone(homelabZone(), removed, first, { now: NOW }).serial).toBe(first.serial + 1);
	});

	it("no bump on a comment-only change", () => {
		const first = compileZone(homelabZone(), base, null, { now: NOW });
		const commented = [base[0], rr("gw.homelab.cldmv.net.", TYPE.A, [A("10.0.0.1")], { comment: "the gateway" })];
		const again = compileZone(homelabZone(), commented, first, { now: NOW });
		expect(again.serial).toBe(first.serial);
		expect(again.views.lan.nodes["gw.homelab.cldmv.net."].rrsets[TYPE.A].comment).toBe("the gateway");
	});

	it("serial is per zone, so a change in ANY view bumps it once", () => {
		const first = compileZone(homelabZone(), base, null, { now: NOW });
		const tailnetChange = [...base, rr("app.homelab.cldmv.net.", TYPE.A, [A("10.0.0.2")], { view: "tailnet" })];
		expect(compileZone(homelabZone(), tailnetChange, first, { now: NOW }).serial).toBe(first.serial + 1);
	});
});

describe("disabled zones", () => {
	it("compile to a snapshot marked disabled with no content, serial standing still", () => {
		const previous = { serial: 2026112207, views: {} };
		const snap = compileZone(homelabZone({ disabled: true }), [rr("gw.homelab.cldmv.net.", TYPE.A, [A("10.0.0.1")])], previous, { now: NOW });
		expect(snap.disabled).toBe(true);
		expect(snap.views).toEqual({});
		expect(snap.soa).toBeNull();
		expect(snap.serial).toBe(2026112207);
	});

	it("first compile of a disabled zone uses the policy base", () => {
		const snap = compileZone(homelabZone({ disabled: true, serialPolicy: "increment" }), [], null, { now: NOW });
		expect(snap.serial).toBe(1);
	});
});

describe("freezing", () => {
	it("deep-freezes the snapshot", () => {
		const snap = compileZone(homelabZone(), [rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")]), rr("gw.homelab.cldmv.net.", TYPE.A, [A("10.0.0.1")])], null, { now: NOW });
		assertDeepFrozen(snap);
	});

	it("mutating the snapshot throws (the suite runs strict)", () => {
		const snap = compileZone(homelabZone(), [rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")])], null, { now: NOW });
		expect(() => { snap.serial = 1; }).toThrow(TypeError);
		expect(() => { snap.views.lan.nodes["homelab.cldmv.net."].rrsets[TYPE.NS].records.push(NS("evil.")); }).toThrow(TypeError);
	});
});

describe("fixture: homelab.cldmv.net", () => {
	const zone = homelabZone();
	const rrsets = [
		rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net."), NS("ns2.homelab.cldmv.net.")], { ttl: 86400 }),
		rr("gw.homelab.cldmv.net.", TYPE.A, [A("10.0.0.1")]),
		rr("app.homelab.cldmv.net.", TYPE.A, [A("10.0.0.2")], { view: "lan", ttl: 300, source: "manual", comment: "app box" }),
		rr("app.homelab.cldmv.net.", TYPE.A, [A("10.0.0.9")], { source: "machines" }),
		rr("sub.homelab.cldmv.net.", TYPE.NS, [NS("ns1.sub.homelab.cldmv.net.")], { ttl: 86400 }),
		rr("ns1.sub.homelab.cldmv.net.", TYPE.A, [A("10.0.0.53")], { ttl: 86400 }),
		rr("*.labs.homelab.cldmv.net.", TYPE.A, [A("10.0.0.100")]),
		rr("deep.labs.homelab.cldmv.net.", TYPE.A, [A("10.0.0.101")])
	];

	const snap = compileZone(zone, rrsets, null, { now: NOW });

	it("carries the zone metadata", () => {
		expect(snap.zone).toBe("homelab.cldmv.net.");
		expect(snap.kind).toBe("primary");
		expect(snap.disabled).toBe(false);
		expect(snap.serial).toBe(2026112201);
		expect(snap.defaultTtl).toBe(3600);
		expect(Object.keys(snap.views)).toEqual(["lan", "tailnet"]); // sorted
	});

	it("serves the apex SOA and NS in every view", () => {
		for (const view of ["lan", "tailnet"]) {
			const apex = snap.views[view].nodes["homelab.cldmv.net."];
			expect(apex.rrsets[TYPE.SOA].records).toEqual([SOA]);
			expect(apex.rrsets[TYPE.NS].records).toEqual([NS("ns1.homelab.cldmv.net."), NS("ns2.homelab.cldmv.net.")]);
		}
	});

	it("compiles the lan view with the manual+machines coexistence, the delegation, glue, wildcard and ENT", () => {
		const lan = snap.views.lan.nodes;
		expect(lan["app.homelab.cldmv.net."].rrsets[TYPE.A].records).toEqual([A("10.0.0.2"), A("10.0.0.9")]);
		expect(lan["app.homelab.cldmv.net."].rrsets[TYPE.A].source).toBe("manual");
		expect(lan["sub.homelab.cldmv.net."].delegation).toBe(true);
		expect(lan["ns1.sub.homelab.cldmv.net."].rrsets[TYPE.A].glue).toBe(true);
		expect(lan["*.labs.homelab.cldmv.net."].rrsets[TYPE.A].records).toEqual([A("10.0.0.100")]);
		expect(lan["labs.homelab.cldmv.net."].ent).toBe(true);
		expect(lan["gw.homelab.cldmv.net."].rrsets[TYPE.A].ttl).toBe(3600);
	});

	it("compiles the tailnet view without the lan-scoped manual record", () => {
		const tailnet = snap.views.tailnet.nodes;
		expect(tailnet["app.homelab.cldmv.net."].rrsets[TYPE.A].records).toEqual([A("10.0.0.9")]);
		expect(tailnet["app.homelab.cldmv.net."].rrsets[TYPE.A].source).toBe("machines");
		expect(tailnet["sub.homelab.cldmv.net."].delegation).toBe(true);
		expect(tailnet["labs.homelab.cldmv.net."].ent).toBe(true);
	});
});

describe("fixture: reverse zones", () => {
	const soa0 = { mname: "ns1.homelab.cldmv.net.", rname: "host.homelab.cldmv.net.", serial: 2026112200, refresh: 7200, retry: 900, expire: 1209600, minimum: 86400 };

	it("compiles 0.0.10.in-addr.arpa with PTR records into the implicit view", () => {
		const zone = { name: "0.0.10.in-addr.arpa.", kind: "primary", soa: soa0, serialPolicy: "date", defaultTtl: 3600, disabled: false };
		const rrsets = [
			rr("0.0.10.in-addr.arpa.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")], { zone: "0.0.10.in-addr.arpa." }),
			rr("1.0.0.10.in-addr.arpa.", TYPE.PTR, [PTR("gw.homelab.cldmv.net.")], { zone: "0.0.10.in-addr.arpa." }),
			rr("2.0.0.10.in-addr.arpa.", TYPE.PTR, [PTR("app.homelab.cldmv.net.")], { zone: "0.0.10.in-addr.arpa." })
		];
		const snap = compileZone(zone, rrsets, null, { now: NOW });
		expect(snap.zone).toBe("0.0.10.in-addr.arpa.");
		expect(snap.serial).toBe(2026112201);
		const nodes = snap.views[IMPLICIT_VIEW].nodes;
		expect(nodes["1.0.0.10.in-addr.arpa."].rrsets[TYPE.PTR].records).toEqual([PTR("gw.homelab.cldmv.net.")]);
		expect(nodes["2.0.0.10.in-addr.arpa."].rrsets[TYPE.PTR].records).toEqual([PTR("app.homelab.cldmv.net.")]);
		expect(nodes["0.0.10.in-addr.arpa."].rrsets[TYPE.SOA].records).toEqual([soa0]);
	});

	it("compiles 1.0.10.in-addr.arpa independently with its own contents", () => {
		const zone = { name: "1.0.10.in-addr.arpa.", kind: "primary", soa: soa0, serialPolicy: "date", defaultTtl: 3600, disabled: false };
		const rrsets = [
			rr("1.0.10.in-addr.arpa.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")], { zone: "1.0.10.in-addr.arpa." }),
			rr("1.0.1.10.in-addr.arpa.", TYPE.PTR, [PTR("upstairs.homelab.cldmv.net.")], { zone: "1.0.10.in-addr.arpa." })
		];
		const snap = compileZone(zone, rrsets, null, { now: NOW });
		const nodes = snap.views[IMPLICIT_VIEW].nodes;
		expect(nodes["1.0.1.10.in-addr.arpa."].rrsets[TYPE.PTR].records).toEqual([PTR("upstairs.homelab.cldmv.net.")]);
		expect(nodes["1.0.10.in-addr.arpa."].rrsets[TYPE.SOA].records).toEqual([soa0]);
		expect(nodes["1.0.0.10.in-addr.arpa."]).toBeUndefined(); // belongs to the other reverse zone
	});

	it("an out-of-zone PTR is refused", () => {
		const zone = { name: "1.0.10.in-addr.arpa.", kind: "primary", soa: soa0, serialPolicy: "date", defaultTtl: 3600, disabled: false };
		const rrsets = [rr("1.0.10.in-addr.arpa.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")], { zone: "1.0.10.in-addr.arpa." }), rr("2.0.0.10.in-addr.arpa.", TYPE.PTR, [PTR("x.homelab.cldmv.net.")])];
		expectRefusal(() => compileZone(zone, rrsets, null, { now: NOW }), ZoneErrorCode.BAD_OWNER);
	});
});
