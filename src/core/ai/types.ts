/**
 * The vocabulary the AI subsystem shares.
 *
 * One home for it because five modules have to agree: the context builder tells the model
 * what it may touch, the broker enforces it, the session asks the user about it, the key
 * vault decides where a credential may live, and the seed carries the settled result. A
 * second definition of "may this edit a class" is a second answer to that question, and the
 * one that matters is whichever the broker happens to read.
 */

/**
 * Whether a kind of change needs asking about.
 *
 * Deliberately two values and not three. "Never" looks like it belongs here and does not:
 * refusing outright is what leaving the scope off does, and a third state that means the
 * same as the second-with-a-refusal is a state nobody can describe. A set that should not
 * touch classes has `classes` absent from its policy.
 */
export type AiAllowance = 'always' | 'ask';

/**
 * What a change reaches beyond the element the user selected.
 *
 * The unit permission is granted in, and the unit the broker checks. `element` is not in
 * here because it is not a permission: editing the selected element is the whole point of
 * the feature, and a set that could not do it would do nothing.
 */
export type AiScopeClass = 'classes' | 'rules' | 'parent';

/** Every scope class, in the order the settings UI lists them. */
export const AI_SCOPE_CLASSES: readonly AiScopeClass[] = ['classes', 'rules', 'parent'];

/**
 * How much of the page one provider set is trusted with.
 *
 * An absent key means "not at all". That is the shape rather than an explicit `'never'`
 * because it makes the default safe by construction: a policy built from partial data, a
 * seed written by an older version, or an object arriving from `JSON.parse` all deny by
 * default instead of granting by accident.
 */
export type AiScopePolicy = Partial<Record<AiScopeClass, AiAllowance>>;

/** What the user is told a scope class covers, in the settings and in an approval. */
export const AI_SCOPE_LABELS: Record<AiScopeClass, string> = {
  classes: 'Reusable classes',
  rules: 'CSS rules',
  parent: 'The direct parent',
};

/** The one-line consequence of granting a scope class, for the settings rows. */
export const AI_SCOPE_CONSEQUENCE: Record<AiScopeClass, string> = {
  classes: 'Editing a class changes every element wearing it.',
  rules: 'Editing a rule changes every element it matches.',
  parent: 'Changing the container moves every child with it.',
};

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
  scope: AiScopePolicy;
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
  'scope',
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
    scope: portableScope(raw.scope),
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

/** Only the three known scope classes, only the two known allowances. Anything else denies. */
function portableScope(input: unknown): AiScopePolicy {
  const out: AiScopePolicy = {};
  if (!input || typeof input !== 'object') return out;
  const raw = input as Record<string, unknown>;
  for (const scope of AI_SCOPE_CLASSES) {
    const value = raw[scope];
    if (value === 'always' || value === 'ask') out[scope] = value;
  }
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
