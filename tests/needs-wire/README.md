# needs-wire — parked suites

These suites exercise the master-file reader and the exporter against the REAL wire codec (the presentation parser, the
rdata codec, the name and type tables). The wire extension (`@cldmv/digby-ext-wire`) has landed (CLDMV/digby#42), but
these suites only run where the wire package resolves — inside the workspace, next to its checkout — so they stay parked
OUTSIDE the vitest include glob (`.configs/vitest.config.mjs` excludes `tests/needs-wire/**`) and `npm test` does not run
them; the committed suite runs against the shape-only fake (`tests/helpers/fake-wire.mjs`) plus the composed-host suite
(`tests/compose.test.vitest.mjs`), and these run in a pod run against the real wire composed in-process
(`@cldmv/rummage/testing` `composeTestHost` — zones' own `activate()` captures the real surface into the seam,
`src/lib/codec.mjs`, never a deep import of another extension's lib).
