/**
 * Turning a prompt into a stream of operations.
 *
 * The only part of the AI subsystem that touches the network, kept behind one interface for two
 * reasons. It is the seam a fixture replaces to script an exact sequence of operations with no
 * network and no timing, which is what made the boundary and the run testable at all. And it is
 * the seam an embedder replaces to route through their own gateway, which is the honest answer
 * for anyone who wants the feature without any of the three key tiers.
 *
 * Everything downstream of here consumes `AsyncIterable<unknown>` — deliberately `unknown`,
 * because a transport has no business deciding whether an operation is well formed. That is the
 * broker's job, and a transport that pre-validated would be a second opinion about the boundary.
 */

import { OperationStream, AI_SYSTEM_PROMPT } from './ops.js';
import { keyVault } from './keys.js';
import type { AiProviderSet } from './types.js';

/** What a transport is asked for. */
export interface AiRequest {
  set: AiProviderSet;
  /** The user's words. */
  prompt: string;
  /** The element context, already rendered. See `renderAiContext`. */
  context: string;
  /** Aborted when the user presses Stop. */
  signal: AbortSignal;
}

/**
 * A transport: a request in, operations out.
 *
 * Returns an async iterable rather than taking a callback so that `for await` in the run loop
 * reads as what it is, and so that abort propagates by the loop simply stopping.
 */
export type AiTransport = (request: AiRequest) => AsyncIterable<unknown>;

/** Where the proxy route lives, when the dev-server plugin is running. */
export interface ProxyEndpoint {
  url: string;
  /** The same session token the file endpoint uses. The page is not trusted without it. */
  token: string;
}

/**
 * The transport the editor uses when nothing else is supplied.
 *
 * One function covering all three tiers, because the tier changes only where the request goes and
 * what authorises it — the reply is read the same way in every case, and duplicating the stream
 * reader per provider is how the three of them would come to disagree about a truncated response.
 */
export function createTransport(proxy: ProxyEndpoint | null): AiTransport {
  return (request) => streamOperations(request, proxy);
}

async function* streamOperations(
  request: AiRequest,
  proxy: ProxyEndpoint | null,
): AsyncIterable<unknown> {
  const { set } = request;

  if (set.transport === 'proxy' && !proxy) {
    throw new Error(
      'This provider sends requests through the dev server, and the dev server is not connected. ' +
      'Start the project with the editor plugin, or choose a provider that runs locally.',
    );
  }
  if (set.transport === 'in-page' && !keyVault.ready(set)) {
    throw new Error('This provider needs an API key. Add one in the AI settings.');
  }

  const response = await fetch(endpointFor(set, proxy), {
    method: 'POST',
    headers: headersFor(set, proxy),
    body: JSON.stringify(bodyFor(set, request, proxy)),
    signal: request.signal,
    /*
     * No credentials, ever.
     *
     * A page's cookies have nothing to do with the user's model provider, and sending them to
     * whatever `baseURL` says would turn a mistyped host into a session leak.
     */
    credentials: 'omit',
  });

  if (!response.ok || !response.body) {
    throw new Error(await describeFailure(response));
  }

  /*
   * One scanner for the whole response, fed decoded chunks.
   *
   * `OperationStream` buffers across chunk boundaries, which matters more than it sounds: a
   * network read can split a JSON object anywhere, including inside a string, and a reader that
   * parsed per chunk would drop roughly every long operation.
   */
  const operations = new OperationStream();
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  try {
    for (; ;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const text of textOf(set, decoder.decode(value, { stream: true }))) {
        for (const op of operations.push(text)) yield op;
      }
    }
  } finally {
    // Releasing matters on abort: an unreleased reader holds the connection open, and a user who
    // pressed Stop expects the request to stop costing them money.
    reader.cancel().catch(() => { });
    reader.releaseLock();
  }

  if (operations.pending) {
    throw new Error('The model stopped mid-reply, so the last change was left out.');
  }
}

/* -------------------------------------------------------------------------- */
/* Per-provider shapes                                                         */
/* -------------------------------------------------------------------------- */

function endpointFor(set: AiProviderSet, proxy: ProxyEndpoint | null): string {
  if (set.transport === 'proxy') return proxy?.url ?? '';
  const base = (set.baseURL ?? '').replace(/\/+$/, '');
  switch (set.provider) {
    case 'anthropic':
      return `${base}/v1/messages`;
    case 'google':
      return `${base}/v1beta/models/${encodeURIComponent(set.model)}:streamGenerateContent?alt=sse`;
    default:
      // `/v1` is left to the base URL rather than appended, because every OpenAI-compatible
      // server disagrees about whether it is part of theirs and guessing breaks half of them.
      return `${base}/chat/completions`;
  }
}

