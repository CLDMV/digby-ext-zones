/**
 *	@Project: @cldmv/digby-ext-zones
 *	@Filename: /tests/zones/reader.test.vitest.mjs
 *	@Date: 2026-11-22T09:41:47-08:00 (1795369307)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-22T09:41:47-08:00 (1795369307)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Tests for the master-file reader (`src/lib/reader.mjs`): RFC 1035 zone-file syntax over the codec's
 * presentation parser — directives, the standard omissions (owner, TTL, class), parenthesised multi-line records, quoted
 * strings and escapes, the refusal of unimplemented directives, and the two fixture zones parsed end to end.
 */

import { describe, expect, it } from "vitest";
import { parseZoneFile } from "../../src/lib/reader.mjs";
import { WireError, WireErrorCode } from "../../src/lib/codec.mjs";

// Numeric type numbers (RFC 1035 / RFC 3596) — the codec seam does not re-export the TYPE table.
const TYPE = { A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28 };

const enc = (s) => new TextEncoder().encode(s);

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
 * A minimal valid zone file body an individual test can append records to.
 * @param {string[]} more - extra master-file lines after the SOA
 * @returns {string}
 */
function baseZone(...more) {
	return ["$ORIGIN x.test.", "$TTL 3600", "@ 3600 IN SOA ns admin 1 7200 900 1209600 300", ...more].join("\n");
}

describe("directives", () => {
	it("resolves $ORIGIN, and a later $ORIGIN replaces it", () => {
		const { zone, rrsets } = parseZoneFile(
			[
				"$ORIGIN a.test.",
				"@ 3600 IN SOA ns admin 1 7200 900 1209600 300",
				"www A 1.2.3.4",
				"$ORIGIN b.test.",
				"www2 A 1.2.3.5",
			].join("\n")
		);
		expect(zone.name).toBe("a.test.");
		expect(rrsets.map((r) => r.name)).toEqual(["a.test.", "www.a.test.", "www2.b.test."]);
	});

	it("resolves a relative $ORIGIN against the previous origin", () => {
		const { rrsets } = parseZoneFile(
			["$ORIGIN a.test.", "@ 3600 IN SOA ns admin 1 7200 900 1209600 300", "$ORIGIN sub", "www A 1.2.3.4"].join("\n")
		);
		expect(rrsets[1].name).toBe("www.sub.a.test.");
	});

	it("applies $TTL to records without their own TTL, and a later $TTL replaces it", () => {
		const { zone, rrsets } = parseZoneFile(
			["$ORIGIN x.test.", "@ 3600 IN SOA ns admin 1 7200 900 1209600 300", "$TTL 120", "@ TXT \"a\""].join("\n")
		);
		expect(zone.defaultTtl).toBe(120);
		expect(rrsets[1].ttl).toBe(120);
	});

	it("accepts $TTL 0 (RFC 2308)", () => {
		const { rrsets } = parseZoneFile(
			["$ORIGIN x.test.", "$TTL 0", "@ 3600 IN SOA ns admin 1 7200 900 1209600 300", "@ TXT \"a\""].join("\n")
		);
		expect(rrsets[1].ttl).toBe(0);
	});

	it("refuses $INCLUDE — the reader is pure, the caller resolves files", () => {
		const err = wireError(() => parseZoneFile("$INCLUDE /etc/digby/other.zone"));
		expect(err.code).toBe(WireErrorCode.BAD_PRESENTATION);
		expect(err.message).toMatch(/\$INCLUDE/);
		expect(err.message).toMatch(/pure|resolve/);
	});

	it("refuses $GENERATE as unimplemented", () => {
		const err = wireError(() => parseZoneFile("$GENERATE 1-5 host$ A 10.0.0.$"));
		expect(err).toBeInstanceOf(WireError);
		expect(err.message).toMatch(/\$GENERATE/);
	});

	it("refuses an unknown directive", () => {
		const err = wireError(() => parseZoneFile("$SOMETHING foo"));
		expect(err.message).toMatch(/unknown directive "\$SOMETHING"/);
	});
});

