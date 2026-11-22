/**
 *	@Project: @cldmv/digby-ext-zones
 *	@Filename: /tests/zones/export.test.vitest.mjs
 *	@Date: 2026-11-22T10:10:00-08:00 (1795370100)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-22T10:10:00-08:00
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Tests for the master-file exporter (`src/lib/export.mjs`): zone + rrset values and compiled snapshots back
 * to RFC 1035 master-file text that the reader parses back. The round-trip is the oracle — `parseZoneFile(exportZone(...))`
 * deep-equals the input values, and `compileZone` over the re-parsed snapshot text reproduces the original snapshot's views
 * with the serial standing still. The minimal-faithful forms ($TTL, TTL omission, relative owners) are asserted on the text.
 */

import { describe, expect, it } from "vitest";
import { compileZone } from "../../src/lib/compiler.mjs";
import { TYPE, WireError } from "../../src/lib/codec.mjs";
import { exportSnapshot, exportZone } from "../../src/lib/export.mjs";
import { ZoneError, ZoneErrorCode } from "../../src/lib/errors.mjs";
import { parseZoneFile } from "../../src/lib/reader.mjs";

const enc = (s) => new TextEncoder().encode(s);

/** 2026-11-22, pinned so the `date` serial policy is deterministic. */
const NOW = new Date(Date.UTC(2026, 10, 22));

/**
 * Run `fn` and return the ZoneError it raises, asserting its code (and context fields when given).
 * @param {() => unknown} fn
 * @param {string} code
 * @param {{ zone?: string, owner?: string, view?: string|null }} [ctx]
 * @returns {ZoneError}
 */
function zoneError(fn, code, ctx = {}) {
	let err;
	try {
		fn();
	} catch (e) {
		err = e;
	}
	expect(err, "expected a ZoneError").toBeInstanceOf(ZoneError);
	expect(err.code).toBe(code);
	for (const [k, v] of Object.entries(ctx)) expect(err[k], `context ${k}`).toBe(v);
	return err;
}

/**
 * Run `fn` and return the WireError it raises (failing the test when nothing, or something else, is thrown).
 * @param {() => unknown} fn
 * @returns {WireError}
 */
function wireError(fn) {
	let err;
	try {
		fn();
	} catch (e) {
		err = e;
	}
	expect(err, "expected a WireError").toBeInstanceOf(WireError);
	return err;
}

/**
 * An rrset value in the homelab.cldmv.net fixture zone, mirroring the reader's output shape.
 * @param {string} name
 * @param {number} type
 * @param {object[]} records
 * @param {{ ttl?: number|null, comment?: string|null, zone?: string, view?: string|null, source?: string }} [over]
 * @returns {object}
 */
function rr(name, type, records, over = {}) {
	return { zone: over.zone ?? "homelab.cldmv.net.", name, type, view: over.view ?? null, ttl: over.ttl !== undefined ? over.ttl : 3600, records, comment: over.comment ?? null, source: over.source ?? "manual" };
}

const HOMELAB_ZONE = {
	name: "homelab.cldmv.net.",
	kind: "primary",
	views: [],
	soa: { mname: "ns1.homelab.cldmv.net.", rname: "admin.cldmv.net.", serial: 2026112201, refresh: 7200, retry: 900, expire: 1209600, minimum: 86400 },
	defaultTtl: 3600
};

