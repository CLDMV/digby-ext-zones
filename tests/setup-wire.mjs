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
 * @fileoverview The committed suite's wire: capture the fake wire surface before any test loads, standing in for the root
 * leaf's `activate()` (which captures `self.wire` at mount time). Every suite that reaches the wire does so through the
 * seam — see `tests/helpers/fake-wire.mjs` and, when the wire extension lands (#42), the parked suites in
 * `tests/needs-wire/`.
 */

import { setWire } from "../src/lib/codec.mjs";
import { fakeWire } from "./helpers/fake-wire.mjs";

setWire(fakeWire);
