# The compiled snapshot

The zone compiler (`src/lib/compiler.mjs`) turns one zone value plus its rrset values — the record shapes of CLDMV/digby#14, already parsed by the reader — into a single immutable snapshot: `{ zone, kind, disabled, serial, defaultTtl, soa, views }`, deeply frozen, shaped for the server's authoritative lookup. The server consumes it through `self.server.snapshot.set`. This document is the shape contract; the compiler is its implementation.

Compilation is pure: no I/O, no rummage calls, no filesystem. One call, `compileZone(zone, rrsets, previous, { now? })`, returns the snapshot or throws one `ZoneError` (codes below). `previous` is the zone's previous snapshot (or null on first compile) and drives the serial. `now` pins the clock for the `date` serial policy; production uses the real clock.

## Shape

```js
{
  zone: "homelab.cldmv.net.",   // the zone name as given (absolute, trailing dot)
  kind: "primary",              // primary | secondary | forward | stub
  disabled: false,              // true => views is {} and soa is null (below)
  serial: 2026112201,           // this compile's serial (the SOA serial to serve)
  defaultTtl: 3600,             // zone.defaultTtl, or 3600 when the zone has none
  soa: {                        // the apex SOA, synthesized from zone.soa (see "The SOA")
    ttl: 3600, records: [ /* the zone.soa rdata value */ ], source: "manual", comment: null
  },
  views: {
    "<view name>": {            // one entry per zone view, sorted by name
      nodes: {
        "<name>": {             // node keys are case-folded absolute names (see "Name keys")
          ent: false,           // empty non-terminal: the name exists, carries no records
          delegation: false,    // zone cut: a non-apex name with an NS rrset
          glue: false,          // the name lies strictly below a zone cut in this view
          rrsets: {
            "<type>": {      // the rrset's type NUMBER as a decimal object key (see "Type numbers")
              ttl: 3600,        // explicit ttl, else the zone's defaultTtl
              records: [ /* codec-parsed rdata values, in input order */ ],
              source: "manual", // manual | machines | transfer | acme
              comment: null,    // first non-null comment among the merged rrsets
              glue: true        // ONLY on A/AAAA at a delegation name
            }
          }
        }
      }
    }
  }
}
```

Per-type rrset entries appear under the rrset's type number as a decimal object key — `rrsets["1"]` is the A entry, `rrsets["2"]` NS, `rrsets["5"]` CNAME, `rrsets["12"]` PTR, and so on (the constants are the wire extension's `TYPE`, reached through the seam `src/lib/codec.mjs`; an object key is necessarily the number's decimal string). Types are numeric end to end: the rrset value's `type` field is a non-negative integer ≤ 65535 straight from the codec's `parseRecord`, and mnemonics are presentation-only (`typeToString`). Node keys and the view map are plain frozen objects (not `Map`s) so snapshots stay JSON-dumpable for the history drawer.

### Name keys

Node keys are lowercase absolute names: the codec's canonical form (`formatName(parseName(name))`, escape-normalized) with ASCII case folded. For ordinary names that is simply the lowercase name (`app.homelab.cldmv.net.`). The server lowercases a query name the same way before lookup, so a snapshot lookup is a plain property read. The zone name itself is stored on `snapshot.zone` exactly as given; only the keys are folded.

### The SOA

The SOA belongs to the zone value (`zone.soa`, one rdata value), never to an rrset: the compiler ignores any SOA-typed rrset on input and synthesizes the apex SOA from `zone.soa` — ttl `zone.defaultTtl` (or 3600), `records: [zone.soa]`, `source: "manual"`. The same frozen object is placed in `snapshot.soa` and in every view's apex node under the SOA type number (the same decimal-key rule as every rrset). `snapshot.serial` is the serial to serve; the server writes it into the SOA rdata's serial field when encoding answers — the rdata value in the snapshot keeps whatever serial it was parsed with.