/** The reader's homelab fixture, as parsed rrset values (the reader test's expected output, verbatim). */
const HOMELAB_RRSETS = [
	rr("homelab.cldmv.net.", TYPE.NS, [{ target: "ns1.homelab.cldmv.net." }, { target: "ns2.cldmv.net." }], { comment: "the primary" }),
	rr("ns1.homelab.cldmv.net.", TYPE.A, [{ address: "192.168.10.2" }]),
	rr("ns2.homelab.cldmv.net.", TYPE.A, [{ address: "192.168.10.3" }]),
	rr("homelab.cldmv.net.", TYPE.A, [{ address: "192.168.10.1" }]),
	rr("homelab.cldmv.net.", TYPE.AAAA, [{ address: "fd00:10::1" }]),
	rr("www.homelab.cldmv.net.", TYPE.A, [{ address: "192.168.10.1" }, { address: "192.168.10.11" }], { ttl: 300 }),
	rr("homelab.cldmv.net.", TYPE.MX, [
		{ preference: 10, exchange: "mail.homelab.cldmv.net." },
		{ preference: 20, exchange: "mail.cldmv.net." }
	]),
	rr("mail.homelab.cldmv.net.", TYPE.A, [{ address: "192.168.10.25" }], { comment: "the mail host" }),
	rr("mail.homelab.cldmv.net.", TYPE.TXT, [{ strings: [enc("v=spf1 mx -all")] }]),
	rr("_dmarc.homelab.cldmv.net.", TYPE.TXT, [{ strings: [enc("v=DMARC1; p=none"), enc("rua=mailto:dmarc@cldmv.net")] }]),
	rr("gw.homelab.cldmv.net.", TYPE.A, [{ address: "192.168.10.254" }], { ttl: 1800 }),
	rr("router\\.point.homelab.cldmv.net.", TYPE.A, [{ address: "192.168.10.9" }]),
	rr("helper.homelab.cldmv.net.", TYPE.CNAME, [{ target: "www.homelab.cldmv.net." }]),
	rr("lab.homelab.cldmv.net.", TYPE.NS, [{ target: "ns1.lab.homelab.cldmv.net." }]),
	rr("ns1.lab.homelab.cldmv.net.", TYPE.A, [{ address: "192.168.10.20" }]),
	rr("*.dev.homelab.cldmv.net.", TYPE.A, [{ address: "192.168.10.40" }]),
	rr("10.10.168.192.in-addr.arpa.", TYPE.PTR, [{ target: "ns1.homelab.cldmv.net." }]),
	rr("10.11.168.192.in-addr.arpa.", TYPE.PTR, [{ target: "mail.cldmv.net." }])
];

const QUACK_ZONE = {
	name: "quack.shellback.net.",
	kind: "primary",
	views: [],
	soa: { mname: "ns.quack.shellback.net.", rname: "hostmaster.quack.shellback.net.", serial: 1, refresh: 7200, retry: 900, expire: 1209600, minimum: 300 },
	defaultTtl: 300
};

const QUACK_RRSETS = [
	rr("quack.shellback.net.", TYPE.NS, [{ target: "ns.quack.shellback.net." }], { zone: "quack.shellback.net.", ttl: 300 })
];

/**
 * The two reverse zones of the compiler's fixture, as zone + rrset values.
 * @param {string} name
 * @param {object[]} entries - `[ownerName, type, records]` triples
 * @returns {{ zone: object, rrsets: object[] }}
 */
function reverseZone(name, entries) {
	const soa = { mname: "ns1.homelab.cldmv.net.", rname: "host.homelab.cldmv.net.", serial: 2026112201, refresh: 7200, retry: 900, expire: 1209600, minimum: 86400 };
	return {
		zone: { name, kind: "primary", views: [], soa, defaultTtl: 3600 },
		rrsets: entries.map(([owner, type, records]) => rr(owner, type, records, { zone: name }))
	};
}

const REV0 = reverseZone("0.0.10.in-addr.arpa.", [
	["0.0.10.in-addr.arpa.", TYPE.NS, [{ target: "ns1.homelab.cldmv.net." }]],
	["1.0.0.10.in-addr.arpa.", TYPE.PTR, [{ target: "gw.homelab.cldmv.net." }]],
	["2.0.0.10.in-addr.arpa.", TYPE.PTR, [{ target: "app.homelab.cldmv.net." }]]
]);

const REV1 = reverseZone("1.0.10.in-addr.arpa.", [
	["1.0.10.in-addr.arpa.", TYPE.NS, [{ target: "ns1.homelab.cldmv.net." }]],
	["1.0.1.10.in-addr.arpa.", TYPE.PTR, [{ target: "upstairs.homelab.cldmv.net." }]]
]);

// ---------------------------------------------------------------------------
// exportSnapshot fixtures
// ---------------------------------------------------------------------------

