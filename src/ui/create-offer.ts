/**
 * The "create it" offer, worded once for every surface that makes it.
 *
 * A search that finds nothing is the moment someone decides to make the thing, so four places
 * turn what was typed into an offer to create it: the Library panel's search and the `+` insert
 * picker (a block), the Styles header's class finder (a class) and the conditions bar's "Add a
 * media query" (a media query). They read their label, title
 * and icon from here so they cannot drift into describing the same act differently.
 *
 * Rendering stays with each surface, because one is a button under a grid of cards, one an option
 * in a listbox and one the empty state of a field's list.
 */

/**
 * What creating would make, given what has been typed: `Create "hero banner"`, or `Create a block`
 * before anything is. Seeded from the query because "Create" and `Create "hero banner"` are
 * different promises, and the second one is the reason somebody is still reading.
 */
export function createLabel(query: string, nothingTyped: string): string {
  return offerLabel('Create', query, nothingTyped);
}

/** `Create "x"`, `Add "x"`: the act and what it applies to, or the generic offer before typing. */
export function offerLabel(verb: string, query: string, nothingTyped: string): string {
  const seed = query.trim();
  return seed ? `${verb} "${seed}"` : nothingTyped;
}

export const CREATE_ICON = 'plus';

export function createBlockLabel(query: string): string {
  return createLabel(query, 'Create a block');
}

export const CREATE_BLOCK_TITLE = 'Author a new block';

export const CREATE_BLOCK_ICON = CREATE_ICON;

/** `Create ".hero"`: the name as it will be written, so the dot says what is being made. */
export function createClassLabel(name: string): string {
  const seed = name.trim().replace(/^\.+/, '');
  return createLabel(seed ? `.${seed}` : '', 'Create a class');
}

export const CREATE_CLASS_TITLE = 'Define this class and add it to the element';

/** `Add "print"`: a media query to put on the conditions bar, as it will be written. */
export function addMediaLabel(query: string): string {
  return offerLabel('Add', query.replace(/^\s*@media\s+/i, ''), 'Add a media query');
}

export const ADD_MEDIA_TITLE = 'Put this media query on the bar, to write styles under it';
