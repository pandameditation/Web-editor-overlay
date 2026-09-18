/**
 * Unit tests for the shared declaration-block model.
 *
 * In plain Node, which is the point of the module having no DOM in it. Three implementations of
 * these rules drifted apart while they lived in three files; one implementation with one test is
 * the only thing that keeps them from drifting again. Run with:
 *
 *     npm run test:declarations
 */
import assert from 'node:assert/strict';
import {
  declares,
  displayOrder,
  fromRecord,
  groupFor,
  promote,
  shorthandChain,
  shorthandGroups,
  shorthandsFor,
  toRecord,
  valueOf,
  withPromotedSide,
  withValue,
  type Declaration,
} from '../src/core/declaration-list.ts';

let passed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
  } catch (error) {
    failures.push(`${name}\n    ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** `padding=12px color=#222` reads as a block, so the assertions stay legible. */
const block = (text: string): Declaration[] =>
  text
    .split(/\s+/)
    .filter(Boolean)
    .map((pair) => {
      const bang = pair.endsWith('!');
      const [property, value] = (bang ? pair.slice(0, -1) : pair).split('=');
      return { property, value, important: bang };
    });

/** Back to the same shorthand, so a result can be compared as one string. */
const flat = (list: readonly Declaration[]): string =>
  list.map((one) => `${one.property}=${one.value}${one.important ? '!' : ''}`).join(' ');

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

test('the value in effect is the last declaration of the property', () => {
  // Which is what a browser does with a repeated name, and what makes the
  // prefixed-then-standard fallback pair work.
  assert.equal(valueOf(block('color=red color=#0a0'), 'color'), '#0a0');
  assert.equal(valueOf(block('color=red'), 'padding'), null);
});

test('property names are matched case-insensitively', () => {
  assert.equal(valueOf(block('Padding=1px'), 'padding'), '1px');
  assert.ok(declares(block('Padding=1px'), 'PADDING'));
});

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

test('adding a declaration puts it last', () => {
  // Where the author would have typed it, and where the file patcher inserts it.
  assert.equal(
    flat(withValue(block('padding=12px color=#222'), 'padding-left', '0')),
    'padding=12px color=#222 padding-left=0',
  );
});

test('editing a declaration leaves it exactly where it was', () => {
  // Moving it would change which of two competing declarations wins.
  assert.equal(
    flat(withValue(block('padding=12px color=#222'), 'padding', '20px')),
    'padding=20px color=#222',
  );
});

test('an empty value removes the declaration, and removing an absent one is a no-op', () => {
  assert.equal(flat(withValue(block('padding=12px color=#222'), 'padding', '')), 'color=#222');
  assert.equal(flat(withValue(block('color=#222'), 'padding', '')), 'color=#222');
});

test('a repeated name is edited at its last occurrence, not its first', () => {
  // The last one is the one in effect. Rewriting the earlier one would silently edit a fallback
  // that exists precisely so an older browser can take it.
  assert.equal(
    flat(withValue(block('color=red color=#0a0'), 'color', 'blue')),
    'color=red color=blue',
  );
});

test('a differently cased name matches but does not rewrite the existing spelling', () => {
  assert.equal(flat(withValue(block('padding=12px'), 'PADDING', '4px')), 'padding=4px');
});

test('important rides along as a flag', () => {
  assert.equal(flat(withValue(block('color=#222'), 'padding', '1px', true)), 'color=#222 padding=1px!');
});

/* -------------------------------------------------------------------------- */
/* Promotion                                                                   */
/* -------------------------------------------------------------------------- */

test('promoting moves declarations last, keeping their order relative to each other', () => {
  assert.equal(
    flat(promote(block('a=1 b=2 c=3 d=4'), ['b', 'd'])),
    'a=1 c=3 b=2 d=4',
  );
});

test('promoting changes nothing but the order', () => {
  const before = block('padding=12px padding-left=0 color=#222');
  const after = promote(before, ['padding']);
  assert.equal(after.length, before.length);
  assert.deepEqual(
    [...after].map((one) => one.property).sort(),
    [...before].map((one) => one.property).sort(),
  );
});

/* -------------------------------------------------------------------------- */
/* Shorthands                                                                  */
/* -------------------------------------------------------------------------- */

test('a longhand knows the shorthands that would overwrite it', () => {
  assert.deepEqual(shorthandsFor('padding-left'), ['padding']);
  /*
   * Two parents, not one. `border-left` sets the left side's width, style and colour;
   * `border-width` sets all four widths. Both overwrite `border-left-width`, so treating this as a
   * chain with a single answer got one of them wrong every time.
   */
  assert.deepEqual(shorthandsFor('border-left-width'), ['border-left', 'border-width']);
  // Breadth-first, so the outermost shorthand is last. Callers rely on that ordering.
  assert.deepEqual(shorthandChain('border-left-width'), ['border-left', 'border-width', 'border']);
  assert.deepEqual(shorthandChain('border-top-left-radius'), ['border-radius']);
  assert.deepEqual(shorthandChain('color'), []);
});

test('a group forms only when both sides are in the block', () => {
  // Nothing is competing otherwise, and moving a line would be churn.
  assert.deepEqual(shorthandGroups(block('padding=12px color=#222')), []);
  assert.deepEqual(shorthandGroups(block('padding-left=0 color=#222')), []);
  assert.equal(shorthandGroups(block('padding=12px padding-left=0')).length, 1);
});

test('the winner is whichever side comes last, which is a reading and not a preference', () => {
  assert.equal(shorthandGroups(block('padding=12px padding-left=0'))[0].winner, 'longhands');
  assert.equal(shorthandGroups(block('padding-left=0 padding=12px'))[0].winner, 'shorthand');
});

test('a nested chain collapses into one group under the outermost shorthand', () => {
  // The user's question is which of these lines is in charge, and `border` is in charge of all of
  // them. Two nested groups would ask that twice and answer it inconsistently.
  const groups = shorthandGroups(block('border=1px_solid border-left=2px_solid border-left-width=3px'));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].shorthand, 'border');
  assert.deepEqual(groups[0].longhands, ['border-left', 'border-left-width']);
});

