import { protectedGet } from "@cldmv/rummage/storage";
import { settings } from "../../../../sql/settings.mjs";

/**
 * Slothlet leaf — exposed at ext.<app>.zones.settings.get
 * (siblings reach it as self.settings.get).
 * Cross-extension calls go through this wrapper; it consults the
 * declaration in sql/settings.mjs to validate the caller's read access.
 * Own-extension reads should use `context.storage.settings.get(key)`
 * directly from activate() — faster, no access check needed for self.
 */

// The leaf's own function node: V8's coverage pipeline counts function ranges, so a leaf whose code is a single
// top-level expression (`export default protectedGet(settings)`) reads 0/0 forever however it is tested — the
// function that runs belongs to @cldmv/rummage's protected.mjs, not to this file (the r2 review's cov2 R9 found the
// same for a wrapper leaf). Hoisting the wrapper keeps the leaf a plain function — same contract, same calls — and
// gives it a body of its own to attribute.
const get = protectedGet(settings);

export default function settingsGet(key) {
	return get(key);
}
