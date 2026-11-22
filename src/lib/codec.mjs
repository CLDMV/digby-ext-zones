/**
 * The one seam between digby-ext-zones and the DNS wire codec.
 *
 * The codec currently lives in `digby-ext-server/src/lib/wire/`, but no extension may import another composed extension's
 * lib — so the codec is moving to its own straight library package (orchestrator decision pending, CLDMV/digby#14 queue
 * item 2). Until it lands, this module is the ONLY place in this package that names the codec's specifier: every consumer
 * imports from here, and the import below is a PLACEHOLDER that becomes the new package name — replace it once, here.
 *
 * @module
 */

import {
	CLASS,
	TYPE,
	WireError,
	WireErrorCode,
	canonicalName,
	classToString,
	decodeRdataBytes,
	encodeRdataBytes,
	formatName,
	formatRdata,
	formatRecord,
	nameKey,
	parseName,
	parseRdata,
	parseRecord,
	parseTtl,
	typeToString,
} from "@cldmv/digby-ext-server"; // PLACEHOLDER — the codec library package's name replaces this when the move lands

export {
	CLASS,
	TYPE,
	WireError,
	WireErrorCode,
	canonicalName,
	classToString,
	decodeRdataBytes,
	encodeRdataBytes,
	formatName,
	formatRdata,
	formatRecord,
	nameKey,
	parseName,
	parseRdata,
	parseRecord,
	parseTtl,
	typeToString,
};
