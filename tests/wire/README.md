# wire — the real-codec suites

These suites exercise the master-file reader and the exporter against the REAL wire codec — the wire extension's
composed api surface, captured into the seam by `tests/helpers/real-wire.mjs` (the same `setWire()` activate() calls;
the helper composes the wire package's api tree eagerly through slothlet and refuses a stand-in). They used to live in
`tests/needs-wire/`, parked OUTSIDE the vitest include while the wire extension was still landing (CLDMV/digby#42); the
wire is a declared dependency now, so they run in the committed suite like every other file. The shape-only fake
(`tests/helpers/fake-wire.mjs`) stays with the unit suites in `tests/zones/` — the compose and wire suites never see it.
