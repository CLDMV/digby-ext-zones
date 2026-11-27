# needs-wire — parked suites

These suites exercise the master-file reader and the exporter against a REAL wire codec (the presentation parser, the
rdata codec, the name and type tables). The wire extension (`@cldmv/digby-ext-wire`) does not exist yet — it arrives with
CLDMV/digby#42 — and the committed suite runs against a shape-only fake (`tests/helpers/fake-wire.mjs`) that has no codec
logic of its own. So these files are parked here, OUTSIDE the vitest include glob (`.configs/vitest.config.mjs` excludes
`tests/needs-wire/**`), and `npm test` does not run them.

When #42 lands: `git mv` them back under `tests/zones/` and delete this README. They then run against the real wire
extension composed next to zones — its surface reaches the lib only through the seam (`src/lib/codec.mjs`, captured from
`self.wire` by the root leaf's `activate()`), never a deep import of another extension's lib.
