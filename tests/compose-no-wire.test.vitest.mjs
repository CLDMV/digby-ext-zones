/**
 *	@Project: @cldmv/digby-ext-zones
 *	@Filename: /tests/compose-no-wire.test.vitest.mjs
 *	@Date: 2026-11-28T00:00:00-08:00
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-28T00:00:00-08:00
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview The wire fail-fast's OTHER branch, composed-side: a host whose zones package does NOT require wire —
 * the fixture below is a throwaway copy of this package whose manifest drops `requires`, so the loader never pulls the
 * codec in and NOTHING in the host provides `self.wire` — fails activate's mount-time check, and the boot REJECTS with
 * the error naming the wire extension and the surface it checked. Inside a composed extent a namespace the host never
 * mounted reads as undefined (the off-extent refusal is what throws — that branch is activate.test's), so this is the
 * `self.wire.errors.is is undefined` throw, not the caught-read one. The wired-and-activated boot is compose.test's.
 * Composed as its own file because composeTestHost refuses a second host in one process (per-file worker isolation
 * makes a second file free) — CLDMV/digby#42.
 */

import { rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fileURLToPath, pathToFileURL } from "node:url";
import { composeTestHost, scratchDir } from "@cldmv/rummage/testing";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("a host composed WITHOUT wire fails activate's mount-time check (CLDMV/digby#42)", () => {
	it("rejects the boot with the self.wire.errors.is-is-undefined error naming the wire extension", async () => {
		// The fixture: package.json + a manifest whose `requires` is dropped; src/ and sql/ are the real production
		// files, symlinked. The loader composes this zones (protocol, settings setup, activate) and pulls in nothing.
		const fixture = scratchDir("compose-no-wire-");
		writeFileSync(
			path.join(fixture, "package.json"),
			JSON.stringify({ name: "@cldmv/digby-ext-zones", version: "0.0.1", type: "module", main: "./src/api/zones/zones.mjs", dependencies: { "@cldmv/rummage": "workspace:*" } }, null, "\t") + "\n"
		);
		// The manifest minus `requires` — the codec never enters this host's discovery.
		writeFileSync(path.join(fixture, "rummage.manifest.mjs"), 'export default {\n\tprotocol: { version: "1.0" },\n\ti18n: { prefix: "zones" }\n};\n');
		symlinkSync(path.join(root, "src"), path.join(fixture, "src"), "dir");
		symlinkSync(path.join(root, "sql"), path.join(fixture, "sql"), "dir");

		try {
			await expect(
				composeTestHost({ ext: pathToFileURL(fixture + "/"), store: null, app: "digby" })
			).rejects.toThrow(/@cldmv\/digby-ext-wire extension — self\.wire\.errors\.is is undefined, not a function/);
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});
});
