/**
 * The vocabulary the AI subsystem shares.
 *
 * One home for it because four modules have to agree: the context builder tells the model what
 * it may touch, the broker enforces it, the key vault decides where a credential may live, and
 * the seed carries the settled result. A second definition of "may this edit a class" is a
 * second answer to that question, and the one that matters is whichever the broker happens to
 * read.
 *
 * There used to be two answers. Permission was a property of the *provider*, configured in the
 * settings and able to say "ask me", while a separate per-request control decided what the model
 * was shown. Two axes over the same three nouns turned out to be one too many: they could
 * disagree, the settings copy had to explain a distinction nobody had asked for, and a request
 * narrowed on one axis was still permitted on the other. There is now one control, in the
 * popover, and it is binary — see `AiContextScope`.
 */

/**
 * What a change reaches beyond the element the user selected.
 *
 * The unit permission is granted in, and the unit the broker checks. `element` is not in
 * here because it is not a permission: editing the selected element is the whole point of
 * the feature, and a set that could not do it would do nothing.
 */
export type AiScopeClass = 'classes' | 'rules' | 'parent';

/** Every scope class, in the order the popover lists them. */
export const AI_SCOPE_CLASSES: readonly AiScopeClass[] = ['classes', 'rules', 'parent'];

/** What the user is told a scope class covers, in a chip and in a refusal. */
export const AI_SCOPE_LABELS: Record<AiScopeClass, string> = {
  classes: 'Reusable classes',
  rules: 'CSS rules',
  parent: 'The direct parent',
};

/**
 * The requests worth one press.
 *
 * Copy edits, and that is not an arbitrary choice of category. They are the three requests whose
 * wording is always the same, whose result needs no context beyond the element's own text, and
 * which people ask for constantly — so they are the ones where typing the sentence is pure
 * overhead. A style change is the opposite: "make it tighter" means something different on every
 * element, so there is nothing to prefill.
 *
 * The prompts are written out in full rather than abbreviated to the label, because the label is
 * for the user and the prompt is for the model. "Make shorter" alone invites cutting information;
 * saying which part must survive is what makes the result usable.
 */
export const AI_QUICK_ACTIONS: readonly { label: string; prompt: string }[] = [
  {
    label: 'Make shorter',
    prompt:
      'Make this shorter. Keep the meaning and the voice exactly as they are — cut words, ' +
      'not information. Change only the text.',
  },
  {
    label: 'Improve writing',
    prompt:
      'Improve the writing. Keep the meaning and roughly the same length; make it clearer and ' +
      'less clumsy. Do not make it more enthusiastic. Change only the text.',
  },
  {
    label: 'Fix typos',
    prompt:
      'Fix any spelling, punctuation and grammar mistakes. Change nothing else — not the ' +
      'wording, not the tone, not the styling.',
  },
];

/**
 * How much of the page around the element one request may see and change.
 *
 * The whole permission model, in three booleans. On means the thing is described to the model and
 * the model may edit it; off means neither. One decision rather than two because they are not
 * separable in practice: a model editing something it was never shown is guessing, and a model
 * shown something it may not touch will propose changes that are then refused. Both halves of that
 * were shipped and both were wrong, so they are now one switch.
 *
 * Binary, with no "ask me". A standing per-provider permission needed a third state, because the
 * decision outlived the request that prompted it and had to be softened. This does not: it is
 * chosen for the request in front of you, in the popover, next to the box you are typing in — so
 * the cost of changing your mind is one click, and a dialog interrupting to ask about something
 * you set five seconds ago is worse than no dialog.
 *
 * Minimal by default. Sending a class list, twenty-four matched rules and a parent description in
 * order to fix a typo pays for tokens nobody needed and hands a third party more of the page than
 * the task required — and grants edit rights over all of it.
 *
 * The selected element is not a member. It is always included and always editable, because a
 * request about nothing is not a request. Everything inside it counts as part of it.
 */
export interface AiContextScope {
  /** The element's own classes and their declarations. */
  classes: boolean;
  /** Stylesheet rules matching the element, and the ones needing a state. */
  rules: boolean;
  /** The containing element, its layout, and the constraints binding this one. */
  parent: boolean;
}

