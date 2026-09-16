/**
 * What a model is allowed to ask for, and how its reply is read.
 *
 * A closed vocabulary of six changes plus a summary. Closed on purpose: the alternative — let
 * the model emit CSS or HTML and work out afterwards what it did — makes the scope question
 * unanswerable, because "does this reach the parent" is not a property of a blob of text.
 *
 * The other decision worth stating is that **targets are named, not selected**. An operation
 * says `self` or `parent`; it never carries a selector for an element. A model cannot
 * therefore aim at the overlay, at `body`, or at the element next door, and the broker does
 * not have to detect that it tried. The one operation that does take a selector is
 * `upsertRule`, because a rule *is* a selector, and that is the one the broker checks hardest.
 */

/** The changes a model may ask for. */
export type AiOperation =
  /** Replace what is inside the selected element. Markup, sanitised before it lands. */
  | { op: 'setText'; html: string }
  /** Write inline declarations onto the selected element. */
  | { op: 'setStyles'; declarations: Record<string, string> }
  /** Add or remove class names on the selected element. Does not define them. */
  | { op: 'setClasses'; add?: string[]; remove?: string[] }
  /** Define or extend a reusable class. Reaches every element wearing it. */
  | { op: 'upsertClass'; name: string; declarations: Record<string, string> }
  /** Define or extend a CSS rule. Reaches every element it matches. */
  | { op: 'upsertRule'; selector: string; declarations: Record<string, string> }
  /** Write inline declarations onto the direct parent. Moves every sibling. */
  | { op: 'setParentStyles'; declarations: Record<string, string> }
  /** What was done and why, in the model's own words. Terminal, and not a change. */
  | { op: 'summary'; text: string };

export type AiOperationName = AiOperation['op'];

/**
 * Which scope each operation needs.
 *
 * `element` is not a scope — editing the selected element, and everything inside it, is the
 * feature — so it stands for "no check", and `summary` changes nothing at all. Everything else
 * names one of the three switches beside the prompt.
 */
export const OPERATION_SCOPE: Record<AiOperationName, 'element' | 'classes' | 'rules' | 'parent' | 'none'> = {
  setText: 'element',
  setStyles: 'element',
  setClasses: 'element',
  upsertClass: 'classes',
  upsertRule: 'rules',
  setParentStyles: 'parent',
  summary: 'none',
};

/** The operation names, for the prompt and for validation. */
export const OPERATION_NAMES = Object.keys(OPERATION_SCOPE) as AiOperationName[];

/**
 * The instructions the editor always sends, whatever the user's own system prompt says.
 *
 * Appended to rather than replaced by a set's `systemPrompt`, because these are not
 * preferences — they describe the only reply shape the editor can read. A user prompt that
 * could override them would be a user prompt that could break the feature.
 *
 * It states the scope rules even though `broker.ts` enforces them, for a practical reason rather
 * than a security one: a model that keeps proposing refused operations produces a run that looks
 * broken, and the user blames the editor rather than the switch they turned off.
 */
export const AI_SYSTEM_PROMPT = `You are editing one element inside a visual web editor.

Reply with one JSON object per line, nothing else. No prose outside the objects, no markdown
fences, no explanation before or after. Each object is one operation:

{"op":"setText","html":"…"}                       replace what is inside the element
{"op":"setStyles","declarations":{"…":"…"}}       inline styles on the element
{"op":"setClasses","add":["…"],"remove":["…"]}    class names on the element
{"op":"upsertClass","name":"…","declarations":{}} define a reusable class
{"op":"upsertRule","selector":"…","declarations":{}} define a CSS rule
{"op":"setParentStyles","declarations":{"…":"…"}} inline styles on the direct parent
{"op":"summary","text":"…"}                       what you did, one or two sentences

Everything inside the selected element is part of it, and setText is always allowed.

So to change something nested — a <b>, a <span>, one link among several — rewrite the element's
markup with setText and put the styling on that node directly, as a style attribute or a class
attribute. This is always in scope and you must not decline for want of permission: the nested
node is inside the element you were given, so editing it is editing the element.

  asked: make the bold text red
  do:    {"op":"setText","html":"Some <b style=\\"color:#c00\\">bold</b> text"}
  not:   a CSS rule for "#thing b", which needs a scope that may be switched off

Rules that are enforced, not advisory:

- You may only change the element described in the context and what is inside it, the classes
  and CSS rules that apply to it, and its direct parent. Anything else is refused.
- A selector in upsertRule must match the element itself, its parent, or only elements inside
  it. A selector like *, body, html or one naming another part of the page is refused.
- Never emit script, event-handler attributes, or javascript: URLs. They are stripped.
- The context lists what is in scope, and anything absent from it is refused. Absent does not
  mean you are stuck: reach the same result with what is in scope. Styling a descendant through
  setText always works; so does putting an existing class on the element. Only say a change is
  impossible once no route in scope reaches it, and then name the one switch that would.

Prefer the narrowest change that does the job, in this order: markup and inline styles inside
the element, then a class, then a CSS rule, and never the parent unless the request is about
layout only the container can decide. End with exactly one summary.`;

/**
 * Pull whole JSON objects out of a stream that may not be well behaved.
 *
 * Models are asked for one object per line and mostly comply, but "mostly" is not something
 * to build on: they open with a markdown fence, add a sentence of preamble, or pretty-print
 * an object across six lines. So this buffers, and tries the buffer as JSON at every closing
 * brace rather than at every newline — which is what makes a pretty-printed object work.
 *
 * Deliberately forgiving about junk and unforgiving about ambiguity: anything that is not a
 * parseable object with a string `op` is dropped, silently, because a half-understood
 * instruction is worse than a missing one when the thing being instructed edits a page.
 */
export class OperationStream {
  #buffer = '';
  /** Where the current candidate object starts in the buffer, or -1 between objects. */
  #start = -1;
  #depth = 0;
  #inString = false;
  #escaped = false;

  /** Feed a chunk; get back whatever became complete. */
  push(chunk: string): unknown[] {
    const out: unknown[] = [];
    for (const ch of chunk) {
      if (this.#start === -1) {
        // Outside an object: everything up to the next `{` is preamble, fences or prose.
        if (ch !== '{') continue;
        this.#start = this.#buffer.length;
        this.#depth = 0;
      }
      this.#buffer += ch;

      if (this.#inString) {
        if (this.#escaped) this.#escaped = false;
        else if (ch === '\\') this.#escaped = true;
        else if (ch === '"') this.#inString = false;
        continue;
      }
      if (ch === '"') {
        this.#inString = true;
        continue;
      }
      if (ch === '{') this.#depth += 1;
      else if (ch === '}') {
        this.#depth -= 1;
        if (this.#depth === 0) {
          const text = this.#buffer.slice(this.#start);
          this.#buffer = '';
          this.#start = -1;
          try {
            out.push(JSON.parse(text));
          } catch {
            /* Not an object after all. Dropped rather than guessed at. */
          }
        }
      }
    }
    return out;
  }

  /** True when a partial object is still buffered, so a caller can report a truncated reply. */
  get pending(): boolean {
    return this.#start !== -1;
  }
}

/** The reply shape, as a hint for a provider that supports structured output. */
export function operationSchemaHint(): string {
  return OPERATION_NAMES.join(' | ');
}
