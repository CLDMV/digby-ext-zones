/**
 *	@Project: @cldmv/digby-ext-zones
 *	@Filename: /.configs/vitest.config.mjs
 */

import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Anchor the project root to the package directory so include/exclude work no matter what cwd vitest is invoked from.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export default defineConfig({
	root,
	test: {
		include: ["tests/**/*.test.vitest.mjs"],
		// tests/needs-wire/ parks the reader/exporter suites until the wire extension lands (#42) — see its README.
		exclude: ["node_modules", "tests/needs-wire/**"],
		environment: "node",
		// Capture the fake wire surface before any test loads (the root leaf's activate() does this for real).
		setupFiles: ["./tests/setup-wire.mjs"],
		// Inline slothlet and rummage so composed leaves are attributed in coverage (see slothlet docs/TESTING.md).
		server: { deps: { inline: [/@cldmv\/slothlet/, /@cldmv\/rummage/] } },
		testTimeout: 30000,
		reporters: ["dot"],
		coverage: {
			provider: "v8",
			include: ["src/**"],
			exclude: ["**/*.json"],
			reporter: ["text", "html", "json-summary", "json"]
		}
	}
});