describe("the standard omissions", () => {
	it("inherits the owner across blank-name lines (space- and tab-led)", () => {
		const { rrsets } = parseZoneFile(baseZone("www A 1.2.3.4", " 3600 TXT \"x\"", "\tAAAA fd00::1"));
		expect(rrsets.map((r) => r.name)).toEqual(["x.test.", "www.x.test.", "www.x.test.", "www.x.test."]);
		expect(rrsets[1].type).toBe(TYPE.A);
		expect(rrsets[2].type).toBe(TYPE.TXT);
		expect(rrsets[3].type).toBe(TYPE.AAAA);
	});

	it("prefers an explicit record TTL over $TTL", () => {
		const { rrsets } = parseZoneFile(baseZone("www 60 A 1.2.3.4"));
		expect(rrsets[1].ttl).toBe(60);
	});

	it("falls back from $TTL to the SOA minimum, in that order", () => {
		// no $TTL: the record without a TTL gets the SOA's minimum
		const { zone, rrsets } = parseZoneFile(
			["$ORIGIN x.test.", "@ 3600 IN SOA ns admin 1 7200 900 1209600 86400", "@ TXT \"a\""].join("\n")
		);
		expect(zone.defaultTtl).toBe(86400);
		expect(rrsets[1].ttl).toBe(86400);
	});

	it("errors when a record has no TTL and no default exists", () => {
		const err = wireError(() => parseZoneFile("$ORIGIN x.test.\n@ IN SOA ns admin 1 7200 900 1209600 300"));
		expect(err.message).toMatch(/no TTL/);
	});

	it("defaults an omitted class to IN and refuses any other class", () => {
		const { rrsets } = parseZoneFile(baseZone("www TXT \"a\"")); // no class token at all
		expect(rrsets[1].name).toBe("www.x.test.");
		const err = wireError(() => parseZoneFile(baseZone("www CH TXT \"a\"")));
		expect(err.message).toMatch(/only the IN class/);
	});
});

describe("multi-line records, quoting and escapes", () => {
	it("joins a parenthesised record spanning 3+ lines, with blank lines and comments inside", () => {
		const { rrsets } = parseZoneFile(baseZone("@ 3600 IN TXT (\"a\"", "  \"b\"", "", "  \"c\") ; trailing note"));
		expect(rrsets).toHaveLength(2);
		expect(rrsets[1].records[0].strings.map((s) => Buffer.from(s).toString())).toEqual(["a", "b", "c"]);
		expect(rrsets[1].comment).toBe("trailing note");
	});

	it("keeps `;` and `(` inside quoted strings, and unescapes \\\"", () => {
		const { rrsets } = parseZoneFile(baseZone("@ 3600 IN TXT \"a;b(c)d\\\"e\""));
		expect(Buffer.from(rrsets[1].records[0].strings[0]).toString()).toBe('a;b(c)d"e');
	});

	it("handles \\DDD escapes in rdata and escaped dots in names", () => {
		const { rrsets } = parseZoneFile(
			baseZone("@ 3600 IN TXT \"x\\065y\"", "router\\.point A 1.2.3.4", "aliased CNAME target\\.dot")
		);
		expect(Buffer.from(rrsets[1].records[0].strings[0]).toString()).toBe("xAy");
		expect(rrsets[2].name).toBe("router\\.point.x.test.");
		expect(rrsets[3].records[0].target).toBe("target\\.dot.x.test.");
	});
});

describe("grouping into rrsets", () => {
	it("groups only consecutive records with the same name and type, in file order", () => {
		const { rrsets } = parseZoneFile(baseZone("www A 1.2.3.4", "other A 1.2.3.6", "www A 1.2.3.5"));
		expect(rrsets).toHaveLength(4);
		expect(rrsets[1].records).toEqual([{ address: "1.2.3.4" }]);
		expect(rrsets[3].records).toEqual([{ address: "1.2.3.5" }]);
	});

	it("groups case-insensitively on the owner name, keeping the first spelling", () => {
		const { rrsets } = parseZoneFile(baseZone("WWW A 1.2.3.4", "www A 1.2.3.5"));
		expect(rrsets).toHaveLength(2);
		expect(rrsets[1].name).toBe("WWW.x.test.");
		expect(rrsets[1].records).toEqual([{ address: "1.2.3.4" }, { address: "1.2.3.5" }]);
	});
});

