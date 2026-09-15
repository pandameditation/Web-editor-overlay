/**
 * Where a provider credential lives, and what that costs.
 *
 * The honest framing first, because every design decision here follows from it: **a key held in
 * the page cannot be protected from the page.** The editor mounts into whatever document it is
 * given and shares a JavaScript realm with everything else in it. Any script in that realm can
 * patch `fetch`, patch `Headers.prototype.set`, patch `crypto.subtle.decrypt`, or simply read
 * the variable — so encrypting a key at rest changes nothing about whether a hostile script can
 * take it. It changes only whether something that can read storage but not run code can, and in
 * a browser that situation does not arise.
 *
 * Which is why the encrypted-in-localStorage design was rejected rather than built. It is not
 * neutral, it is worse: a lock icon invites people to paste production keys into a page they
 * would otherwise have been careful with.
 *
 * So there are three tiers, and only the first is secure:
 *
 * - **proxy** — the credential lives on the dev server. The page sends a prompt and never holds a
 *   secret, so there is nothing in the realm to steal. This is the recommended path and the only
 *   one that survives a hostile page.
 * - **local** — a model on the machine, reached without a credential. Nothing to leak.
 * - **in-page** — the page holds it. Kept for the tab by default, offered to the browser's own
 *   password manager, and persisted across sessions only on a loopback origin. Every one of those
 *   choices is about the *blast radius*, not about secrecy, and the UI says so in those terms.
 *
 * The optional passphrase wrap is real but narrow, and is described as what it is: it protects a
 * persisted key against a devtools dump, a synced profile, a browser extension with storage
 * access, or somebody else on the laptop. It does nothing against a script running in the page
 * while the key is in use.
 */

import type { AiProviderSet } from './types.js';

/** Where a key is kept between page loads. */
export type KeyPersistence =
  /** In memory and `sessionStorage`: survives a reload, dies with the tab. The default. */
  | 'session'
  /** In `localStorage`, on a loopback origin only. Survives everything until removed. */
  | 'origin'
  /** Nowhere. Typed each time, or filled by the browser's password manager. */
  | 'none';

/** What the vault knows about one set's credential, without revealing it. */
export interface KeyStatus {
  present: boolean;
  persistence: KeyPersistence;
  /** True when the stored blob is passphrase-wrapped and has not been unlocked yet. */
  locked: boolean;
  /** The last four characters, so a user can tell two keys apart without either being shown. */
  hint?: string;
}

const SESSION_PREFIX = 'heo.ai.session.';
const ORIGIN_PREFIX = 'heo.ai.origin.';

/**
 * True when this origin is the developer's own machine.
 *
 * The one place persistence beyond the tab is offered, because it is the one place the
 * adversarial-script premise does not hold: a page you are serving yourself from loopback is a
 * page whose scripts you wrote. Mirrors the loopback test the Vite plugin already applies to its
 * own write token, deliberately — two different notions of "local" in one codebase is one too
 * many.
 *
 * `file:` counts. There is no origin to speak of, and a page opened from disk is as local as it
 * gets; the alternative is that the offline case, which this editor is built for, cannot
 * remember anything.
 */