## A worked example

Input — a primary zone with two views, a delegation with glue, a wildcard, an empty non-terminal, and a manual record scoped to `lan` over a machines record that serves every view:

```js
const zone = {
	name: "homelab.cldmv.net.",
	kind: "primary",
	views: ["lan", "tailnet"],
	soa: { mname: "ns1.homelab.cldmv.net.", rname: "host.homelab.cldmv.net.", serial: 2026112200, refresh: 7200, retry: 900, expire: 1209600, minimum: 86400 },
	serialPolicy: "date",
	defaultTtl: 3600,
	disabled: false
};

const rrsets = [
	{ zone: "homelab.cldmv.net.", name: "homelab.cldmv.net.", type: 2, view: null, ttl: 86400, records: [{ ns: "ns1.homelab.cldmv.net." }, { ns: "ns2.homelab.cldmv.net." }], source: "manual" },
	{ zone: "homelab.cldmv.net.", name: "gw.homelab.cldmv.net.", type: 1, view: null, ttl: null, records: [{ address: "10.0.0.1" }], source: "manual" },
	{ zone: "homelab.cldmv.net.", name: "app.homelab.cldmv.net.", type: 1, view: "lan", ttl: 300, records: [{ address: "10.0.0.2" }], source: "manual", comment: "app box" },
	{ zone: "homelab.cldmv.net.", name: "app.homelab.cldmv.net.", type: 1, view: null, ttl: null, records: [{ address: "10.0.0.9" }], source: "machines" },
	{ zone: "homelab.cldmv.net.", name: "sub.homelab.cldmv.net.", type: 2, view: null, ttl: 86400, records: [{ ns: "ns1.sub.homelab.cldmv.net." }], source: "manual" },
	{ zone: "homelab.cldmv.net.", name: "ns1.sub.homelab.cldmv.net.", type: 1, view: null, ttl: 86400, records: [{ address: "10.0.0.53" }], source: "manual" },
	{ zone: "homelab.cldmv.net.", name: "*.labs.homelab.cldmv.net.", type: 1, view: null, ttl: null, records: [{ address: "10.0.0.100" }], source: "manual" },
	{ zone: "homelab.cldmv.net.", name: "deep.labs.homelab.cldmv.net.", type: 1, view: null, ttl: null, records: [{ address: "10.0.0.101" }], source: "manual" }
];
```

Output — `snapshot.views.lan.nodes` (the `tailnet` view compiles the same way minus the `lan`-scoped override, so `app` carries only the machines record there):

```
"homelab.cldmv.net."                 apex: SOA (synthesized) + NS, ent:false delegation:false glue:false
"gw.homelab.cldmv.net."              A ttl 3600 (defaultTtl — the rrset's ttl was null) [10.0.0.1]
"app.homelab.cldmv.net."             A ttl 300 [10.0.0.2, 10.0.0.9] source "manual"
"sub.homelab.cldmv.net."             NS, delegation:true — the zone cut
"ns1.sub.homelab.cldmv.net."         node glue:true (below the cut); A carries no rrset-level glue flag, ttl 86400 [10.0.0.53]
"*.labs.homelab.cldmv.net."          A ttl 3600 [10.0.0.100] — stored literally; matching is the server's job
"labs.homelab.cldmv.net."            ent:true, rrsets:{} — empty non-terminal (deep.labs has records)
"deep.labs.homelab.cldmv.net."       A ttl 3600 [10.0.0.101]
```

Notes the example shows:

- **`app` in `lan` holds BOTH records.** The manual record is tagged `lan`, the machines record is tagged null — different tags, so no override (see the precedence rule). The merged entry's source is `"manual"` because a manual entry survived the merge.
- **`gw`'s ttl is the zone default.** The rrset said `ttl: null`.
- **`ns1.sub` is glue, not an empty non-terminal.** Names at or below a cut are never ENTs — the child zone owns that name space.
- **`sub`'s NS rrset is served** (delegation NS); the A at `ns1.sub` is marked `glue: true` and must not participate in normal answer synthesis — the server offers it only in the referral's additional section.

