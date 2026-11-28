# The master-file exporter

`src/lib/export.mjs` turns zone values back into RFC 1035 master-file text: `exportZone(zone, rrsets)` renders one zone and its rrsets, and `exportSnapshot(snapshot, { view })` renders one view of a compiled snapshot (docs/snapshot.md). Both are pure — no I/O, no rummage calls — and both produce text that `parseZoneFile` reads back. The round-trip is the contract this document specifies; the reader (docs in the README) is the other half of it.

## What the text carries

A master file has no opinion about most of the record store: `kind`, `serialPolicy`, `disabled`, the view structure, rrset `source`, and per-zone metadata beyond the reader's shape are store concepts with no master-file form. `exportZone` carries the zone's `name`, `soa`, `defaultTtl` and the rrsets' names, types, TTLs, records and comments; `exportSnapshot` carries the view's records and the serial, and nothing else. A caller that round-trips through text keeps everything else in its own store.

Rdata is rendered by the codec's `formatRdata`, which validates by encoding and re-decoding before formatting (CLDMV/digby#37) — so every record in the exported text is the canonical presentation of rdata that actually encodes. A wire failure (an unparseable name, rdata the formatter refuses) is wrapped in the exporter's own `ZoneError` with the wire failure underneath as `cause` — the package's error contract (errors.mjs) holds everywhere. The exporter's own refusals (a view-tagged rrset, a zone without SOA rdata, a type that is not a number, an unresolved view, a disabled snapshot) are `ZoneError`s with the compiler's codes.

## Round-trip contract

`parseZoneFile(exportZone(zone, rrsets))` reproduces `{ zone, rrsets }` up to these normalizations, each a direct consequence of the reader's precedence rules:

- **Names are canonical and absolute.** The owner's relative form (below) re-parses against `$ORIGIN`, so the round-tripped name is the original spelling for the labels the zone name supplies and the record's own spelling for the rest. Names are escape-normalized by the codec.
- **Types are numeric in, mnemonics out.** A rrset's numeric type renders as its mnemonic (`A`, `MX`, or RFC 3597 `TYPEnnn` for a type without one) and parses back to the same number.
- **Grouping follows adjacency.** The reader groups consecutive records with the same owner (case-insensitively) and type into one rrset, taking the group's TTL from the first record. Exporting two adjacent rrsets that share a name and type therefore reads back as one merged rrset; the exporter emits one line per record precisely so same-name-and-type neighbors re-group.
- **TTL inheritance is lossless by construction.** See "TTL forms" — a record whose TTL token is omitted parses back with exactly the TTL it had.
- **Comments are trimmed.** A group's comment renders as a trailing `; comment` on the line that opens the group; the reader trims it, so surrounding whitespace is not preserved, and the comment is one line (the reader can only ever produce single-line comments).
- **`source` and `view` reset.** Everything reads back `source: "manual"`, `view: null`, `zone` set to the zone name.

`exportSnapshot(snapshot, { view })` → parse → `compileZone` reproduces the view's content: recompiled with a `previous` scoped to the exported view (same serial, that view's nodes), the serial stands still and the view deep-equals the original's. For a viewless snapshot the original snapshot itself is the right `previous`. The caller re-tags the parsed zone with the exported view's name, because the reader always yields `views: []` and view-null rrsets — a view-set change is a content change by the compiler's rules, which is exactly why the scoped `previous` is the honest comparison for a single-view recompile.

## The minimal-faithful forms

### TTL

Let `def` be the effective default: `zone.defaultTtl` when it is a number, else the SOA's `minimum` — the same precedence the reader applies, so a zone value stored without a `defaultTtl` exports correctly and reads back with `defaultTtl` set to the SOA minimum (a documented normalization).

- **A record's TTL token is emitted only when its ttl differs from `def`.** A record at `def` renders without a TTL and inherits it back on parse — from `$TTL`, or from the SOA minimum when there is no directive. A null/undefined ttl renders without a token too, and reads back as `def`.
- **`$TTL <def>` is emitted only when it is load-bearing**: the zone's `defaultTtl` is a number that differs from the SOA's `minimum`. When the two are equal, the reader derives `def` from the SOA minimum and the directive would be redundant. This is what makes `zone.defaultTtl` round-trip: it either matches the SOA minimum (recovered from there) or is carried by the directive.
- **The SOA renders with an explicit TTL equal to `def`.** The reader discards the SOA record's own TTL (the SOA is routed solely into `zone.soa`), so this value is presentation-only; it exists because a TTL-less record is only legal after a `$TTL`, and `$TTL` is not always emitted.

