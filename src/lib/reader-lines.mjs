/**
 *	@Project: @cldmv/digby-ext-zones
 *	@Filename: /src/lib/reader-lines.mjs
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
 * @fileoverview Splitting a master file into logical records: a record may span physical lines inside `( ... )`, and `;`
 * comments, blank lines and quoted strings (which may hold `;` and parentheses) are respected while the parentheses are
 * counted. This is record-level structure only — token-level work (escapes, `key="value"` quoting) is the codec's
 * tokenizer's job, and the record text is handed to it unmodified.
 */

import { ZoneErrorCode, refuse } from "./errors.mjs";

/**
 * One logical record of a master file.
 * @typedef {object} MasterRecord
 * @property {string} text - the record's text, physical lines joined with `\n` (comments and parentheses left in place;
 *   the codec's tokenizer strips them)
 * @property {number} line - the 1-based physical line the record starts on
 * @property {boolean} blankOwner - the record's first physical line starts with whitespace, so the owner field is omitted
 *   (RFC 1035 5.1) and the previous owner is inherited
 * @property {boolean} isDirective - the record's first physical line starts with `$` in column 1
 * @property {string|null} comment - the text after the `;` that ends the record's last line, trimmed (null when absent)
 * @property {string[]} [args] - directives only: the whitespace-split tokens of the first line's comment-stripped text
 */

/**
 * Scan one physical line for record-level structure, updating `state` (parenthesis depth and whether a quoted string is
 * open, both carried across lines). A `;` outside quotes starts a comment that runs to the end of the line — even inside
 * parentheses, so a `)` after it does not count; a `\X` escape is skipped, and inside a quote every character is literal
 * except the closing `"` and an escaped one.
 *
 * @param {string} line
 * @param {{ depth: number, inQuote: boolean }} state - read at entry, written by the caller from the result
 * @returns {{ depth: number, inQuote: boolean, commentAt: number }} `commentAt` is the index of the `;` that opens the
 *   line's comment, or -1
 */
function scanLine(line, state) {
	let { depth, inQuote } = state;
	let commentAt = -1;
	let i = 0;
	while (i < line.length) {
		const ch = line[i];
		if (inQuote) {
			if (ch === "\\") i++; // skip the escaped character with it
			else if (ch === '"') inQuote = false;
			i++;
			continue;
		}
		if (ch === '"') {
			inQuote = true;
			i++;
		} else if (ch === "\\") {
			i += 2; // the escaped character: not a delimiter
		} else if (ch === ";") {
			commentAt = i;
			break;
		} else if (ch === "(") {
			depth++;
			i++;
		} else if (ch === ")") {
			depth--;
			i++;
		} else {
			i++;
		}
	}
	return { depth, inQuote, commentAt };
}

/**
 * Split master-file text into its logical records, in file order. Blank lines and comment-only lines are dropped; they
 * belong to no record and break nothing (owner inheritance carries across them).
 *
 * @param {string} text
 * @returns {MasterRecord[]}
 * @throws {import("./errors.mjs").ZoneError} BAD_PRESENTATION for a stray `)`, an unterminated quoted string or an
 *   unclosed `(` at end of file, each with the line it starts on
 */
export function splitRecords(text) {
	if (typeof text !== "string") refuse(ZoneErrorCode.BAD_PRESENTATION, "the master file must be a string");
	const records = [];
	const lines = text.split(/\r\n|\r|\n/);
	const state = { depth: 0, inQuote: false };
	let cur = null;

	for (let n = 0; n < lines.length; n++) {
		const line = lines[n];
		const at = n + 1;
		const scanned = scanLine(line, state);
		if (scanned.depth < 0) refuse(ZoneErrorCode.BAD_PRESENTATION, `line ${at}: unbalanced ')'`);

		if (state.depth === 0 && !state.inQuote) {
			// a new logical record may start on this line
			const head = line.trim();
			const commentOnly = scanned.commentAt !== -1 && line.slice(0, scanned.commentAt).trim() === "";
			if (head !== "" && !commentOnly) {
				cur = {
					text: line,
					line: at,
					blankOwner: line[0] === " " || line[0] === "\t",
					isDirective: line[0] === "$",
					comment: null
				};
			}
		} else if (cur !== null) {
			cur.text += `\n${line}`;
		}

		state.depth = scanned.depth;
		state.inQuote = scanned.inQuote;

		if (cur !== null && state.depth === 0 && !state.inQuote) {
			// the record ends on this line: its trailing comment, and the directive's arguments, come from it
			if (scanned.commentAt !== -1) cur.comment = line.slice(scanned.commentAt + 1).trim();
			if (cur.isDirective) {
				const nl = cur.text.indexOf("\n");
				const firstLine = nl === -1 ? cur.text : cur.text.slice(0, nl);
				const first = scanLine(firstLine, { depth: 0, inQuote: false });
				cur.args = firstLine.slice(0, first.commentAt === -1 ? firstLine.length : first.commentAt).trim().split(/\s+/);
			}
			records.push(cur);
			cur = null;
		}
	}

	if (cur !== null) {
		if (state.inQuote) refuse(ZoneErrorCode.BAD_PRESENTATION, `line ${cur.line}: an unterminated quoted string`);
		refuse(ZoneErrorCode.BAD_PRESENTATION, `line ${cur.line}: unbalanced '(' — the record is never closed`);
	}
	return records;
}
