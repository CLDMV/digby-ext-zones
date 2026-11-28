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
		exclude: ["node_modules"],
		environment: "node",
		// No global wire setup: each suite captures the surface it means to test — the unit suites the fake
		// (tests/setup-wire.mjs, first import), the real-codec suites the real wire (tests/helpers/real-wire.mjs), and
		// the composed-host suites whatever activate() captures at boot. A global capture here once masked activate's
		// wire fail-fast behind the fake's parse error.
		// Inline slothlet and rummage so composed leaves are attributed in coverage (see slothlet docs/TESTING.md).
		server: { deps: { inline: [/@cldmv\/slothlet/, /@cldmv\/rummage/] } },
		testTimeout: 30000,
		reporters: ["dot"],
		coverage: {
			provider: "custom",
			// The v8 provider, with the query slothlet puts on composed leaves stripped from their coverage keys (see the file).
			customProviderModule: path.resolve(root, ".configs/coverage-provider.mjs"),
			include: ["src/**"],
			exclude: ["**/*.json"],
			reporter: ["text", "html", "json-summary", "json"]
		}
	}
});
