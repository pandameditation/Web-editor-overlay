import { DEFAULT_AI_SCOPE, type AiProviderKind, type AiProviderSet } from '../core/ai/types.js';

/**
 * Finding the AI providers a machine already has.
 *
 * The point of this module is that there is nothing to configure. A key in `.env` — or one
 * already exported in the shell for some other tool — is enough for the editor to offer that
 * provider, because the name of the variable already says which provider it is. `OPENAI_API_KEY`
 * is not a convention this invented; it is the one every SDK and CLI in the ecosystem uses, so
 * reading it is how the plugin can ask for no configuration at all.
 *
 * Two forms are recognised, and the difference is whether the destination is already known.
 *
 * **A well-known provider** needs only its key, because its host and its wire dialect are facts
 * about the provider rather than choices the user should have to restate. See `KNOWN`.
 *
 * **Any number of custom endpoints**, grouped by a name of your choosing:
 *
 * ```ini
 * HEO_AI_WORK_API_KEY=…
 * HEO_AI_WORK_BASE_URL=https://gateway.internal/v1
 * HEO_AI_WORK_MODEL=llama-3.3-70b          # optional
 * HEO_AI_WORK_MODELS=llama-3.3-70b,qwen-2  # optional allow-list
 * HEO_AI_WORK_LABEL=Work gateway           # optional
 * HEO_AI_WORK_PROVIDER=openai-compatible   # optional dialect, this is the default
 * ```
 *
 * The name is arbitrary and unlimited, which is the whole reason this form exists: one key per
 * provider is not the shape of anybody's life once gateways, a personal key and a work key are
 * all in play.
 *
 * The same `HEO_AI_<NAME>_*` suffixes also override a well-known provider, using its id as the
 * name — `HEO_AI_ANTHROPIC_MODEL=claude-opus-4-5` — so there is one convention rather than two.
 */

/** A provider found in the environment, credential included. Never serialised towards the page. */
export interface DiscoveredProvider {
  /**
   * Stable across restarts, because the page stores a scope policy against it and a seed refers
   * to a set by it. Derived from the variable group's name, so it is stable by construction
   * rather than by remembering to keep it stable.
   */
  id: string;
  label: string;
  provider: AiProviderKind;
  apiKey: string;
  baseURL?: string;
  /** Models the page may ask for. Absent means any. */
  models?: string[];
  /** What the page starts with in its model field. */
  model: string;
  /** Which variable it was found under, for the startup log. */
  foundAt: string;
}

/**
 * Providers whose host and dialect are known, so a key alone is enough.
 *
 * `model` is a starting point rather than a promise: model names change faster than this file
 * will, the user can overwrite the field, and `HEO_AI_<ID>_MODEL` sets it without editing code.
 * An empty string is the honest answer where there is no single obvious default — the settings
 * panel then shows an empty model field, which is a question rather than a wrong answer.
 */
const KNOWN: ReadonlyArray<{
  id: string;
  label: string;
  names: readonly string[];
  provider: AiProviderKind;
  baseURL?: string;
  model: string;
}> = [
    {
      id: 'anthropic',
      label: 'Anthropic',
      names: ['ANTHROPIC_API_KEY'],
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
    },
    {
      id: 'openai',
      label: 'OpenAI',
      names: ['OPENAI_API_KEY'],
      provider: 'openai',
      model: 'gpt-4o-mini',
    },
    {
      id: 'google',
      label: 'Google Gemini',
      names: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
      provider: 'google',
      model: 'gemini-2.5-flash',
    },
    {
      id: 'groq',
      label: 'Groq',
      names: ['GROQ_API_KEY'],
      provider: 'openai-compatible',
      baseURL: 'https://api.groq.com/openai/v1',
      model: '',
    },
    {
      id: 'mistral',
      label: 'Mistral',
      names: ['MISTRAL_API_KEY'],
      provider: 'openai-compatible',
      baseURL: 'https://api.mistral.ai/v1',
      model: 'mistral-large-latest',
    },
    {
      id: 'deepseek',
      label: 'DeepSeek',
      names: ['DEEPSEEK_API_KEY'],
      provider: 'openai-compatible',
      baseURL: 'https://api.deepseek.com',
      model: 'deepseek-chat',
    },
    {
      id: 'xai',
      label: 'xAI Grok',
      names: ['XAI_API_KEY', 'GROK_API_KEY'],
      provider: 'openai-compatible',
      baseURL: 'https://api.x.ai/v1',
      model: '',
    },
    {
      id: 'openrouter',
      label: 'OpenRouter',
      names: ['OPENROUTER_API_KEY'],
      provider: 'openai-compatible',
      baseURL: 'https://openrouter.ai/api/v1',
      model: '',
    },
    {
      id: 'together',
      label: 'Together',
      names: ['TOGETHER_API_KEY'],
      provider: 'openai-compatible',
      baseURL: 'https://api.together.xyz/v1',
      model: '',
    },
    {
      id: 'cerebras',
      label: 'Cerebras',
      names: ['CEREBRAS_API_KEY'],
      provider: 'openai-compatible',
      baseURL: 'https://api.cerebras.ai/v1',
      model: '',
    },
    {
      id: 'fireworks',
      label: 'Fireworks',
      names: ['FIREWORKS_API_KEY'],
      provider: 'openai-compatible',
      baseURL: 'https://api.fireworks.ai/inference/v1',
      model: '',
    },
    {
      id: 'perplexity',
      label: 'Perplexity',
      names: ['PERPLEXITY_API_KEY'],
      provider: 'openai-compatible',
      baseURL: 'https://api.perplexity.ai',
      model: 'sonar',
    },
  ];