/**
 * A homelab.cldmv.net zone value for the snapshot fixtures. The SOA's serial is 2026112201 — the serial the first
 * `date`-policy compile yields for the pinned day — so the snapshot's serial and its SOA rdata's serial agree and the
 * exported text round-trips with the serial standing still.
 * @param {object} [over]
 * @returns {object}
 */
function snapshotZone(over = {}) {
	return {
		name: "homelab.cldmv.net.",
		kind: "primary",
		views: ["lan", "tailnet"],
		soa: { mname: "ns1.homelab.cldmv.net.", rname: "host.homelab.cldmv.net.", serial: 2026112201, refresh: 7200, retry: 900, expire: 1209600, minimum: 86400 },
		serialPolicy: "date",
		defaultTtl: 3600,
		disabled: false,
		...over
	};
}

const NS = (target) => ({ target });
const A = (address) => ({ address });

const SNAPSHOT_RRSETS = [
	rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net."), NS("ns2.cldmv.net.")], { ttl: 86400 }),
	rr("gw.homelab.cldmv.net.", TYPE.A, [A("10.0.0.1")], { ttl: null }),
	rr("app.homelab.cldmv.net.", TYPE.A, [A("10.0.0.2")], { ttl: 300, comment: "app box", view: "lan" }),
	rr("sub.homelab.cldmv.net.", TYPE.NS, [NS("ns1.sub.homelab.cldmv.net.")], { ttl: 86400 }),
	rr("sub.homelab.cldmv.net.", TYPE.A, [A("10.0.0.250")]),
	rr("ns1.sub.homelab.cldmv.net.", TYPE.A, [A("10.0.0.53")], { ttl: 86400 }),
	rr("*.labs.homelab.cldmv.net.", TYPE.A, [A("10.0.0.100")]),
	rr("deep.labs.homelab.cldmv.net.", TYPE.A, [A("10.0.0.101")])
];

/** The compiled two-view snapshot, serial and SOA rdata aligned on 2026112201. */
const SNAPSHOT = compileZone(snapshotZone(), SNAPSHOT_RRSETS, null, { now: NOW });

/** The snapshot rrsets with the lan-tagged record dropped — the input for the viewless fixtures (a viewless zone refuses view tags). */
const VIEWLESS_RRSETS = SNAPSHOT_RRSETS.filter((r) => r.view === null);

// ---------------------------------------------------------------------------
// Round-trips
// ---------------------------------------------------------------------------

describe("exportZone → parseZoneFile round-trips", () => {
	it("reproduces the homelab.cldmv.net fixture exactly (zone and rrsets)", () => {
		const text = exportZone(HOMELAB_ZONE, HOMELAB_RRSETS);
		const back = parseZoneFile(text);
		expect(back.zone).toEqual(HOMELAB_ZONE);
		expect(back.rrsets).toEqual(HOMELAB_RRSETS);
	});

	it("reproduces the empty quack.shellback.net (SOA and NS only)", () => {
		const back = parseZoneFile(exportZone(QUACK_ZONE, QUACK_RRSETS));
		expect(back.zone).toEqual(QUACK_ZONE);
		expect(back.rrsets).toEqual(QUACK_RRSETS);
	});

	it("reproduces the two reverse zones independently (PTR records)", () => {
		for (const { zone, rrsets } of [REV0, REV1]) {
			const back = parseZoneFile(exportZone(zone, rrsets));
			expect(back.zone).toEqual(zone);
			expect(back.rrsets).toEqual(rrsets);
		}
	});

	it("preserves comments on the group's first line through the round-trip", () => {
		const rrsets = [
			rr("homelab.cldmv.net.", TYPE.NS, [NS("ns1.homelab.cldmv.net.")]),
			rr("a.homelab.cldmv.net.", TYPE.A, [A("10.0.0.1")], { comment: "the first" }),
			rr("b.homelab.cldmv.net.", TYPE.TXT, [{ strings: [enc("note")] }], { comment: "spelled ; carefully" })
		];
		const back = parseZoneFile(exportZone(HOMELAB_ZONE, rrsets));
		expect(back.rrsets.map((r) => r.comment)).toEqual([null, "the first", "spelled ; carefully"]);
	});
});

