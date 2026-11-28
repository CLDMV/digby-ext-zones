import { protectedSet } from "@cldmv/rummage/storage";
import { settings } from "../../../../sql/settings.mjs";

/**
 * Slothlet leaf — exposed at ext.<app>.zones.settings.set
 * (siblings reach it as self.settings.set).
 * Schema validation + access policy are enforced BEFORE the handler
 * below runs. The handler only sees writes that have already passed
 * those checks. Throw inside the handler to reject the write; the
 * storage commit happens AFTER the handler returns successfully.
 */

// The leaf's own function node (see settings/get.mjs): a single top-level expression reads 0/0 forever in V8's
// coverage pipeline, however it is tested. Same contract, same calls — a body of its own to attribute.
const set = protectedSet(settings, async () => {
	// The handler receives (key, value, ctx); declare them when you use them.
	// Empty handler is fine when there are no side effects — the next
	// reader picks up the new value lazily. Add side effects here if a
	// setting needs immediate action (apply theme, restart sub-service,
	// reconnect on auth change, etc.).
});

export default function settingsSet(key, value) {
	return set(key, value);
}