const GROUP_PREFIX = 'HEO_AI_';

/**
 * Field suffixes for a `HEO_AI_<NAME>_<FIELD>` variable, longest first.
 *
 * The order is load-bearing. A name may itself contain underscores, so the field is found by
 * stripping a known suffix — and `MODELS` has to be tried before `MODEL` or every allow-list
 * would be read as a group called `…_S`.
 */
const GROUP_FIELDS = ['API_KEY', 'BASE_URL', 'PROVIDER', 'MODELS', 'MODEL', 'LABEL'] as const;

type GroupField = (typeof GROUP_FIELDS)[number];

/** The environment, as either Vite's `loadEnv` result or `process.env`. */
export type EnvLike = Record<string, string | undefined>;

/**
 * Every provider this environment describes, most deliberate first.
 *
 * Order is priority: the page treats the first set as its default. A `HEO_AI_<NAME>` group was
 * written for this editor and a bare `OPENAI_API_KEY` may well have been exported months ago for
 * something else, so the named groups come first.
 */
export function discoverAiProviders(env: EnvLike): DiscoveredProvider[] {
  const read = (name: string): string => (env[name] ?? '').trim();
  const out: DiscoveredProvider[] = [];

  for (const [name, fields] of groupsIn(env)) {
    const apiKey = fields.API_KEY;
    if (!apiKey) continue;
    // A known id used as a group name is an override of that provider, not a second one.
    if (KNOWN.some((entry) => entry.id === name.toLowerCase())) continue;
    const baseURL = fields.BASE_URL;
    if (!baseURL) {
      // Refused rather than guessed. There is no default host for an endpoint nobody named, and
      // sending a private gateway's key to api.openai.com would be the worst possible guess.
      out.push(incomplete(name, apiKey));
      continue;
    }
    const models = splitModels(fields.MODELS);
    out.push({
      id: `heo-env-${slug(name)}`,
      label: fields.LABEL || titleCase(name),
      // A custom endpoint speaks the common dialect unless it says otherwise, because that is
      // what "OpenAI-compatible" means and it is why almost every gateway advertises it.
      provider: dialect(fields.PROVIDER) ?? 'openai-compatible',
      apiKey,
      baseURL,
      ...(models.length ? { models } : {}),
      model: fields.MODEL || models[0] || '',
      foundAt: `${GROUP_PREFIX}${name}_API_KEY`,
    });
  }

  for (const entry of KNOWN) {
    const foundAt = entry.names.find((name) => read(name));
    if (!foundAt) continue;
    const overrides = groupsIn(env).get(entry.id.toUpperCase()) ?? {};
    const models = splitModels(overrides.MODELS);
    const baseURL = overrides.BASE_URL || entry.baseURL;
    out.push({
      id: `heo-env-${entry.id}`,
      label: overrides.LABEL || entry.label,
      provider: dialect(overrides.PROVIDER) ?? entry.provider,
      apiKey: read(foundAt),
      ...(baseURL ? { baseURL } : {}),
      ...(models.length ? { models } : {}),
      model: overrides.MODEL || models[0] || entry.model,
      foundAt,
    });
  }

  return out.filter((one) => one.apiKey);
}

/**
 * The same providers with the credentials taken out, ready for `MountOptions.aiProviders`.
 *
 * The one function that decides what the browser is told, which is why it builds a fresh object
 * field by field instead of deleting `apiKey` from a copy. A copy-then-delete is correct until
 * somebody adds a second secret-shaped field, and then it is silently wrong.
 */
