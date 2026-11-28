/**
 *	@Project: @cldmv/digby-ext-zones
 *	@Filename: /tests/setup-wire.mjs
 *	@Date: 2026-11-25T00:00:00-08:00
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-25T00:00:00-08:00
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview The unit suites' wire: the FAKE surface, captured when a suite imports this file — first import, so the
 * suites' module-level `TYPE` reads see the capture too. Suite-scoped by design: the composed-host suites
 * (tests/compose.test.vitest.mjs, tests/compose-no-wire.test.vitest.mjs) and the real-codec suites (tests/wire/) must
 * exercise the REAL wire — activate's own capture, or `tests/helpers/real-wire.mjs` — never this stand-in. (A GLOBAL
 * setup here is exactly what once masked activate's wire fail-fast behind the fake's parse error: the fake was already
 * captured when a boot without wire should have failed loudly.)
 */

import { setWire } from "../src/lib/codec.mjs";
import { fakeWire } from "./helpers/fake-wire.mjs";

setWire(fakeWire);
