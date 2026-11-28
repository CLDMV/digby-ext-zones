/**
 *	@Project: @cldmv/digby-ext-zones
 *	@Filename: /tests/manifest.test.vitest.mjs
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import manifest from "../rummage.manifest.mjs";

describe("rummage.manifest.mjs", () => {
	it("declares the extension protocol and the i18n prefix", () => {
		expect(manifest.protocol).toEqual({ version: "1.0" });
		expect(manifest.i18n).toEqual({ prefix: "zones" });
	});

	it("requires the wire extension — the DNS codec lives there (CLDMV/digby#42)", () => {
		expect(manifest.requires).toEqual(["@cldmv/digby-ext-wire"]);
	});

	it("requires only packages the package.json declares — a dropped dependency must fail here, not at a fresh install", () => {
		const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
		for (const name of manifest.requires ?? []) {
			expect(pkg.dependencies ?? {}, `manifest requires '${name}', which package.json 'dependencies' does not declare — the link left in node_modules hides it until a fresh install`).toHaveProperty(name);
		}
	});
});
