/**
 *	@Project: @cldmv/digby-ext-zones
 *	@Filename: /tests/helpers/real-wire.mjs
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
 * @fileoverview The REAL wire for the reader/exporter suites (`tests/wire/`): the wire extension's api tree, composed
 * eagerly through slothlet the way the ext-host composes it, and captured into the seam with the same `setWire()`
 * activate() calls. Never the fake (`tests/helpers/fake-wire.mjs`) — the realness guard below refuses a stand-in, so
 * these suites cannot silently degrade to shape-only answers. Import this file FIRST in a suite that must run against
 * the real codec; the composed host's own real-wire boot (activate's capture, the boot probe) is compose.test's.
 */

import { createRequire } from "node:module";
import path from "node:path";
import { setWire } from "../../src/lib/codec.mjs";

const req = createRequire(import.meta.url);
// The wire package resolves the way production resolution does — it is a declared dependency of this package.
const wireRoot = path.dirname(req.resolve("@cldmv/digby-ext-wire/package.json"));
// zones declares no slothlet dependency; resolve it the way rummage does (its own copy).
const slothlet = (await import(createRequire(req.resolve("@cldmv/rummage/package.json")).resolve("@cldmv/slothlet"))).default;
const api = await slothlet({ base: path.join(wireRoot, "src", "api"), mode: "eager" });

// Realness guard: the fake answers rdata.encode with ASCII text; the real codec answers wire bytes (an A's address is
// four octets). A stand-in captured here would make every "real codec" assertion in these suites a lie.
const probe = api.wire.rdata.encode(api.wire.constants.type().A, { address: "192.0.2.1" });
if (!(probe instanceof Uint8Array) || probe.length !== 4 || probe[0] !== 192 || probe[3] !== 1) {
	throw new Error(`real-wire: the captured surface is not the wire codec (rdata.encode answered ${probe}) — refusing to run the real-codec suites against a stand-in`);
}
setWire(api.wire);