test('two independent groups in one block stay independent', () => {
  const groups = shorthandGroups(block('margin=1px margin-top=2px padding=3px padding-left=4px'));
  assert.deepEqual(
    groups.map((group) => group.shorthand),
    ['margin', 'padding'],
  );
  assert.deepEqual(groups[0].longhands, ['margin-top']);
  assert.deepEqual(groups[1].longhands, ['padding-left']);
});

test('a property finds its own group from either side', () => {
  const list = block('padding=12px padding-left=0');
  assert.equal(groupFor(list, 'padding')?.shorthand, 'padding');
  assert.equal(groupFor(list, 'padding-left')?.shorthand, 'padding');
  assert.equal(groupFor(list, 'color'), undefined);
});

/* -------------------------------------------------------------------------- */
/* Promote-on-edit                                                             */
/* -------------------------------------------------------------------------- */

test('touching the shorthand makes the shorthand win', () => {
  assert.equal(
    flat(withPromotedSide(block('padding=12px padding-left=0 color=#222'), 'padding')),
    'padding-left=0 color=#222 padding=12px',
  );
});

test('touching a longhand makes the whole longhand group win, contiguously', () => {
  // The group moves as a unit because the panel offers it one shared control: the group is what a
  // user reasons about, not the individual side.
  assert.equal(
    flat(withPromotedSide(block('padding=12px padding-left=0 padding-top=1px color=#222'), 'padding-top')),
    'padding=12px color=#222 padding-left=0 padding-top=1px',
  );
});

test('promoting a side that already wins is stable', () => {
  // No churn on a second edit of the same side, so a file does not gain a diff for nothing.
  const list = block('padding-left=0 padding=12px');
  assert.equal(flat(withPromotedSide(list, 'padding')), 'padding-left=0 padding=12px');
});

test('with no competing side, promotion leaves the block alone', () => {
  assert.equal(
    flat(withPromotedSide(block('padding=12px color=#222'), 'padding')),
    'padding=12px color=#222',
  );
});

/* -------------------------------------------------------------------------- */
/* Display order                                                               */
/* -------------------------------------------------------------------------- */

/** `padding[padding-left]` is a family; a bare name is a plain row. */
const shown = (list: readonly Declaration[]): string =>
  displayOrder(list)
    .map((entry) =>
      entry.kind === 'row'
        ? entry.property
        : `${entry.group.shorthand}[${entry.group.longhands.join(',')}]`,
    )
    .join(' ');

test('with no family, the display order is the block order', () => {
  assert.equal(shown(block('color=red padding=1px display=flex')), 'color=red padding=1px display=flex'
    .split(' ')
    .map((pair) => pair.split('=')[0])
    .join(' '));
});

test('a shorthand is shown above its own sides, whichever way round the block has them', () => {
  // The same display for both, which is the point: the block order decides the result and changes
  // as the user works, so following it would move the field under the caret.
  assert.equal(shown(block('padding=12px padding-left=0')), 'padding[padding-left]');
  assert.equal(shown(block('padding-left=0 padding=12px')), 'padding[padding-left]');
});

test('a family appears where its first member does, so nothing jumps', () => {
  assert.equal(
    shown(block('color=red padding-left=0 display=flex padding=12px')),
    'color padding[padding-left] display',
  );
});

test('unrelated declarations keep their place around a family', () => {
  assert.equal(
    shown(block('padding=12px color=red padding-top=1px')),
    'padding[padding-top] color',
  );
});

test('two families stay separate, each above its own sides', () => {
  assert.equal(
    shown(block('margin=1px padding=2px margin-top=3px padding-left=4px')),
    'margin[margin-top] padding[padding-left]',
  );
});

/* -------------------------------------------------------------------------- */
/* The wire format                                                             */
/* -------------------------------------------------------------------------- */

test('a list converts to a map for the formats that are maps, losing only what a map loses', () => {
  assert.deepEqual(toRecord(block('padding=12px color=#222')), {
    padding: '12px',
    color: '#222',
  });
  // A repeated name keeps the declaration in effect, which is the only thing a map can hold.
  assert.deepEqual(toRecord(block('color=red color=#0a0')), { color: '#0a0' });
  assert.deepEqual(toRecord(block('padding=1px!')), { padding: '1px !important' });
});

test('a map converts back in its own insertion order, with important parsed out again', () => {
  assert.equal(flat(fromRecord({ padding: '12px', color: '#222' })), 'padding=12px color=#222');
  assert.equal(flat(fromRecord({ padding: '1px !important' })), 'padding=1px!');
});

/* -------------------------------------------------------------------------- */

if (failures.length) {
  console.error(`\n${failures.length} failing, ${passed} passing\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}\n`);
  process.exit(1);
}
console.log(`declaration-list: ${passed} passing`);