function headersFor(set: AiProviderSet, proxy: ProxyEndpoint | null): Headers {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (set.transport === 'proxy') {
    if (proxy) headers.set('x-heo-token', proxy.token);
    return headers;
  }
  // `local` needs nothing and gets nothing. `in-page` gets its header written by the vault,
  // which never hands the value back. See `keys.ts`.
  keyVault.authorize(set, headers);
  return headers;
}

function bodyFor(
  set: AiProviderSet,
  request: AiRequest,
  proxy: ProxyEndpoint | null,
): unknown {
  const system = [AI_SYSTEM_PROMPT, set.systemPrompt?.trim()].filter(Boolean).join('\n\n');
  const user = `${request.prompt.trim()}\n\nThe element:\n${request.context}`;

  /*
   * The proxy is told what to do, not how.
   *
   * It gets the model, the prompts and nothing else — no base URL and no provider dialect —
   * because the server is the party that knows which credential it holds and therefore which
   * provider it can talk to. A page that could name the destination could name a destination of
   * its choosing and have the server authenticate to it.
   */
  if (set.transport === 'proxy') {
    return { model: set.model, system, prompt: user, token: proxy?.token };
  }

  switch (set.provider) {
    case 'anthropic':
      return {
        model: set.model,
        max_tokens: 4096,
        stream: true,
        system,
        messages: [{ role: 'user', content: user }],
      };
    case 'google':
      return {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
      };
    default:
      return {
        model: set.model,
        stream: true,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      };
  }
}

/**
 * The text carried by a chunk of the response, in whatever shape this provider streams.
 *
 * Returns an array because one network chunk can hold several server-sent events, and each of
 * those can hold a fragment of text. Unrecognised events are dropped rather than guessed at:
 * every provider sends bookkeeping frames — pings, usage totals, role announcements — and a
 * reader that fed those to the JSON scanner would be feeding it noise.
 */
function textOf(set: AiProviderSet, chunk: string): string[] {
  const out: string[] = [];
  for (const line of chunk.split('\n')) {
    const text = line.trim();
    if (!text.startsWith('data:')) continue;
    const payload = text.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue;
    }
    const piece = pieceOf(set, parsed);
    if (piece) out.push(piece);
  }
  return out;
}

function pieceOf(set: AiProviderSet, event: unknown): string {
  if (!event || typeof event !== 'object') return '';
  const data = event as Record<string, unknown>;
  switch (set.provider) {
    case 'anthropic': {
      // `content_block_delta` carries the text; `message_start` and friends carry nothing.
      const delta = data.delta as { text?: unknown } | undefined;
      return typeof delta?.text === 'string' ? delta.text : '';
    }
    case 'google': {
      const candidates = data.candidates as Array<{ content?: { parts?: Array<{ text?: unknown }> } }> | undefined;
      const parts = candidates?.[0]?.content?.parts ?? [];
      return parts.map((part) => (typeof part.text === 'string' ? part.text : '')).join('');
    }
    default: {
      const choices = data.choices as Array<{ delta?: { content?: unknown } }> | undefined;
      const content = choices?.[0]?.delta?.content;
      return typeof content === 'string' ? content : '';
    }
  }
}

/**
 * Why the request failed, in the provider's own words where it gave any.
 *
 * Worth the effort: "401" tells the user nothing, while "Incorrect API key provided" tells them
 * exactly what to fix. Every one of these providers puts a usable sentence in the body, and
 * throwing away the body to report the status code is the difference between a five-second fix
 * and a support thread.
 */
async function describeFailure(response: Response): Promise<string> {
  const fallback = `The provider refused the request (${response.status} ${response.statusText}).`;
  try {
    const text = await response.text();
    if (!text) return fallback;
    const parsed = JSON.parse(text) as {
      error?: { message?: unknown } | string;
      message?: unknown;
    };
    const message =
      typeof parsed.error === 'string'
        ? parsed.error
        : typeof parsed.error?.message === 'string'
          ? parsed.error.message
          : typeof parsed.message === 'string'
            ? parsed.message
            : '';
    return message ? `${message} (${response.status})` : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Check a set can be reached, for the Test button in the settings.
 *
 * Deliberately asks for the smallest thing that exercises the whole path — the credential, the
 * base URL, the model name — rather than probing the host. A reachable host with a wrong model
 * name is the most common misconfiguration, and a ping would call it healthy.
 */
export async function testTransport(
  transport: AiTransport,
  set: AiProviderSet,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const stream = transport({
      set,
      prompt: 'Reply with exactly {"op":"summary","text":"ready"} and nothing else.',
      context: '{}',
      signal: controller.signal,
    });
    for await (const op of stream) {
      // One well-formed operation is the whole test: it proves the credential, the endpoint, the
      // model and the reply shape all work together.
      if (op && typeof op === 'object' && 'op' in op) return { ok: true };
    }
    return {
      ok: false,
      reason: 'The provider answered, but not with anything this editor could read.',
    };
  } catch (error) {
    if (controller.signal.aborted) {
      return { ok: false, reason: 'The provider did not answer within 20 seconds.' };
    }
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}