describe("minimal-faithful forms", () => {
	it("emits $ORIGIN once, $TTL when the default differs from the SOA minimum, and the SOA first with an explicit TTL", () => {
		const lines = exportZone(HOMELAB_ZONE, HOMELAB_RRSETS).split("\n");
		expect(lines[0]).toBe("$ORIGIN homelab.cldmv.net.");
		expect(lines[1]).toBe("$TTL 3600");
		expect(lines[2]).toBe("@ 3600 SOA ns1.homelab.cldmv.net. admin.cldmv.net. 2026112201 7200 900 1209600 86400");
		expect(lines[3]).toBe("@ NS ns1.homelab.cldmv.net. ; the primary");
		expect(lines[4]).toBe("@ NS ns2.cldmv.net.");
	});

	it("omits a record's TTL when it equals the zone default, and keeps it when it differs", () => {
		const lines = new Set(exportZone(HOMELAB_ZONE, HOMELAB_RRSETS).split("\n"));
		expect(lines.has("ns1 A 192.168.10.2")).toBe(true); // 3600 = defaultTtl: no ttl token
		expect(lines.has("www 300 A 192.168.10.1")).toBe(true); // 300: explicit
		expect(lines.has("gw 1800 A 192.168.10.254")).toBe(true); // 1800 (30m): explicit
	});

	it("emits no $TTL when the default equals the SOA minimum (the reader derives it), and the round-trip still holds", () => {
		const text = exportZone(QUACK_ZONE, QUACK_RRSETS);
		expect(text.includes("$TTL")).toBe(false);
		const lines = text.split("\n");
		expect(lines[0]).toBe("$ORIGIN quack.shellback.net.");
		expect(lines[1]).toBe("@ 300 SOA ns.quack.shellback.net. hostmaster.quack.shellback.net. 1 7200 900 1209600 300");
		expect(lines[2]).toBe("@ NS ns.quack.shellback.net.");
		const back = parseZoneFile(text);
		expect(back.zone).toEqual(QUACK_ZONE);
		expect(back.rrsets).toEqual(QUACK_RRSETS);
	});

	it("emits relative owners: @ for the apex, the prefix form below it, escapes intact; absolute elsewhere", () => {
		const lines = new Set(exportZone(HOMELAB_ZONE, HOMELAB_RRSETS).split("\n"));
		expect(lines.has("@ A 192.168.10.1")).toBe(true); // apex owner
		expect(lines.has("router\\.point A 192.168.10.9")).toBe(true); // a label holding an escaped dot
		expect(lines.has("*.dev A 192.168.10.40")).toBe(true); // wildcard prefix
		expect(lines.has("ns1.lab A 192.168.10.20")).toBe(true); // multi-label prefix
		expect(lines.has("10.10.168.192.in-addr.arpa. PTR ns1.homelab.cldmv.net.")).toBe(true); // out-of-zone: absolute
	});

	it("keeps the absolute form when the owner's suffix spelling differs in case from the zone name", () => {
		const zone = { ...HOMELAB_ZONE };
		const rrsets = [rr("www.HOMELAB.cldmv.net.", TYPE.A, [A("10.0.0.7")])];
		const text = exportZone(zone, rrsets);
		expect(text.includes("www.HOMELAB.cldmv.net. A 10.0.0.7")).toBe(true);
		const back = parseZoneFile(text);
		expect(back.rrsets).toEqual(rrsets);
	});
});

