/**
 *	@Project: @cldmv/digby-ext-zones
 *	@Filename: /src/api/zones/export/snapshot.mjs
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
 * Slothlet leaf — exposed at `self.zones.export.snapshot`: export one view of a compiled snapshot as a master file. A
 * thin leaf over the lib (`src/lib/export.mjs`); the wire codec reaches it only through the seam, which holds the
 * surface the root leaf captured at `activate()`. Called before activate, it refuses with `ZoneError WIRE_NOT_READY`.
 */
export { exportSnapshot as default } from "../../../lib/export.mjs";
