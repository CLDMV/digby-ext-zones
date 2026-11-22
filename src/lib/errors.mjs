/**
 *	@Project: @cldmv/digby-ext-zones
 *	@Filename: /src/lib/errors.mjs
 *	@Date: 2026-11-22T09:39:54-08:00
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-22T09:39:54-08:00
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview The zones compiler's one error type, in the codec's `WireError` style. Every refusal the compiler reports is
 * a `ZoneError` with a stable `code`; nothing else escapes the public functions. `ZoneError` extends the codec's `WireError`
 * (imported through the one seam, `./codec.mjs`) so callers that catch `WireError` catch zone refusals too. The extra
 * context fields (`zone`, `owner`, `view`) say where the refusal came from.
 */

import { WireError } from "./codec.mjs";

/**
 * The zone compiler's error codes, grouped by the rule that refuses.
 * @readonly
 * @enum {string}
 */
export const ZoneErrorCode = Object.freeze({
	// Zone value
	BAD_ZONE: "BAD_ZONE", // the zone value itself is malformed (missing/invalid name, kind, views, defaultTtl)
	BAD_SERIAL_POLICY: "BAD_SERIAL_POLICY", // serialPolicy is neither "date" nor "increment"
	// Zone structure
	APEX_SOA_REQUIRED: "APEX_SOA_REQUIRED", // the zone value carries no soa rdata
	APEX_NS_REQUIRED: "APEX_NS_REQUIRED", // no NS rrset at the apex
	// RRset values
	BAD_OWNER: "BAD_OWNER", // an rrset whose name is outside the zone, relative, or claimed by another zone
	BAD_TTL: "BAD_TTL", // a ttl that is neither null nor a non-negative number
	BAD_VIEW: "BAD_VIEW", // an rrset tagged with a view the zone does not have (or tagged at all on a viewless zone)
	BAD_SOURCE: "BAD_SOURCE", // a source other than manual/machines/transfer/acme
	BAD_RECORD: "BAD_RECORD", // an rrset with no records, or a non-array records value
	BAD_WILDCARD: "BAD_WILDCARD", // a `*` that is not the sole character of the owner's first label
	// CNAME rules
	CNAME_AT_APEX: "CNAME_AT_APEX", // a CNAME at the zone apex
	CNAME_COEXISTENCE: "CNAME_COEXISTENCE", // a CNAME beside other data for the same name in the same view
	CNAME_MULTIPLE: "CNAME_MULTIPLE" // more than one CNAME record for the same name in the same view
});

/**
 * An error raised by the zone compiler.
 *
 * @example
 * try { compileZone(zone, rrsets, previous); } catch (err) { if (err instanceof ZoneError && err.code === "CNAME_AT_APEX") ... }
 */
export class ZoneError extends WireError {
	/**
	 * @param {string} code - one of {@link ZoneErrorCode}
	 * @param {string} message - a human-readable description
	 * @param {{ zone?: string, owner?: string, view?: string|null, type?: string }} [context] - where the refusal came from
	 */
	constructor(code, message, context) {
		super(code, message);
		this.name = "ZoneError";
		/** @type {string|undefined} */
		this.zone = context?.zone;
		/** @type {string|undefined} */
		this.owner = context?.owner;
		/** @type {string|null|undefined} */
		this.view = context?.view;
		/** @type {string|undefined} */
		this.type = context?.type;
	}
}

/**
 * Throw a {@link ZoneError}. A small helper so the check paths stay one line.
 * @param {string} code
 * @param {string} message
 * @param {{ zone?: string, owner?: string, view?: string|null, type?: string }} [context]
 * @returns {never}
 */
export function refuse(code, message, context) {
	throw new ZoneError(code, message, context);
}