describe("exportZone refusals", () => {
	it("refuses an rrset tagged with a view — a master file has no views", () => {
		const rrsets = [{ ...HOMELAB_RRSETS[1], view: "lan" }];
		zoneError(() => exportZone(HOMELAB_ZONE, rrsets), ZoneErrorCode.BAD_VIEW, { view: "lan" });
	});

	it("refuses a zone without soa rdata", () => {
		zoneError(() => exportZone({ name: "x.test.", kind: "primary", views: [] }, []), ZoneErrorCode.APEX_SOA_REQUIRED, { zone: "x.test." });
	});

	it("refuses a non-numeric type, a bad ttl, and an rrset with no records", () => {
		zoneError(() => exportZone(HOMELAB_ZONE, [rr("a.x.test.", "A", [A("10.0.0.1")])]), ZoneErrorCode.BAD_RECORD);
		zoneError(() => exportZone(HOMELAB_ZONE, [rr("a.x.test.", TYPE.A, [A("10.0.0.1")], { ttl: -1 })]), ZoneErrorCode.BAD_TTL);
		zoneError(() => exportZone(HOMELAB_ZONE, [rr("a.x.test.", TYPE.A, [])]), ZoneErrorCode.BAD_RECORD);
	});

	it("surfaces the codec's WireError untouched for rdata its formatter refuses", () => {
		const err = wireError(() => exportZone(HOMELAB_ZONE, [rr("a.x.test.", TYPE.A, [{ address: "not-an-ip" }])]));
		expect(err.name).toBe("WireError"); // not a ZoneError — the codec's own refusal, undecorated
		expect(err.message).toMatch(/not an IPv4 address/);
	});
});

// ---------------------------------------------------------------------------
// exportSnapshot
// ---------------------------------------------------------------------------

describe("exportSnapshot: per-view text", () => {
	it("exports the lan view: apex first with the serial inlined, then the nodes in key order", () => {
		const text = exportSnapshot(SNAPSHOT, { view: "lan" });
		const lines = text.split("\n");
		const set = new Set(lines);
		expect(lines[0]).toBe("$ORIGIN homelab.cldmv.net.");
		expect(lines[1]).toBe("$TTL 3600");
		expect(lines[2]).toBe("@ 3600 SOA ns1.homelab.cldmv.net. host.homelab.cldmv.net. 2026112201 7200 900 1209600 86400");
		expect(lines[3]).toBe("@ 86400 NS ns1.homelab.cldmv.net.");
		expect(lines[4]).toBe("@ 86400 NS ns2.cldmv.net.");
		expect(set.has("app 300 A 10.0.0.2 ; app box")).toBe(true);
		expect(set.has("gw A 10.0.0.1")).toBe(true); // ttl null on input: the zone default, so no token
		expect(set.has("sub 86400 NS ns1.sub.homelab.cldmv.net.")).toBe(true); // the delegation's NS
		expect(set.has("sub A 10.0.0.250")).toBe(true); // glue at the cut name
		expect(set.has("ns1.sub 86400 A 10.0.0.53")).toBe(true); // glue below the cut
		expect(set.has("*.labs A 10.0.0.100")).toBe(true);
	});

	it("emits nothing for ENT nodes", () => {
		const text = exportSnapshot(SNAPSHOT, { view: "lan" });
		expect(text.split("\n").some((l) => l.startsWith("labs"))).toBe(false);
		const { rrsets } = parseZoneFile(text);
		expect(rrsets.some((r) => r.name === "labs.homelab.cldmv.net.")).toBe(false);
	});

	it("exports each view separately, and the views' texts differ where their data differs", () => {
		const lan = exportSnapshot(SNAPSHOT, { view: "lan" });
		const tailnet = exportSnapshot(SNAPSHOT, { view: "tailnet" });
		expect(lan === tailnet).toBe(false);
		expect(lan.includes("app 300 A 10.0.0.2")).toBe(true);
		expect(tailnet.includes("app ")).toBe(false);
	});

	it("defaults to the single implicit view of a viewless zone", () => {
		const snap = compileZone(snapshotZone({ views: undefined }), VIEWLESS_RRSETS, null, { now: NOW });
		const text = exportSnapshot(snap); // no view given
		const lines = new Set(text.split("\n"));
		expect(lines.has("gw A 10.0.0.1")).toBe(true);
	});

	it("refuses a multi-view snapshot with no explicit view, an unknown view, and a disabled snapshot", () => {
		zoneError(() => exportSnapshot(SNAPSHOT), ZoneErrorCode.BAD_ZONE, { zone: "homelab.cldmv.net." });
		zoneError(() => exportSnapshot(SNAPSHOT, { view: "guest" }), ZoneErrorCode.BAD_ZONE);
		const disabled = compileZone(snapshotZone({ disabled: true }), SNAPSHOT_RRSETS, null, { now: NOW });
		zoneError(() => exportSnapshot(disabled, { view: "lan" }), ZoneErrorCode.BAD_ZONE, { zone: "homelab.cldmv.net." });
	});
});