describe("the homelab.cldmv.net fixture", () => {
	const HOMELAB = [
		"$ORIGIN homelab.cldmv.net.",
		"$TTL 3600",
		"@ IN SOA ns1 admin.cldmv.net. (",
		"    2026112201 ; serial",
		"    7200       ; refresh",
		"    900        ; retry",
		"    1209600    ; expire",
		"    86400 )    ; minimum",
		"    IN NS ns1              ; the primary",
		"    IN NS ns2.cldmv.net.",
		"ns1  A   192.168.10.2",
		"ns2  A   192.168.10.3",
		"@     A   192.168.10.1",
		"\t    AAAA fd00:10::1",
		"www   300 A 192.168.10.1",
		"www   300 A 192.168.10.11",
		"@     MX 10 mail",
		"@     MX 20 mail.cldmv.net.",
		"mail  A 192.168.10.25 ; the mail host",
		"mail  TXT \"v=spf1 mx -all\"",
		"_dmarc TXT \"v=DMARC1\\; p=none\" \"rua=mailto:dmarc@cldmv.net\"",
		"gw    30m A 192.168.10.254",
		"router\\.point A 192.168.10.9",
		"helper CNAME www",
		"lab   NS  ns1.lab",
		"ns1.lab A 192.168.10.20",
		"*.dev A   192.168.10.40",
		"10.10.168.192.in-addr.arpa. PTR ns1",
		"10.11.168.192.in-addr.arpa. PTR mail.cldmv.net.",
	].join("\n");

	it("parses the zone value", () => {
		const { zone } = parseZoneFile(HOMELAB);
		expect(zone).toEqual({
			name: "homelab.cldmv.net.",
			kind: "primary",
			views: [],
			soa: {
				mname: "ns1.homelab.cldmv.net.",
				rname: "admin.cldmv.net.",
				serial: 2026112201,
				refresh: 7200,
				retry: 900,
				expire: 1209600,
				minimum: 86400
			},
			defaultTtl: 3600
		});
	});

	it("parses the rrsets in detail: names, TTLs, types, rdata shapes, grouping, order, comments", () => {
		const { rrsets } = parseZoneFile(HOMELAB);
		expect(rrsets).toEqual([
			{
				zone: "homelab.cldmv.net.",
				name: "homelab.cldmv.net.",
				type: TYPE.SOA,
				view: null,
				ttl: 3600,
				records: [
					{
						mname: "ns1.homelab.cldmv.net.",
						rname: "admin.cldmv.net.",
						serial: 2026112201,
						refresh: 7200,
						retry: 900,
						expire: 1209600,
						minimum: 86400
					}
				],
				comment: "minimum", // the trailing comment of the record's last (closing) line
				source: "manual"
			},
			{
				zone: "homelab.cldmv.net.",
				name: "homelab.cldmv.net.",
				type: TYPE.NS,
				view: null,
				ttl: 3600,
				records: [{ target: "ns1.homelab.cldmv.net." }, { target: "ns2.cldmv.net." }],
				comment: "the primary",
				source: "manual"
			},
			{
				zone: "homelab.cldmv.net.",
				name: "ns1.homelab.cldmv.net.",
				type: TYPE.A,
				view: null,
				ttl: 3600,
				records: [{ address: "192.168.10.2" }],
				comment: null,
				source: "manual"
			},
			{
				zone: "homelab.cldmv.net.",
				name: "ns2.homelab.cldmv.net.",
				type: TYPE.A,
				view: null,
				ttl: 3600,
				records: [{ address: "192.168.10.3" }],
				comment: null,
				source: "manual"
			},
			{
				zone: "homelab.cldmv.net.",
				name: "homelab.cldmv.net.",
				type: TYPE.A,
				view: null,
				ttl: 3600,
				records: [{ address: "192.168.10.1" }],
				comment: null,
				source: "manual"
			},
			{
				zone: "homelab.cldmv.net.",
				name: "homelab.cldmv.net.",
				type: TYPE.AAAA,
				view: null,
				ttl: 3600,
				records: [{ address: "fd00:10::1" }],
				comment: null,
				source: "manual"
			},
			{
				zone: "homelab.cldmv.net.",
				name: "www.homelab.cldmv.net.",
				type: TYPE.A,
				view: null,
				ttl: 300,
				records: [{ address: "192.168.10.1" }, { address: "192.168.10.11" }],
				comment: null,
				source: "manual"
			},
			{
				zone: "homelab.cldmv.net.",
				name: "homelab.cldmv.net.",
				type: TYPE.MX,
				view: null,
				ttl: 3600,
				records: [
					{ preference: 10, exchange: "mail.homelab.cldmv.net." },
					{ preference: 20, exchange: "mail.cldmv.net." }
				],
				comment: null,
				source: "manual"
			},
			{
				zone: "homelab.cldmv.net.",
				name: "mail.homelab.cldmv.net.",
				type: TYPE.A,
				view: null,
				ttl: 3600,
				records: [{ address: "192.168.10.25" }],
				comment: "the mail host",
				source: "manual"
			},
			{
				zone: "homelab.cldmv.net.",
				name: "mail.homelab.cldmv.net.",
				type: TYPE.TXT,
				view: null,
				ttl: 3600,
				records: [{ strings: [enc("v=spf1 mx -all")] }],
				comment: null,
				source: "manual"
			},
			{
				zone: "homelab.cldmv.net.",
				name: "_dmarc.homelab.cldmv.net.",
				type: TYPE.TXT,
				view: null,
				ttl: 3600,
				records: [{ strings: [enc("v=DMARC1; p=none"), enc("rua=mailto:dmarc@cldmv.net")] }],
				comment: null,
				source: "manual"
			},
			{
				zone: "homelab.cldmv.net.",
				name: "gw.homelab.cldmv.net.",
				type: TYPE.A,
				view: null,
				ttl: 1800, // 30m
				records: [{ address: "192.168.10.254" }],
				comment: null,
				source: "manual"
			},
			{
				zone: "homelab.cldmv.net.",
				name: "router\\.point.homelab.cldmv.net.",
				type: TYPE.A,
				view: null,
				ttl: 3600,
				records: [{ address: "192.168.10.9" }],
				comment: null,
				source: "manual"
			},
			{
				zone: "homelab.cldmv.net.",
				name: "helper.homelab.cldmv.net.",
				type: TYPE.CNAME,
				view: null,
				ttl: 3600,
				records: [{ target: "www.homelab.cldmv.net." }],
				comment: null,
				source: "manual"
			},
			{
				zone: "homelab.cldmv.net.",
				name: "lab.homelab.cldmv.net.",
				type: TYPE.NS,
				view: null,
				ttl: 3600,
				records: [{ target: "ns1.lab.homelab.cldmv.net." }],
				comment: null,
				source: "manual"
			},
			{
				zone: "homelab.cldmv.net.",
				name: "ns1.lab.homelab.cldmv.net.",
				type: TYPE.A,
				view: null,
				ttl: 3600,
				records: [{ address: "192.168.10.20" }],
				comment: null,
				source: "manual"
			},
			{
				zone: "homelab.cldmv.net.",
				name: "*.dev.homelab.cldmv.net.",
				type: TYPE.A,
				view: null,
				ttl: 3600,
				records: [{ address: "192.168.10.40" }],
				comment: null,
				source: "manual"
			},
			{
				zone: "homelab.cldmv.net.",
				name: "10.10.168.192.in-addr.arpa.",
				type: TYPE.PTR,
				view: null,
				ttl: 3600,
				records: [{ target: "ns1.homelab.cldmv.net." }],
				comment: null,
				source: "manual"
			},
			{
				zone: "homelab.cldmv.net.",
				name: "10.11.168.192.in-addr.arpa.",
				type: TYPE.PTR,
				view: null,
				ttl: 3600,
				records: [{ target: "mail.cldmv.net." }],
				comment: null,
				source: "manual"
			}
		]);
	});
});

