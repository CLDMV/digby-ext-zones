/**
 *	@Project: @cldmv/digby-ext-zones
 *	@Filename: /tests/zones/settings.test.vitest.mjs
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
 * @fileoverview The settings leaves' suite: `src/api/zones/settings/{get,set,list}.mjs` are the `protectedGet/Set/List`
 * wrappers over `sql/settings.mjs`, bound by activate's `setupSettings` and reached here through the composed host
 * (`t.api` — host standing; the settings leaves are deliberately NOT in the manifest's `public` list, and the peer
 * denial of the same leaves is compose.test's). The schema is empty today — zones declares no settings yet — so each
 * leaf's real behavior here is the refusal path: an unknown key is refused `not-found` naming the extension, and the
 * listing of an empty schema is an empty object. Composed as its own file because composeTestHost refuses a second
 * host in one process (per-file worker isolation makes a second file free).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { composeTestHost } from "@cldmv/rummage/testing";

let t;
beforeAll(async () => {
	t = await composeTestHost({ ext: new URL("..", import.meta.url), store: null, app: "digby" });
}, 300_000);
afterAll(() => t?.close());

/** Run `fn` and return the refusal it raises (failing the test when nothing, or something unexpected, is thrown). */
async function refusal(fn) {
	let err;
	try {
		await fn();
	} catch (e) {
		err = e;
	}
	expect(err, "expected a refusal").toBeTruthy();
	return err;
}

describe("the settings leaves over the composed host", () => {
	it("list answers an empty object — the schema declares no settings yet", async () => {
		expect(await t.api.zones.settings.list()).toEqual({});
	});

	it("get refuses an unknown key with not-found, naming the extension", async () => {
		const err = await refusal(() => t.api.zones.settings.get("zones.theme"));
		expect(err.code).toBe("not-found");
		expect(err.message).toMatch(/unknown setting "zones\.theme"/);
	});

	it("set refuses an unknown key the same way — nothing is writable that is not declared", async () => {
		const err = await refusal(() => t.api.zones.settings.set("zones.theme", "dark"));
		expect(err.code).toBe("not-found");
		expect(err.message).toMatch(/unknown setting "zones\.theme"/);
	});
});
