/*
 * @cldmv/digby-ext-zones — the NODE half's root leaf. The ext-host mounts this package's
 * src/api tree at ext.<app>.zones (filename-matches-folder flatten:
 * this file's exports land on the mount root). Sibling leaves reach each other
 * through slothlet's `self` — never by raw import (a raw import is a SECOND
 * module instance outside composition).
 *
 * Storage: this scaffold wires the storage tiers. If you don't need
 * persistence, delete sql/ and the setupSettings call below — the
 * extension still works without them.
 */

import { self } from "@cldmv/rummage/runtime";
import { setupSettings } from "@cldmv/rummage/storage";
import { settings as _settingsSchema } from "../../../sql/settings.mjs";
// Uncomment when you have tables to query:
// import { eq } from "@cldmv/rummage/storage";
// import { someTable } from "../../../sql/schema.mjs";
import { setWire } from "../../lib/codec.mjs";

export function activate(context) {
	// Wire this extension's settings declaration to its storage scope so the
	// sibling leaves at src/api/zones/settings/*.mjs can resolve what they
	// validate against + which scope to read/write. Must run before any
	// cross-extension call into our settings leaves.
	setupSettings({ settings: _settingsSchema, scope: context.storage, extId: context.extId });

	// Capture the wire extension's surface into the codec seam (src/lib/codec.mjs). The wire extension (manifest
	// `requires: ["@cldmv/digby-ext-wire"]`) is mounted and activated BEFORE this leaf runs. `self` is in-call-only —
	// activate is a call, so this is the one place `self.wire` resolves; the seam holds the capture and every lib read
	// resolves it per call. Fail fast, loudly, with the surface named: a missing or unpublished wire extension is a
	// mount-time error, not a decode-time one (the same pattern the server extension's activate uses).
	let wire;
	try {
		wire = self.wire;
	} catch (err) {
		throw new Error(
			`digby-ext-zones requires the @cldmv/digby-ext-wire extension — reading its surface (self.wire) failed (${err?.message ?? err}). Is wire in the app, and does this package declare it in its package.json dependencies?`
		);
	}
	// A host that never mounted wire (the fixture host whose manifest drops `requires`) reads `self.wire` as undefined
	// INSIDE a composed extent — the off-extent refusal is the branch above, this one is the undefined surface — so
	// name it before setWire's shape check, which would only say "must be an object" (the server extension's activate
	// has the same second branch).
	if (typeof wire?.errors?.is !== "function") {
		throw new Error(
			`digby-ext-zones requires the @cldmv/digby-ext-wire extension — self.wire.errors.is is ${wire === undefined ? "undefined" : typeof wire?.errors?.is}, not a function: the wire surface is not mounted or does not publish errors.is`
		);
	}
	// setWire fails fast on a wrong-shaped surface (a missing or mistyped leaf), BEFORE replacing the capture.
	setWire(wire);

	// Reading own settings (fast — the storage tier directly, no access check for self):
	// const theme = await context.storage.settings.get("theme");
	// Reading own custom tables:
	// const rows = await context.storage.db.select().from(someTable).all();

	// Register node-side commands here (the renderer reaches them via
	// context.ext.invoke("zones.<cmd>", …)). Track disposables on context.
	// context.commands.register("zones.hello", () => ({ ok: true }));
}

export function deactivate() {
	// Tear down anything not auto-disposed.
}
