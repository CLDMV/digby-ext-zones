import { protectedList } from "@cldmv/rummage/storage";
import { settings } from "../../../../sql/settings.mjs";

/**
 * Slothlet leaf — exposed at ext.<app>.zones.settings.list
 * (siblings reach it as self.settings.list).
 * Returns { key: { ...descriptor, current } } for every setting the
 * caller has read access to. Private settings the caller can't read
 * are silently omitted from the listing.
 */

// The leaf's own function node (see settings/get.mjs): a single top-level expression reads 0/0 forever in V8's
// coverage pipeline, however it is tested. Same contract, same calls — a body of its own to attribute.
const list = protectedList(settings);

export default function settingsList() {
	return list();
}
