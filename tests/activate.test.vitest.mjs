/**
 *	@Project: @cldmv/digby-ext-zones
 *	@Filename: /tests/activate.test.vitest.mjs
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
 * @fileoverview The wire fail-fast, unit-side: `activate()` reached OUTSIDE a composed host has no wire surface to
 * read — slothlet's `self` fails closed off-extent — so the fail-fast must answer the clear error naming the wire
 * extension, not whatever the runtime's off-extent refusal happens to say. (This is the branch the un-scoped fake once
 * masked: a setup file that pre-captured a stand-in made the off-extent refusal look like a parse error.) The composed
 * side of the same guarantee — a host that never mounted wire — lives in tests/compose-no-wire.test.vitest.mjs; the
 * wired-and-activated boot is compose.test's.
 */

import { describe, expect, it } from "vitest";
import { activate } from "../src/api/zones/zones.mjs";

/** A context that satisfies setupSettings, with nothing else — no composed host behind it. */
const stubContext = () => ({
	storage: { settings: { get: async () => undefined, set: async () => undefined } },
	extId: "digby.zones",
	commands: { register() {} }
});

describe("activate() fails fast on a missing wire surface (CLDMV/digby#42)", () => {
	it("throws the clear wire error when no composed host is behind the call (off-extent)", () => {
		expect(() => activate(stubContext())).toThrow(/@cldmv\/digby-ext-wire/);
		expect(() => activate(stubContext())).toThrow(/self\.wire/);
	});
});