## Per-view compilation

Each view compiles independently. An rrset tagged `view: null` lands in EVERY view; one tagged `view: "lan"` only in `lan`. An rrset tagged a view the zone does not list is refused (`BAD_VIEW`); so is any view tag at all on a zone with no `views[]`. A zone with no views compiles to a single view keyed `"all"` (exported as `IMPLICIT_VIEW`) — every rrset there must be view-null.

## Refusals

Every refusal throws `ZoneError` — the package's own error type (`src/lib/errors.mjs`), extending `Error` directly, NOT the wire's `WireError` — carrying `code`, `message`, and `zone` / `owner` / `view` / `type` context; a wire failure underneath a refusal arrives as the standard `cause`. Codes:

| Code | Refuses |
|---|---|
| `BAD_ZONE` | a malformed zone value: missing/invalid name or kind, malformed or duplicated `views[]`, a bad `defaultTtl` |
| `BAD_SERIAL_POLICY` | `serialPolicy` is neither `"date"` nor `"increment"` |
| `APEX_SOA_REQUIRED` | an enabled zone with no `zone.soa` rdata |
| `APEX_NS_REQUIRED` | an enabled zone with no NS rrset at its apex (in any view — each view needs it) |
| `BAD_OWNER` | an rrset whose name does not parse, is not inside the zone, claims a different zone, or is missing |
| `BAD_TTL` | a ttl that is neither null/absent nor a non-negative integer (on the rrset or `zone.defaultTtl`) |
| `BAD_VIEW` | an rrset tagged a view the zone does not list, or tagged at all on a viewless zone |
| `BAD_SOURCE` | a source outside `manual`/`machines`/`transfer`/`acme` |
| `BAD_RECORD` | an rrset with no records, a non-array `records`, a `type` that is not a number in 0-65535, or not an object |
| `BAD_WILDCARD` | a `*` anywhere but the owner's first label (see the wildcard rule) |
| `CNAME_AT_APEX` | a CNAME at the zone apex |
| `CNAME_COEXISTENCE` | a CNAME beside any other data for the same name in the same view |
| `CNAME_MULTIPLE` | more than one CNAME record for the same name in the same view |

One `ZoneError` code is not a content refusal: `WIRE_NOT_READY` is thrown when a call reaches the wire before the root leaf's `activate()` captured the wire surface (`setWire`, `src/lib/codec.mjs` — the test setup captures a fake).

### The wildcard rule

A `*` may appear ONLY as the sole character of the owner's first label — the ordinary `*.example.` form, one or more labels below the apex. Refused: a `*` in any other label (`foo.*.example.`), a `*` inside a label (`ab*d.example.`), and any second `*` anywhere. The apex itself can never carry a wildcard (its name is fixed by the zone), so no separate apex check exists. A backslash-escaped octet is never a wildcard, whatever it escapes. Wildcard nodes are stored under their literal name; expanding `*` against query names is the server's lookup, not the compiler's.

### The CNAME rules

RFC 1034 exclusivity, per view, checked on the MERGED data (after override and merge): a name in a view may carry at most one CNAME record and nothing else beside it. The exact rule, in the order checked:

1. CNAME at the apex — refused, full stop (`CNAME_AT_APEX`).
2. More than one CNAME record for a name in a view — refused (`CNAME_MULTIPLE`). This catches both two CNAME rrsets (e.g. a manual and a machines one that merge) and one rrset carrying two CNAME records.
3. A CNAME beside any other rrset type for the same name in the same view — refused (`CNAME_COEXISTENCE`).