/** What a request describes when nobody has asked for more: the element, and nothing around it. */
export const DEFAULT_AI_CONTEXT_SCOPE: AiContextScope = {
  classes: false,
  rules: false,
  parent: false,
};

/** The four things a request can carry, for the chips that switch them on. */
export const AI_CONTEXT_LABELS: { key: keyof AiContextScope | 'element'; label: string; hint: string }[] = [
  {
    key: 'element',
    label: 'This element',
    hint: 'Its text, markup, attributes and the styles it sets. Always sent.',
  },
  {
    key: 'classes',
    label: 'Classes',
    hint: 'The classes it wears and what each one declares. Send these when the change is about shared styling.',
  },
  {
    key: 'rules',
    label: 'CSS rules',
    hint: 'Stylesheet rules that match it. Send these when you need the model to know where a value comes from.',
  },
  {
    key: 'parent',
    label: 'Parent',
    hint: 'The container, its layout, and what is limiting this element. Send it for alignment and spacing.',
  },
];

/**
 * Where a provider's credential lives, which is the only thing here that is a security
 * property rather than a preference.
 *
 * - `proxy` — a dev-server route holds the key. The page sends a prompt and never sees a
 *   credential, so no script in the page can take one. The only tier that survives a
 *   hostile page.
 * - `local` — a model on the machine, reached without a credential. Nothing to leak.
 * - `in-page` — the page holds the key while it is used. Honest, sometimes the only thing
 *   available, and never described as secure.
 */
export type AiTransportKind = 'proxy' | 'local' | 'in-page';

/** Wire dialects, which decide the request shape rather than the destination. */
export type AiProviderKind = 'openai' | 'anthropic' | 'google' | 'openai-compatible';

/**
 * Where each dialect lives, so choosing a provider fills in its host.
 *
 * Every value here has to agree with what `endpointFor` appends to it, which is why they do not
 * all end the same way. OpenAI carries `/v1` because the path added to it is `/chat/completions`;
 * Anthropic does not, because `/v1/messages` is added; Google does not, because a versioned model
 * path is. Getting one of these wrong produces a 404 from a host that is otherwise correct, which
 * is among the least helpful failures available — hence one table, next to the type that decides
 * the paths.
 *
 * `openai-compatible` is deliberately empty. It means "some server speaking OpenAI's dialect",
 * and there is no such thing as its default host; guessing `api.openai.com` would point a
 * gateway's key at OpenAI.
 */
export const DEFAULT_BASE_URL: Record<AiProviderKind, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  google: 'https://generativelanguage.googleapis.com',
  'openai-compatible': '',
};

/** Every host this would fill in on its own, for telling a filled-in value from a typed one. */
const KNOWN_BASE_URLS: readonly string[] = [
  ...Object.values(DEFAULT_BASE_URL).filter(Boolean),
  // The one this suggests for a local model, so switching dialect after taking the suggestion
  // still counts as "never typed anything".
  'http://127.0.0.1:11434/v1',
];

/**
 * The base URL a set should carry, given the dialect it now speaks.
 *
 * Returns the current value untouched when the user typed something of their own, which is the
 * whole difficulty: a field that always overwrites loses a private gateway the moment somebody
 * looks at the dialect dropdown, and a field that never overwrites leaves OpenAI pointed at
 * Anthropic's host. So it replaces only what it could have written itself.
 */
export function baseURLFor(provider: AiProviderKind, current: string | undefined): string {
  const held = (current ?? '').trim();
  if (held && !KNOWN_BASE_URLS.includes(held.replace(/\/+$/, ''))) return held;
  return DEFAULT_BASE_URL[provider];
}

/**
 * One configured way to reach a model.
 *
 * Note what is absent: there is no key on this type, and there never will be. A set is
 * written into the design-system seed, and the seed is the one artefact here built to
 * travel — it is copied into chat, exported as JSON, embedded in page markup by the block
 * seed, and committed to files. A secret in it turns one leak into a permanent one, so the
 * credential lives in `keys.ts` under this set's `id` and is not serialised with it.
 */