describe("the quack.shellback.net fixture", () => {
	const QUACK = [
		"$ORIGIN quack.shellback.net.",
		"$TTL 300",
		"@ SOA ns.quack.shellback.net. hostmaster.quack.shellback.net. 1 7200 900 1209600 300",
		"@ NS ns.quack.shellback.net."
	].join("\n");

	it("parses the empty zone: SOA and NS only", () => {
		const { zone, rrsets } = parseZoneFile(QUACK);
		expect(zone).toEqual({
			name: "quack.shellback.net.",
			kind: "primary",
			views: [],
			soa: {
				mname: "ns.quack.shellback.net.",
				rname: "hostmaster.quack.shellback.net.",
				serial: 1,
				refresh: 7200,
				retry: 900,
				expire: 1209600,
				minimum: 300
			},
			defaultTtl: 300
		});
		expect(rrsets).toEqual([
			{
				zone: "quack.shellback.net.",
				name: "quack.shellback.net.",
				type: TYPE.SOA,
				view: null,
				ttl: 300,
				records: [
					{
						mname: "ns.quack.shellback.net.",
						rname: "hostmaster.quack.shellback.net.",
						serial: 1,
						refresh: 7200,
						retry: 900,
						expire: 1209600,
						minimum: 300
					}
				],
				comment: null,
				source: "manual"
			},
			{
				zone: "quack.shellback.net.",
				name: "quack.shellback.net.",
				type: TYPE.NS,
				view: null,
				ttl: 300,
				records: [{ target: "ns.quack.shellback.net." }],
				comment: null,
				source: "manual"
			}
		]);
	});
});

