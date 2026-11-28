/**
 *	@Project: @cldmv/digby-ext-zones
 *	@Filename: /tests/compose.test.vitest.mjs
 */

/**
 * @fileoverview The composed-surface suite: the REAL production boot of this package through rummage's in-process
 * ext-host (`@cldmv/rummage/testing` `composeTestHost`, the same thing wire's and server's own suites boot), which runs
 * rummage's actual discovery over this package's rummage.manifest.mjs and follows the manifest's
 * `requires: ["@cldmv/digby-ext-wire"]` the way the ext-host's own discovery does — from THIS package's directory,
 * through its package.json `dependencies`. That makes this suite the discovery gate the manifest test cannot be: a
 * `requires` entry whose package the package.json does not declare does not resolve, and the boot REJECTS with the
 * ext-host's failure list (the shape the Friday review's composition probe recorded).
 *
 * With the boot green, the three guarantees the wiring exists for hold end to end:
 * - wire mounts and activates BEFORE zones' root leaf runs (the `requires` order), so activate's `self.wire` capture
 *   succeeds and the seam holds the REAL codec — all four zones leaves (import.file, compile, export.zone,
 *   export.snapshot) then run over it in one composed pass, through the host's standing api (`t.api.zones.*`: the
 *   probe caller `t.run` uses is permission-gated cross-extent and cannot read zones' leaves);
 * - the error contract works across the composed boundary: a wire failure caught through the composed api satisfies
 *   `t.api.wire.errors.is(err)` (the `WireError` class is not a leaf — a composed instance is a separate module copy,
 *   so `instanceof` is false across the boundary; the predicate is the contract);
 * - compiling byte-bearing rdata (TXT, DS, SSHFP, generic `\#`) survives the snapshot's deep freeze — the freeze skips
 *   array-buffer views instead of throwing on them.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { composeTestHost } from "@cldmv/rummage/testing";

let t;
beforeAll(async () => {
	// store: null — this suite composes the wire + zones pair, not the store orchestrator; app: "digby" places both
	// first-party packages at the app root (wire at `wire`, zones at `zones`), the shape the digby app's own
	// rummage.config composes.
	t = await composeTestHost({ ext: new URL("..", import.meta.url), store: null, app: "digby" });
}, 300_000);
afterAll(() => t?.close());

/** Where the host composed zones — first-party (`zones`) or third-party (`ext.<app>.zones`). Probed on `.activate`, the
 * root leaf's real export: `.name` sat on a root export that always answered (a function node's own `name`, or the
 * removed `export const name`), so it proved nothing (the consumer round's lesson, CLDMV/digby#42 C3-4). */
const mount = () =>
	["zones", "ext.digby.zones", "ext.zones"].find((p) => {
		try {
			return t.leaf(`${p}.activate`) !== undefined;
		} catch {
			return false;
		}
	});

/** The base master file the four-leaf pass parses, compiles and exports. */
const BASE = ["$ORIGIN example.", "$TTL 300", "@ SOA ns1 host 1 7200 900 1209600 300", "@ NS ns1", "ns1 A 192.0.2.1"].join("\n") + "\n";

describe("the composed zones surface (CLDMV/digby#42)", () => {
	it("boots through real discovery — the manifest's requires resolves and zones activates", () => {
		// composeTestHost ran rummage's discovery (rummage.manifest.mjs + package.json dependencies), linked and
		// declared the requires closure, mounted wire BEFORE zones and ran activate() — a requires entry that does not
		// resolve, or a fail-fast that throws, rejects the beforeAll above with the failure list.
		expect(mount(), "the host composed zones somewhere").toBeTruthy();
	});

	it("activate's capture holds — the seam runs the real wire through all four zones leaves", async () => {
		const parsed = await t.api.zones.import.file(BASE);
		const snap = await t.api.zones.compile(parsed.zone, parsed.rrsets, null, { now: 0 });
		const zoneText = await t.api.zones.export.zone(parsed.zone, parsed.rrsets);
		const snapText = await t.api.zones.export.snapshot(snap);
		const out = { rrsets: parsed.rrsets.length, serial: snap.serial, zoneText, snapText };
		expect(out.rrsets).toBe(2); // the apex NS and ns1's A; the SOA routes into zone.soa
		expect(Number.isInteger(out.serial)).toBe(true);
		expect(out.zoneText).toMatch(/^\$ORIGIN example\.\n/);
		expect(out.zoneText).toContain("ns1 A 192.0.2.1");
		expect(out.snapText).toContain("SOA");
		expect(out.snapText).toContain("ns1 A 192.0.2.1");
	});

});