**No DNSSEC exception.** The compiler sees only rrset values; RRSIG/NSEC/etc. come from the `dnssec` subsystem and are not inputs here. So the rule refuses a CNAME beside ANY other compiled rrset, with no type exception — and the compiler makes no claim about coexistence with types it cannot see. If DNSSEC records ever become compiler inputs, rule 3 gains the RFC 4035 carve-outs explicitly.

## Override precedence

Within one view, for one name+type:

1. **Manual drops sourced, same tag only.** A `manual` rrset tagged view V drops every `machines`/`transfer`/`acme` rrset tagged view V for the same name+type — the sourced one is gone from that view entirely.
2. **Tags must match exactly, null included.** A manual record tagged `lan` does NOT override a sourced record tagged `tailnet` (different views), and does NOT override a sourced record tagged null — the null-view record serves every view, and the manual one was scoped to `lan` alone, so both survive in `lan`.
3. **Everything else merges.** Surviving rrsets for the same name+type in one view concatenate their `records` in input order; ttl = the first explicit ttl among them (else the zone default); comment = the first non-null comment; source = `"manual"` if any manual entry survived, else the first entry's source.

Consequence: on a viewless zone every tag is null, so a manual record fully overrides the sourced record it shares a name+type with.

## Serial

The zone has ONE serial — its SOA's — bumped only when some view's content changed. Content means the set of `(name, type, ttl, records)` tuples in the view; comments do NOT count, and neither do the derived markers (delegation/glue/ENT), which are functions of the records. Comparison is over a canonical fingerprint (object keys sorted, bytes as byte sequences), so equal content is equal regardless of property order. A view added or removed counts as a change. Unchanged content keeps the previous serial exactly — a recompile that changes nothing ships no bump.

Policies (`zone.serialPolicy`, default `"date"`):

- **`date`** — RFC 1912 `YYYYMMDDNN` (UTC). If the previous serial's day part is today, `NN` increments; at `NN` 99 it rolls to tomorrow's day part at `01`. Otherwise the day starts at `01`. A monotonic guard runs last: a candidate at or below the previous serial (a clock stepped back, or a serial left over from an increment era) becomes `previous + 1`.
- **`increment`** — `previous + 1`, never below the previous by construction; `1` with no previous.

First compile (no previous snapshot): `date` → today at `01`, `increment` → `1`. An unchanged compile with a previous snapshot returns that snapshot's serial unchanged; only a first compile computes a fresh base.

## Disabled zones

`zone.disabled: true` compiles to `{ zone, kind, disabled: true, serial, defaultTtl, soa: null, views: {} }` — marked, not excluded, so the server's snapshot surface stays uniform and serves nothing from it. The zone value is still validated (a malformed zone is malformed either way); the rrsets are not inspected and the content rules (apex SOA+NS, CNAME rules) do not apply — a zone may be disabled while half-built. The serial stands still at the previous snapshot's, or at the policy's base on first compile.

## Freezing

The snapshot is deep-frozen: every object and array (nodes, rrsets, records arrays, rdata values) is `Object.freeze`d, shared across views where the value is shared (the apex SOA is one frozen object in every view). Two caveats:

- Compiling freezes the caller's rdata values too — they become part of the snapshot. Reusing the same parsed values across recompiles is fine (freezing is idempotent); mutating them afterwards is not.
- `Uint8Array` rdata (TXT character-strings and the like) is left UNFROZEN — `Object.freeze` on a typed array with elements throws ("Cannot freeze array buffer views with elements"), so the deep freeze skips array-buffer views rather than refusing every zone that carries TXT, DS, SSHFP or generic `\#` rdata. The arrays' identity is still shared, not copied; treat them as read-only by convention, as the codec already does.

## Reverse zones

Reverse zones compile like any other: `0.0.10.in-addr.arpa.` and `1.0.10.in-addr.arpa.` with PTR rrsets (view-null for all views, typically) and their own SOA + apex NS. Nothing in the snapshot knows or cares that they are reverse zones; per-view snapshots and every rule above apply unchanged.