describe("exportSnapshot → parse → compile round-trips", () => {
	// A per-view export recompiles into a single-view snapshot (the reader yields view-null rrsets; the caller re-tags the
	// parsed zone with the exported view's name). The compiler counts a view-set change as a content change, so the right
	// `previous` for a single-view recompile is the original snapshot scoped to that view — same serial, same view's nodes.
	for (const view of ["lan", "tailnet"]) {
		it(`recompiles the ${view} view to the same view content with the serial standing still`, () => {
			const text = exportSnapshot(SNAPSHOT, { view });
			const { zone, rrsets } = parseZoneFile(text);
			const previous = { serial: SNAPSHOT.serial, views: { [view]: SNAPSHOT.views[view] } };
			const back = compileZone({ ...zone, views: [view] }, rrsets, previous, { now: NOW });
			expect(back.serial).toBe(SNAPSHOT.serial);
			expect(back.views[view]).toEqual(SNAPSHOT.views[view]);
		});
	}

	it("keeps the serial still on a viewless zone too", () => {
		const snap = compileZone(snapshotZone({ views: undefined }), VIEWLESS_RRSETS, null, { now: NOW });
		const { zone, rrsets } = parseZoneFile(exportSnapshot(snap));
		const back = compileZone(zone, rrsets, snap, { now: NOW });
		expect(back.serial).toBe(snap.serial);
		expect(back.views.all).toEqual(snap.views.all);
	});

	it("carries the snapshot's serial in the SOA text even when the zone value's SOA serial is stale — and the recompile then bumps once", () => {
		// The compiler leaves zone.soa untouched and computes the serial separately; the server writes snapshot.serial
		// into the SOA rdata when serving, and the exporter does the same. A stale rdata serial therefore reads back as
		// changed content, and the recompile legitimately bumps.
		const stale = compileZone(snapshotZone({ soa: { ...snapshotZone().soa, serial: 2026112200 } }), SNAPSHOT_RRSETS, null, { now: NOW });
		expect(stale.serial).toBe(2026112201);
		const text = exportSnapshot(stale, { view: "lan" });
		expect(text.includes(" 2026112201 7200 900 1209600 86400")).toBe(true);
		const { zone, rrsets } = parseZoneFile(text);
		const previous = { serial: stale.serial, views: { lan: stale.views.lan } };
		const back = compileZone({ ...zone, views: ["lan"] }, rrsets, previous, { now: NOW });
		expect(back.serial).toBe(stale.serial + 1); // the only change is the SOA rdata's serial
	});

	it("exports a sourced rrset's records — source does not round-trip, but the content fingerprint does", () => {
		const snap = compileZone(snapshotZone(), [...SNAPSHOT_RRSETS, rr("pool.homelab.cldmv.net.", TYPE.A, [A("10.0.0.9")], { source: "machines" })], null, { now: NOW });
		const text = exportSnapshot(snap, { view: "lan" });
		const { zone, rrsets } = parseZoneFile(text);
		const previous = { serial: snap.serial, views: { lan: snap.views.lan } };
		const back = compileZone({ ...zone, views: ["lan"] }, rrsets, previous, { now: NOW });
		expect(back.serial).toBe(snap.serial); // the fingerprint (name|type|ttl|records) is unchanged
		expect(back.views.lan.nodes["pool.homelab.cldmv.net."].rrsets[TYPE.A].records).toEqual([A("10.0.0.9")]);
		expect(back.views.lan.nodes["pool.homelab.cldmv.net."].rrsets[TYPE.A].source).toBe("manual"); // not "machines"
	});

	it("kind and serialPolicy do not round-trip through text — the reader always yields kind primary", () => {
		const snap = compileZone(snapshotZone({ kind: "secondary" }), SNAPSHOT_RRSETS, null, { now: NOW });
		const { zone } = parseZoneFile(exportSnapshot(snap, { view: "lan" }));
		expect(zone.kind).toBe("primary"); // the text carries records only; the caller keeps kind in the record store
	});
});
