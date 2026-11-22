/**
 *	@Project: @cldmv/digby-ext-zones
 *	@Filename: /src/lib/reader.mjs
 *	@Date: 2026-11-22T09:41:47-08:00 (1795369307)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-22T09:41:47-08:00 (1795369307)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview The master-file reader: RFC 1035 zone-file syntax into a zone value and its rrsets. Pure — a string in,
 * values out, no I/O and no rummage calls. The reader owns the directives ($ORIGIN, $TTL), the standard omissions (owner,
 * TTL, class) and the grouping of consecutive records into rrsets; each record's tokens are parsed by the codec's
 * presentation parser, reached only through the one seam in `./codec.mjs`. $INCLUDE and $GENERATE are refused: the reader
 * is pure, so file resolution is the caller's decision, and generation is unimplemented.
 */

import { WireError, WireErrorCode, canonicalName, nameKey, parseRecord, parseTtl } from "./codec.mjs";
import { splitRecords } from "./reader-lines.mjs";

// The codec's IN class and SOA type numbers; the seam does not re-export the CLASS / TYPE tables.
const CLASS_IN = 1;
const TYPE_SOA = 6;

/**
 * A parsed zone value (CLDMV/digby#14's `zone` record shape, as far as the reader fills it).
 * @typedef {object} ZoneValue
 * @property {string} name - the zone's absolute canonical name: the owner of the SOA record
 * @property {"primary"} kind - the reader does not infer kind; the default, overridable by the caller
 * @property {[]} views - left empty; views are another extension's concern
 * @property {object} soa - the apex SOA's parsed rdata value ({ mname, rname, serial, refresh, retry, expire, minimum })
 * @property {number} defaultTtl - the $TTL value, or the SOA's minimum when there was no $TTL
 */

/**
 * A parsed rrset value (CLDMV/digby#14's `rrset` record shape).
 * @typedef {object} RrsetValue
 * @property {string} zone - the zone's name
 * @property {string} name - the owner, absolute and canonical
 * @property {number} type - the codec's numeric type number
 * @property {null} view - always null (all views); views are not a master-file concept
 * @property {number} ttl - the group's first record's TTL
 * @property {object[]} records - the parsed rdata values, in file order
 * @property {string|null} comment - the trailing `;` comment of the record line that opened the group
 * @property {"manual"} source
 */

/**
 * Parse a master file (RFC 1035 5) into a zone value and its rrsets.
 *
 * Directives: `$ORIGIN <name>` (relative names complete against the previous origin) and `$TTL <ttl>`; `$INCLUDE`,
 * `$GENERATE` and anything else `$...` is refused. Records: `name [ttl] [class] type rdata`, with the owner inheritable
 * across blank-name lines (a line starting with whitespace), the TTL defaulting to $TTL then the SOA's minimum, and the
 * class defaulting to IN (any other class is refused — this package is IN-only). Records are grouped into rrsets when
 * consecutive lines share owner, type and class (owner names compared case-insensitively); the codec's rdata values keep
 * file order within the group.
 *
 * @param {string} text - the master file
 * @param {{ kind?: string }} [options]
 * @returns {{ zone: ZoneValue, rrsets: RrsetValue[] }}
 * @throws {import("./codec.mjs").WireError} every failure is a WireError: the codec's own presentation errors with the
 *   record's line appended, or a reader error naming the line for directives, class and grouping-level problems
 */
export function parseZoneFile(text, { kind = "primary" } = {}) {
	const records = splitRecords(text);

	let origin; // the current $ORIGIN, absolute
	let ttlDirective; // the current $TTL
	let soaMinimum; // the SOA's minimum field, once seen — the last link of the TTL precedence chain
	let lastOwner; // the previous record's owner, for blank-name lines
	let soa = null;
	let zoneName = null;
	/** @type {RrsetValue[]} */
	const rrsets = [];
	let last = null; // the rrset the previous record appended to

	for (const rec of records) {
		if (rec.isDirective) {
			const [word, ...args] = rec.args;
			switch (word) {
				case "$ORIGIN":
					if (args.length !== 1) throw bad(`line ${rec.line}: $ORIGIN takes exactly one domain name`);
					origin = withLine(() => canonicalName(args[0], origin), rec.line);
					break;
				case "$TTL":
					if (args.length !== 1) throw bad(`line ${rec.line}: $TTL takes exactly one TTL`);
					ttlDirective = withLine(() => parseTtl(args[0]), rec.line);
					break;
				case "$INCLUDE":
					throw bad(
						`line ${rec.line}: $INCLUDE is refused — the reader is pure and does not resolve files; the caller owns file resolution`
					);
				case "$GENERATE":
					throw bad(`line ${rec.line}: $GENERATE is not implemented`);
				default:
					throw bad(`line ${rec.line}: unknown directive "${word}"`);
			}
			continue;
		}

		if (rec.blankOwner && lastOwner === undefined) throw bad(`line ${rec.line}: the record has no owner and no previous owner to inherit`);
		const line = rec.blankOwner ? `${lastOwner} ${rec.text}` : rec.text;
		const parsed = withLine(() => parseRecord(line, { origin, ttl: ttlDirective ?? soaMinimum }), rec.line);
		if (parsed.class !== CLASS_IN) throw bad(`line ${rec.line}: only the IN class is supported, got ${parsed.class}`);
		lastOwner = parsed.name;

		if (parsed.type === TYPE_SOA) {
			if (soa !== null) throw bad(`line ${rec.line}: a zone file has one SOA record`);
			soa = parsed.data;
			zoneName = parsed.name;
			soaMinimum = parsed.data.minimum;
		}

		// Group consecutive records with the same owner (case-insensitive) and type; the class is IN throughout.
		const key = `${nameKey(parsed.name)}|${parsed.type}`;
		if (last !== null && last._key === key) last.records.push(parsed.data);
		else {
			last = {
				name: parsed.name,
				type: parsed.type,
				view: null,
				ttl: parsed.ttl,
				records: [parsed.data],
				comment: rec.comment,
				source: "manual",
				_key: key
			};
			rrsets.push(last);
		}
	}

	if (soa === null) throw bad("the master file has no SOA record");

	return {
		zone: { name: zoneName, kind, views: [], soa, defaultTtl: ttlDirective ?? soaMinimum },
		rrsets: rrsets.map(({ _key, ...rrset }) => ({ ...rrset, zone: zoneName }))
	};
}

/**
 * A reader error carrying the record's line.
 * @param {string} message
 * @returns {WireError}
 */
function bad(message) {
	return new WireError(WireErrorCode.BAD_PRESENTATION, message);
}

/**
 * Run a codec parse, and re-raise its WireError with the record's line appended so a master-file error names where it
 * happened. Only WireErrors are decorated; anything else is a bug and escapes as-is.
 * @template T
 * @param {() => T} run
 * @param {number} line
 * @returns {T}
 */
function withLine(run, line) {
	try {
		return run();
	} catch (err) {
		if (!(err instanceof WireError)) throw err;
		throw new WireError(err.code, `${err.message} (master file line ${line})`, err.offset);
	}
}
