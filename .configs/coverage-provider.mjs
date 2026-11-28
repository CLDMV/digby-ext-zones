/**
 *	@Project: @cldmv/digby-ext-zones
 *	@Filename: /.configs/coverage-provider.mjs
 */

import v8 from "@vitest/coverage-v8";

/**
 * @fileoverview The v8 coverage provider with one correction. Slothlet loads every composed leaf as
 * `<file>?slothlet_instance=<id>&module=<package>` and V8 reports that script under the query URL. The provider's remapper derives
 * the file key from that URL, and the "/" inside the `module` value makes it read the package name as the file name, so the key points
 * at a path that doesn't exist and the provider's existsSync filter drops the leaf's coverage, leaving every composed leaf at 0%.
 * Each script's query is stripped before conversion, so every instance's execution maps onto the real source file and merges. The
 * source is the same file executed as loaded; nothing is excluded or ignored. (The same provider @cldmv/digby-ext-server carries.)
 */
const stripQuery = (url) => url.replace(/(%3F|\?).*$/s, "");

export default Object.create(v8, {
	getProvider: {
		value: async () => {
			const provider = await v8.getProvider();
			const convert = provider.convertCoverage.bind(provider);
			provider.convertCoverage = (coverage, ...rest) =>
				convert({ ...coverage, result: coverage.result.map((script) => ({ ...script, url: stripQuery(script.url) })) }, ...rest);
			return provider;
		}
	}
});
