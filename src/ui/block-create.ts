/**
 * The "create a block" offer, worded once for every surface that makes it.
 *
 * Two places offer to author a block from what was typed: the Library panel's search and the
 * `+` insert picker. The picker used to have no offer at all, so a search that found nothing in
 * it was a dead end while the same search in the Library was one click from a new block. Both
 * read their label, title and icon from here so they cannot drift into describing the same act
 * differently; both act through `editor.beginBlockDraft`.
 *
 * Rendering stays with each surface, because one is a button under a grid of cards and the
 * other is an option in a listbox.
 */

/** What creating would make, given what has been typed. */
export function createBlockLabel(query: string): string {
  // Seeded from the query because "Create" and `Create "hero banner"` are different promises,
  // and the second one is the reason somebody is still reading.
  const seed = query.trim();
  return seed ? `Create "${seed}"` : 'Create a block';
}

export const CREATE_BLOCK_TITLE = 'Author a new block';

export const CREATE_BLOCK_ICON = 'plus';
