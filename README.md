# @cldmv/digby-ext-zones

The zones extension of [Digby](https://github.com/CLDMV/digby): a [`@cldmv/rummage`](https://github.com/CLDMV/rummage#readme) extension.

The project is in active pre-release development on the [`dev`](https://github.com/CLDMV/digby-ext-zones/tree/dev) branch. `master` carries only the v4 CI wiring until the first release.

## The master-file reader

`src/lib/reader.mjs` holds `parseZoneFile(text, { kind })`: a pure reader for RFC 1035 master-file (zone-file) syntax — a string in, values out, no I/O and no rummage calls. It splits the text into logical records (`src/lib/reader-lines.mjs`: parenthesised multi-line records, `;` comments, quoted strings and escapes at the record level), resolves the `$ORIGIN` and `$TTL` directives, and hands each record to the codec's presentation parser through the one seam in `src/lib/codec.mjs`. Every failure is the package's own `ZoneError` (`BAD_PRESENTATION`), with the record's line appended to the codec's message and the wire failure underneath as `cause`.

`$INCLUDE` is refused (the reader is pure and does not resolve files — the caller owns file resolution), `$GENERATE` is refused as unimplemented, and any other `$...` directive is refused as unknown. Records are not written to storage here; the zone compiler owns validation (CNAME exclusivity, apex NS, wildcards, record membership).

The result is `{ zone, rrsets }`:

- `zone` is `{ name, kind, views, soa, defaultTtl }`. `name` is the owner of the SOA record, absolute and canonical; `kind` defaults to `primary` (the reader does not infer it); `views` is `[]` (another extension's concern); `soa` is the apex SOA's parsed rdata value; `defaultTtl` is the `$TTL` value, or the SOA's `minimum` field when the file gave no `$TTL`. `serialPolicy` is left unset — the server writes serials.
- each rrset is `{ zone, name, type, view, ttl, records, comment, source }`. `type` is the codec's numeric type number; `records` are the codec's parsed rdata values in file order; `view` is always `null` (all views — views are not a master-file concept); `comment` is the trailing `;` comment of the record line that opened the group (null when absent); `source` is always `"manual"`.

Documented choices:

- **TTL precedence**: an explicit record TTL wins over `$TTL`, which wins over the SOA's `minimum` field; a record with none of the three is an error. RFC 1035's older "last stated TTL" inheritance is deliberately not implemented.
- **Owner and class**: a line starting with whitespace inherits the previous record's owner; an omitted class defaults to IN, and a record with any other class is refused — this package is IN-only.
- **Grouping**: consecutive records with the same owner (compared case-insensitively) and type group into one rrset, records in file order; the rrset's `ttl` and `comment` come from the group's first record, and a later record with a different TTL does not change them.
- **Zone name**: taken from the SOA's owner; a file without exactly one SOA record is an error. The SOA is routed solely into `zone.soa` and never emitted as an rrset (the compiler ignores SOA rrsets in the snapshot). Records outside the zone's name (for example a reverse-zone PTR kept in the same file) are parsed as-is.
- **Comments**: a `;` comment inside a record's parentheses is dropped with the parenthesised text; only the comment on the record's final line becomes the rrset's `comment`.

## License

[Apache-2.0](./LICENSE)
