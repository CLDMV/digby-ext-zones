/**
 *	@Project: @cldmv/digby-ext-zones
 *	@Filename: /tests/engines.test.vitest.mjs
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Parse the lower bound of a `>=X.Y.Z` engines range.
 * @param {string} range - an engines.node range of the form ">=X.Y.Z"
 * @returns {number[]} [major, minor, patch]
 */
function floorOf(range) {
	const m = /^\s*>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?\s*$/.exec(range);
	if (!m) throw new Error(`unsupported engines.node range: ${range}`);
	return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

/**
 * Compare two [major, minor, patch] triples.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} negative when a < b, zero when equal, positive when a > b
 */
function compare(a, b) {
	for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
	return 0;
}

/**
 * Find the installed slothlet package.json by walking up node_modules from the resolved @cldmv/rummage package.
 * @returns {string} absolute path of slothlet's package.json
 */
function findSlothlet() {
	const rummageDir = fs.realpathSync(path.join(root, "node_modules", "@cldmv", "rummage"));
	for (let dir = rummageDir; ; dir = path.dirname(dir)) {
		const candidate = path.join(dir, "node_modules", "@cldmv", "slothlet", "package.json");
		if (fs.existsSync(candidate)) return candidate;
		if (path.dirname(dir) === dir) throw new Error("@cldmv/slothlet is not installed beneath @cldmv/rummage");
	}
}

describe("engines.node", () => {
	it("is not below the floor of @cldmv/slothlet (a transitive runtime dependency via @cldmv/rummage)", () => {
		const own = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
		const slothlet = JSON.parse(fs.readFileSync(findSlothlet(), "utf8"));
		expect(slothlet.engines?.node, "slothlet declares engines.node").toBeTruthy();
		const ownFloor = floorOf(own.engines.node);
		const dependencyFloor = floorOf(slothlet.engines.node);
		expect(compare(ownFloor, dependencyFloor), `engines.node ${own.engines.node} vs slothlet ${slothlet.engines.node}`).toBeGreaterThanOrEqual(0);
	});

	it("is at least 24.15.0 — the node24 floor rides this branch (the wire and server extensions already sit on 24.15.0)", () => {
		const own = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
		expect(compare(floorOf(own.engines.node), [24, 15, 0]), `engines.node ${own.engines.node}`).toBeGreaterThanOrEqual(0);
	});

	it("devEngines.runtime.version is at least 24.15.0, and never lower than engines", () => {
		const own = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
		const dev = own.devEngines?.runtime;
		expect(dev?.name).toBe("node");
		expect(compare(floorOf(dev.version), [24, 15, 0]), `devEngines.runtime.version ${dev.version}`).toBeGreaterThanOrEqual(0);
		expect(compare(floorOf(dev.version), floorOf(own.engines.node)), "devEngines is never below engines").toBeGreaterThanOrEqual(0);
	});

	it("the workflows pin the same floor — every min_node_version value in publish.yml and ci.yml is at least 24.15.0", () => {
		for (const workflow of ["publish.yml", "ci.yml"]) {
			const lines = fs.readFileSync(path.join(root, ".github", "workflows", workflow), "utf8").split("\n");
			const pins = [];
			for (let i = 0; i < lines.length; i++) {
				if (!lines[i].includes("min_node_version")) continue;
				for (const line of lines.slice(i, i + 5)) for (const m of line.matchAll(/['"](\d+\.\d+\.\d+)['"]/g)) pins.push(m[1]);
			}
			expect(pins.length, `${workflow} pins min_node_version`).toBeGreaterThan(0);
			for (const pin of pins) expect(compare(floorOf(`>= ${pin}`), [24, 15, 0]), `${workflow}: min_node_version ${pin}`).toBeGreaterThanOrEqual(0);
		}
	});
});