describe("malformed files", () => {
	it("propagates the codec's error for a bad owner name", () => {
		const err = wireError(() => parseZoneFile(baseZone("bad..name A 1.2.3.4")));
		expect(err.code).toBe(WireErrorCode.BAD_PRESENTATION);
		expect(err.message).toMatch(/empty label/);
	});

	it("propagates the codec's error for rdata it rejects", () => {
		const err = wireError(() => parseZoneFile(baseZone("foo 3600 A not-an-ip")));
		expect(err.code).toBe(WireErrorCode.BAD_PRESENTATION);
		expect(err.message).toMatch(/not an IPv4 address/);
	});

	it("propagates the codec's error for an unknown type mnemonic", () => {
		const err = wireError(() => parseZoneFile(baseZone("foo 3600 NOTATYPE x")));
		expect(err).toBeInstanceOf(WireError);
		expect(err.message).toMatch(/NOTATYPE/);
	});

	it("reports an unterminated parenthesis at end of file", () => {
		const err = wireError(() => parseZoneFile(["$ORIGIN x.test.", "$TTL 3600", "@ 3600 IN TXT (a"].join("\n")));
		expect(err.message).toMatch(/unbalanced '\('/);
	});

	it("reports an unterminated quoted string at end of file", () => {
		const err = wireError(() => parseZoneFile(baseZone("@ 3600 IN TXT \"abc")));
		expect(err.message).toMatch(/unterminated quoted string/);
	});

	it("reports a stray ')'", () => {
		const err = wireError(() => parseZoneFile(baseZone("www 3600 A 1.2.3.4)")));
		expect(err.message).toMatch(/unbalanced '\)'/);
	});

	it("errors on a blank owner with no previous owner", () => {
		const err = wireError(() => parseZoneFile("$ORIGIN x.test.\n A 1.2.3.4"));
		expect(err.message).toMatch(/no owner/);
	});

	it("errors on a second SOA record", () => {
		const err = wireError(() => parseZoneFile(baseZone("@ 3600 IN SOA ns2 admin 2 7200 900 1209600 300")));
		expect(err.message).toMatch(/one SOA record/);
	});

	it("errors when the file has no SOA record", () => {
		const err = wireError(() => parseZoneFile("$ORIGIN x.test.\nwww 3600 A 1.2.3.4"));
		expect(err.message).toMatch(/no SOA record/);
	});
});