export function publicProviderSets(found: readonly DiscoveredProvider[]): AiProviderSet[] {
  return found.map((one) => ({
    id: one.id,
    label: one.label,
    /*
     * Always `proxy`, and that is the point of discovering these at all: the key is here, on the
     * server, and the set the page holds is a handle to it rather than a copy of it.
     */
    transport: 'proxy' as const,
    /*
     * The dialect travels even though the server chooses the destination, because the client
     * still has to read the reply — an Anthropic event stream and an OpenAI one carry their text
     * in different fields, and a set that lied about this would stream nothing while looking
     * connected.
     */
    provider: one.provider,
    // `baseURL` deliberately omitted. The page is not told where its requests go.
    model: one.model,
    scope: { ...DEFAULT_AI_SCOPE },
  }));
}

/** A provider named in the environment but missing the one thing that cannot be guessed. */
function incomplete(name: string, apiKey: string): DiscoveredProvider {
  return {
    id: `heo-env-${slug(name)}`,
    label: titleCase(name),
    provider: 'openai-compatible',
    apiKey,
    model: '',
    foundAt: `${GROUP_PREFIX}${name}_API_KEY`,
    // No baseURL, which `describeDiscovery` reports and the route refuses to act on.
  };
}

/** True for a group that was named but cannot be used, so the log can say which and why. */
export function isIncomplete(one: DiscoveredProvider): boolean {
  return !one.baseURL && one.provider === 'openai-compatible' &&
    !KNOWN.some((entry) => `heo-env-${entry.id}` === one.id);
}

/**
 * `HEO_AI_<NAME>_<FIELD>` variables, collected by name.
 *
 * Built by walking the environment rather than by looking for names we already know, because the
 * whole point of the group form is that the names are the user's to choose.
 */
function groupsIn(env: EnvLike): Map<string, Partial<Record<GroupField, string>>> {
  const groups = new Map<string, Partial<Record<GroupField, string>>>();
  for (const [key, raw] of Object.entries(env)) {
    const value = (raw ?? '').trim();
    if (!value || !key.startsWith(GROUP_PREFIX)) continue;
    const rest = key.slice(GROUP_PREFIX.length);
    const field = GROUP_FIELDS.find(
      (candidate) => rest === candidate || rest.endsWith(`_${candidate}`),
    );
    if (!field) continue;
    // `HEO_AI_API_KEY` with no name at all is the single-custom-endpoint case.
    const name = rest === field ? 'CUSTOM' : rest.slice(0, -(field.length + 1));
    if (!name) continue;
    const group = groups.get(name) ?? {};
    group[field] = value;
    groups.set(name, group);
  }
  return groups;
}

/**
 * A dialect name, or nothing.
 *
 * Returns `undefined` rather than falling back, so a caller with a better default than
 * `openai-compatible` can use it. Collapsing that here is how a discovered `ANTHROPIC_API_KEY`
 * came out claiming to speak OpenAI — which sends the wrong request shape to the right host and
 * then reads the reply with a parser that finds nothing in it.
 */
function dialect(value: string | undefined): AiProviderKind | undefined {
  return value === 'openai' || value === 'anthropic' || value === 'google' ||
    value === 'openai-compatible'
    ? value
    : undefined;
}

function splitModels(value: string | undefined): string[] {
  return (value ?? '').split(',').map((name) => name.trim()).filter(Boolean);
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function titleCase(name: string): string {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * What to print at startup, as sentences rather than a dump.
 *
 * Announced rather than left to be discovered, for the same reason file writing is: reading the
 * ambient environment means the plugin may have picked up a key the user exported months ago for
 * something else, and a line naming the variable is what turns that from a surprise into a fact.
 */
export function describeDiscovery(found: readonly DiscoveredProvider[]): string[] {
  const usable = found.filter((one) => !isIncomplete(one));
  const broken = found.filter(isIncomplete);
  const lines: string[] = [];
  if (usable.length) {
    const names = usable.map((one) => `${one.label} (${one.foundAt})`).join(', ');
    lines.push(
      `AI is on, and the key stays here. ${usable.length === 1 ? 'Provider' : `${usable.length} providers`}: ${names}`,
    );
  }
  for (const one of broken) {
    lines.push(
      `${one.foundAt} was found but ${GROUP_PREFIX}${slug(one.label).toUpperCase().replace(/-/g, '_')}_BASE_URL was not, ` +
      'so there is nowhere to send it. Add the base URL, or use a provider name this knows.',
    );
  }
  return lines;
}