export interface AiProviderSet {
  /** Stable across edits, because the key vault and the seed both refer to a set by it. */
  id: string;
  /** The user's own name for it, shown in the switcher. */
  label: string;
  transport: AiTransportKind;
  provider: AiProviderKind;
  /** Absent for `proxy`, where the server decides and the page is not told. */
  baseURL?: string;
  model: string;
  /** Prepended to the editor's own instructions rather than replacing them. */
  systemPrompt?: string;
  /*
   * No `scope` here, deliberately.
   *
   * A provider used to carry its own permission, and it travelled in the seed — so what the AI was
   * allowed to change on your page arrived from whoever sent you a design system. Scope is now a
   * property of the request rather than of the provider, chosen in the popover and never
   * serialised. See `AiContextScope`.
   */
}

/** True when this set can be used without asking the user for anything first. */
export function needsKey(set: AiProviderSet): boolean {
  return set.transport === 'in-page';
}

/**
 * Fields a set is allowed to carry, enumerated rather than assumed.
 *
 * An allow-list and not a deny-list, and that is the whole point of it. A set travels in the
 * design-system seed, and the seed is the one artefact here built to be shared — pasted into
 * chat, exported as JSON, embedded in page markup, committed to a repository. A deny-list would
 * protect against the field names somebody thought of; this protects against the ones nobody
 * has added yet, because anything not on the list simply does not travel.
 */
const PORTABLE_FIELDS = [
  'id',
  'label',
  'transport',
  'provider',
  'baseURL',
  'model',
  'systemPrompt',
] as const satisfies readonly (keyof AiProviderSet)[];

/**
 * A set with nothing on it but the fields above.
 *
 * The single gate between a configured provider and anything that leaves this machine. Called on
 * the way out of the editor and again on the way in, because an untrusted document is exactly as
 * likely to be carrying a stray `apiKey` as a careless refactor is.
 *
 * Returns null for a set too broken to be worth keeping, so a corrupt entry in an imported seed
 * is dropped rather than half-restored into something the settings panel cannot draw.
 */
export function portableProviderSet(input: unknown): AiProviderSet | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const id = String(raw.id ?? '').trim();
  const model = String(raw.model ?? '').trim();
  if (!id || !model) return null;

  const transport = raw.transport;
  const provider = raw.provider;
  const out: AiProviderSet = {
    id,
    label: String(raw.label ?? '').trim() || 'Untitled provider',
    transport:
      transport === 'proxy' || transport === 'local' || transport === 'in-page'
        ? transport
        : 'in-page',
    provider:
      provider === 'openai' || provider === 'anthropic' || provider === 'google' ||
        provider === 'openai-compatible'
        ? provider
        : 'openai-compatible',
    model,
  };
  if (typeof raw.baseURL === 'string' && raw.baseURL.trim()) out.baseURL = raw.baseURL.trim();
  if (typeof raw.systemPrompt === 'string' && raw.systemPrompt.trim()) {
    out.systemPrompt = raw.systemPrompt;
  }
  // Named so the list above is not merely decorative: if a field is added to the type and not to
  // `PORTABLE_FIELDS`, this is the line that stops it travelling by accident.
  void PORTABLE_FIELDS;
  return out;
}

/**
 * What the set's badge says, and the sentence under it.
 *
 * Phrased as what is true rather than what is reassuring, and that is the point of putting
 * it here instead of in the template: the wording is a claim about the security of the
 * user's credential, so it is written once, next to the type that decides it, where it can
 * be read alongside `AiTransportKind` and checked against reality.
 */
export function describeTransport(
  set: AiProviderSet,
  persistence: 'session' | 'origin' | 'none' = 'none',
): { badge: string; detail: string } {
  switch (set.transport) {
    case 'proxy':
      return {
        badge: 'Proxied',
        detail: 'Your key stays on the dev server. This page never sees it.',
      };
    case 'local':
      return {
        badge: 'Keyless',
        detail: 'A local model, so there is no key to protect.',
      };
    default:
      return persistence === 'origin'
        ? {
          badge: 'In this page · remembered',
          detail: `This page can read your key, and it is saved on ${location.host} until you remove it.`,
        }
        : {
          badge: 'In this page',
          detail: 'This page can read your key while you use it. Kept for this tab only.',
        };
  }
}
