/**
 *	@Project: @cldmv/digby-ext-zones
 *	@Filename: /src/api/zones/import/file.mjs
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
 * Slothlet leaf — exposed at `self.zones.import.file`: parse a master file (RFC 1035) into a zone value and its rrsets.
 * A thin leaf over the lib (`src/lib/reader.mjs`); the wire codec reaches it only through the seam, which holds the
 * surface the root leaf captured at `activate()`. Called before activate, it refuses with `ZoneError WIRE_NOT_READY`.
 */
export { parseZoneFile as default } from "../../../lib/reader.mjs";
