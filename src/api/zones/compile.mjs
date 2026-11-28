/**
 *	@Project: @cldmv/digby-ext-zones
 *	@Filename: /src/api/zones/compile.mjs
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
 * Slothlet leaf — exposed at `self.zones.compile`: compile a zone value and its rrsets into the frozen per-view snapshot.
 * A thin leaf over the lib (`src/lib/compiler.mjs`); the wire codec reaches it only through the seam, which holds the
 * surface the root leaf captured at `activate()`. Called before activate, it refuses with `ZoneError WIRE_NOT_READY`.
 */
export { compileZone as default } from "../../lib/compiler.mjs";