export function isLoopbackOrigin(): boolean {
  if (location.protocol === 'file:') return true;
  const host = location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

/**
 * Why persistence beyond this tab is unavailable here, or null when it is available.
 *
 * Returned as a sentence rather than a boolean so the settings control can be disabled *and*
 * say why in the same breath. A toggle that is simply greyed out teaches nobody anything.
 */
export function persistenceRefusal(): string | null {
  if (isLoopbackOrigin()) return null;
  return (
    `This page is served from ${location.host || 'another origin'}, where a saved key would be ` +
    'readable by every script on it, for ever. It can be kept for this tab instead.'
  );
}

/**
 * The credentials for this session.
 *
 * A module-level instance rather than something on the engine, because there is exactly one
 * browser tab and the answer to "what is the key for provider X" cannot depend on which editor
 * instance is asking. Nothing here is reachable from a `ChangeRecord`, a
 * `DesignSystemDocument`, a seed or an export — the only way out is `authorize`, which writes a
 * header and returns nothing.
 */
class KeyVault {
  /**
   * Held in a closure, in a module that exports no reader.
   *
   * Not a security boundary and not presented as one — a script in the realm can reach anything
   * — but it does mean the key is not sitting on an object the rest of the editor passes around,
   * which is what would eventually get it serialised into a log or a change record by accident.
   */
  #keys = new Map<string, string>();
  #persistence = new Map<string, KeyPersistence>();
  /** Sets whose stored blob is wrapped and not yet unlocked. */
  #locked = new Set<string>();
  #listeners = new Set<() => void>();

  /**
   * Pick up whatever this tab or this origin already holds.
   *
   * Called once on mount. A wrapped blob is noted as locked rather than unwrapped: the
   * passphrase is not known yet, and prompting for one before the user has asked to use a model
   * would be a password dialog on page load.
   */
  hydrate(): void {
    for (const [store, persistence] of [
      [safeStorage('session'), 'session' as const],
      [safeStorage('local'), 'origin' as const],
    ] as const) {
      if (!store) continue;
      const prefix = persistence === 'session' ? SESSION_PREFIX : ORIGIN_PREFIX;
      for (let index = 0; index < store.length; index += 1) {
        const name = store.key(index);
        if (!name?.startsWith(prefix)) continue;
        const id = name.slice(prefix.length);
        const raw = store.getItem(name) ?? '';
        this.#persistence.set(id, persistence);
        if (raw.startsWith(WRAPPED_PREFIX)) this.#locked.add(id);
        else this.#keys.set(id, raw);
      }
    }
    this.#emit();
  }

  status(id: string): KeyStatus {
    const key = this.#keys.get(id);
    return {
      present: Boolean(key) || this.#locked.has(id),
      persistence: this.#persistence.get(id) ?? 'none',
      locked: this.#locked.has(id),
      hint: key && key.length >= 4 ? key.slice(-4) : undefined,
    };
  }

  /** True when a request for this set can be made right now. */
  ready(set: AiProviderSet): boolean {
    if (set.transport !== 'in-page') return true;
    return Boolean(this.#keys.get(set.id));
  }

  /**
   * Store a key for this session, and optionally beyond it.
   *
   * Refuses `origin` persistence off loopback rather than silently downgrading, because a user
   * who ticked "remember this" and got session storage would believe something untrue about
   * where their key is. Returns what it actually did.
   */
  async set(
    id: string,
    key: string,
    persistence: KeyPersistence = 'session',
    passphrase?: string,
  ): Promise<{ persistence: KeyPersistence; refused?: string }> {
    const value = key.trim();
    if (!value) {
      this.clear(id);
      return { persistence: 'none' };
    }
    if (persistence === 'origin' && !isLoopbackOrigin()) {
      return { persistence: 'none', refused: persistenceRefusal() ?? 'Cannot be saved here.' };
    }

    this.#keys.set(id, value);
    this.#locked.delete(id);
    this.#persistence.set(id, persistence);

    if (persistence !== 'none') {
      const store = safeStorage(persistence === 'session' ? 'session' : 'local');
      const prefix = persistence === 'session' ? SESSION_PREFIX : ORIGIN_PREFIX;
      const blob = passphrase ? await wrap(value, passphrase) : value;
      try {
        store?.setItem(prefix + id, blob);
      } catch {
        // A full or blocked store is not a reason to fail the whole thing: the key is in memory
        // and the session works. It just will not survive a reload, which `status` reports.
        this.#persistence.set(id, 'none');
      }
    }
    this.#emit();
    return { persistence: this.#persistence.get(id) ?? 'none' };
  }

  /** Unlock a wrapped key with its passphrase. Returns false when the passphrase is wrong. */
  async unlock(id: string, passphrase: string): Promise<boolean> {
    const store = safeStorage('local') ?? safeStorage('session');
    const raw =
      store?.getItem(ORIGIN_PREFIX + id) ?? safeStorage('session')?.getItem(SESSION_PREFIX + id);
    if (!raw?.startsWith(WRAPPED_PREFIX)) return false;
    const value = await unwrap(raw, passphrase);
    if (!value) return false;
    this.#keys.set(id, value);
    this.#locked.delete(id);
    this.#emit();
    return true;
  }

  /** Forget a key everywhere, including storage. */
  clear(id: string): void {
    this.#keys.delete(id);
    this.#locked.delete(id);
    this.#persistence.delete(id);
    safeStorage('session')?.removeItem(SESSION_PREFIX + id);
    safeStorage('local')?.removeItem(ORIGIN_PREFIX + id);
    this.#emit();
  }

  /**
   * Put the credential on an outgoing request, and hand back nothing.
   *
   * The only way a key leaves this module, and it leaves as a header on a `Headers` object the
   * caller already made rather than as a string the caller could keep. That is a deliberate
   * shape: a `getKey(id)` accessor would be one refactor away from ending up in a log line.
   *
   * Returns false when there is nothing to authorise with, so a caller can say so instead of
   * sending an unauthenticated request and reporting whatever the provider says about it.
   */
  authorize(set: AiProviderSet, headers: Headers): boolean {
    if (set.transport !== 'in-page') return true;
    const key = this.#keys.get(set.id);
    if (!key) return false;
    switch (set.provider) {
      case 'anthropic':
        headers.set('x-api-key', key);
        headers.set('anthropic-version', '2023-06-01');
        return true;
      case 'google':
        headers.set('x-goog-api-key', key);
        return true;
      default:
        headers.set('authorization', `Bearer ${key}`);
        return true;
    }
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener();
      } catch (error) {
        console.error('[html-editor-overlay] key listener failed', error);
      }
    }
  }
}

export const keyVault = new KeyVault();

/* -------------------------------------------------------------------------- */
/* The passphrase wrap                                                         */
/* -------------------------------------------------------------------------- */

/** Marks a stored blob as wrapped, so `hydrate` can tell one from a bare key. */
const WRAPPED_PREFIX = 'heo1:';
/**
 * Deliberately high, and it costs a moment on unlock.
 *
 * A passphrase people will actually type is short, so the only thing standing between a stolen
 * blob and the key is how long each guess takes. 600k PBKDF2-SHA256 iterations is roughly the
 * current OWASP figure; the user pays it once per session and an attacker pays it per guess.
 */
const KDF_ITERATIONS = 600_000;

/*
 * `Uint8Array<ArrayBuffer>` rather than a bare `Uint8Array`, throughout.
 *
 * WebCrypto wants a `BufferSource`, and the current DOM types will not accept an array whose
 * buffer might be a `SharedArrayBuffer`. Saying which kind of buffer these sit on is the whole
 * fix; the alternative is a cast, which would silence the same question without answering it.
 */
type Bytes = Uint8Array<ArrayBuffer>;

function randomBytes(length: number): Bytes {
  const out = new Uint8Array(new ArrayBuffer(length)) as Bytes;
  crypto.getRandomValues(out);
  return out;
}

async function wrap(value: string, passphrase: string): Promise<string> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(passphrase, salt);
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(value),
  );
  return [
    WRAPPED_PREFIX + toBase64(salt),
    toBase64(iv),
    toBase64(new Uint8Array(sealed) as Bytes),
  ].join('.');
}