### Owner names

The owner form is derived by label-count logic on the parsed labels — never a string suffix test, so an escaped dot inside a label (`router\.point`) stays label content:

- `@` when the owner IS the zone name (exact bytes).
- The relative prefix — the owner's leading labels, formatted and joined — when the owner's trailing labels byte-match the zone name's labels. The match is case-sensitive on purpose: a name whose trailing labels merely case-fold to the zone name's keeps the absolute form, so the original spelling survives the round-trip (the reader preserves the first spelling it sees).
- The absolute canonical form otherwise (including out-of-zone names such as a reverse-zone PTR owner kept in the same file, and names whose suffix case differs).

Rdata names (CNAME targets, MX exchanges, SOA mname/rname, NS targets) always render absolute — the codec's formatters emit canonical absolute names, and the reader completes them the same way either way.

## Snapshot export

- `$ORIGIN <snapshot.zone>` once; `$TTL` under the same rule as above, with `snapshot.defaultTtl` as `def`.
- The apex node renders first: the SOA, then the apex's remaining types in ascending type number. Every other node follows in ascending order of its folded node key (the compiler's lowercase canonical form) — a deterministic, diff-friendly order; it is lexicographic on the dotted name, not RFC 4034 canonical ordering, and order does not affect the round-trip. Within a node, types render in ascending type number.
- **The SOA carries the snapshot's serial, inlined** over the rdata's own serial field — exactly what the server does when serving an answer, since `snapshot.soa.records[0]` deliberately keeps the serial it was parsed with while `snapshot.serial` is the serial to serve. That is the one field the reader recovers into `zone.soa`. The corollary: when the zone value's SOA serial has been left stale (the compiler never rewrites `zone.soa`), the exported text reads back as changed SOA content and the recompile bumps the serial once. When the store keeps `zone.soa.serial` in step with `snapshot.serial`, the round-trip stands the serial still.
- Delegation NS and glue A/AAAA are exported like any other data — a master file legitimately contains them, and the recompiler re-derives the delegation and glue markers from them. Empty non-terminal nodes (no rrsets) emit nothing; the recompiler recreates them from the records below.
- A node's rrset renders as one group of consecutive lines with the node rrset's TTL and its comment on the first line. Nodes' merged records keep the compiler's merged order.

## Refusals

| Where | Code | When |
| --- | --- | --- |
| `exportZone` | `BAD_ZONE` | the zone is not an object, or `name` is missing/empty |
| `exportZone` | `APEX_SOA_REQUIRED` | the zone carries no `soa` rdata |
| `exportZone` | `BAD_VIEW` | an rrset carries a view tag (a master file has no views) |
| `exportZone` | `BAD_RECORD` | an rrset is not an object, its type is not a number in 0–65535, or it carries no records |
| `exportZone` | `BAD_TTL` | an rrset's ttl is neither null/undefined nor a non-negative integer |
| `exportSnapshot` | `BAD_ZONE` | the snapshot is disabled (no content to export), or the view is not named on a multi-view snapshot, or names a view the snapshot does not have |
| `exportSnapshot` | `APEX_SOA_REQUIRED` | the snapshot carries no SOA rdata |
| `exportZone` | `BAD_ZONE` (wire failure as `cause`) | the zone's name does not parse as an absolute name |
| `exportZone` | `BAD_OWNER` (wire failure as `cause`) | an rrset's owner does not parse as an absolute name (including a relative one — rrset names must be absolute) |
| `exportZone` / `exportSnapshot` | `BAD_RECORD` (wire failure as `cause`) | rdata the formatter refuses |
| `exportSnapshot` | `BAD_ZONE` (wire failure as `cause`) | the snapshot's zone name or a node key does not parse as an absolute name |

A wire failure is recognized with the seam's `isWireError` predicate (the wire's error class is not a leaf) and wrapped: the exported text only ever refuses with `ZoneError`, and the codec's own message rides along as `cause`. Everything the compiler accepted as a shape exports without a fuss.