async function unwrap(blob: string, passphrase: string): Promise<string | null> {
  try {
    const [saltPart, ivPart, bodyPart] = blob.slice(WRAPPED_PREFIX.length).split('.');
    const key = await deriveKey(passphrase, fromBase64(saltPart));
    const opened = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(ivPart) },
      key,
      fromBase64(bodyPart),
    );
    return new TextDecoder().decode(opened);
  } catch {
    // A wrong passphrase and a corrupt blob are the same answer to the caller: no.
    return null;
  }
}

async function deriveKey(passphrase: string, salt: Bytes): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: KDF_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function toBase64(bytes: Bytes): string {
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return btoa(out);
}

function fromBase64(text: string): Bytes {
  const raw = atob(text);
  const out = new Uint8Array(new ArrayBuffer(raw.length)) as Bytes;
  for (let index = 0; index < raw.length; index += 1) out[index] = raw.charCodeAt(index);
  return out;
}

/**
 * Storage that cannot throw.
 *
 * `localStorage` throws outright in a sandboxed iframe and when a browser is set to block
 * storage, and this editor is dropped into pages it does not control. A feature degrading to
 * "type the key each time" is fine; the overlay failing to mount is not.
 *
 * Exported so the provider list uses the same guard as the credentials. Two notions of "storage
 * that might not be there" in one subsystem is how one of them ends up missing the try/catch.
 */
export function safeStorage(kind: 'session' | 'local'): Storage | null {
  try {
    return kind === 'session' ? sessionStorage : localStorage;
  } catch {
    return null;
  }
}
