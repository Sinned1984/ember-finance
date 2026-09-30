import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthConfig } from "./config.ts";

const STATE_VERSION = 1;
const SETUP_SECONDS = 10 * 60;
const STATE_FILE = "auth-state.json";
const AAD = Buffer.from("ember-finance:auth-state:v1", "utf8");
const base32 = /^[A-Z2-7]{32}$/;
const generationPattern = /^[A-Za-z0-9_-]{43}$/;

type PendingTotp = { secret: string; expires: number };
type AuthState = {
  version: 1;
  generation: string;
  totpSecret?: string;
  pendingTotp?: PendingTotp;
  lastTimeStep?: number;
  activatedAt?: number;
};
type Envelope = { version: 1; iv: string; tag: string; ciphertext: string };

let stateQueue: Promise<void> = Promise.resolve();
async function serialized<T>(work: () => Promise<T>): Promise<T> {
  const previous = stateQueue;
  let release!: () => void;
  stateQueue = new Promise(resolve => { release = resolve; });
  await previous;
  try { return await work(); }
  finally { release(); }
}

function directory(config: AuthConfig) {
  if (process.env.EMBER_AUTH_STATE_DIR) return join(process.env.EMBER_AUTH_STATE_DIR, config.secret.slice(0, 12));
  if (config.production) return "/var/lib/ember-auth";
  return join(tmpdir(), "ember-auth-state-" + config.secret.slice(0, 12));
}

function key(config: AuthConfig) {
  return Buffer.from(hkdfSync(
    "sha256",
    Buffer.from(config.secret, "base64url"),
    Buffer.from("ember-finance-auth-state-salt-v1", "utf8"),
    Buffer.from("state-encryption", "utf8"),
    32,
  ));
}

function validInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validateState(value: unknown): AuthState {
  if (!value || typeof value !== "object") throw new Error("Invalid authentication state.");
  const state = value as Partial<AuthState>;
  if (state.version !== STATE_VERSION || !generationPattern.test(state.generation ?? "")) throw new Error("Invalid authentication state.");
  if (state.totpSecret !== undefined && !base32.test(state.totpSecret)) throw new Error("Invalid authentication state.");
  if (state.pendingTotp !== undefined && (!base32.test(state.pendingTotp.secret) || !validInteger(state.pendingTotp.expires))) throw new Error("Invalid authentication state.");
  if (state.lastTimeStep !== undefined && (!state.totpSecret || !validInteger(state.lastTimeStep))) throw new Error("Invalid authentication state.");
  if (state.activatedAt !== undefined && (!state.totpSecret || !validInteger(state.activatedAt))) throw new Error("Invalid authentication state.");
  return state as AuthState;
}

function encrypt(config: AuthConfig, state: AuthState): Envelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(config), iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(state), "utf8"), cipher.final()]);
  return {
    version: STATE_VERSION,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}

function decrypt(config: AuthConfig, value: string): AuthState {
  const envelope = JSON.parse(value) as Partial<Envelope>;
  if (envelope.version !== STATE_VERSION || typeof envelope.iv !== "string" || typeof envelope.tag !== "string" || typeof envelope.ciphertext !== "string") {
    throw new Error("Invalid authentication state.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key(config), Buffer.from(envelope.iv, "base64url"));
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64url")), decipher.final()]);
  return validateState(JSON.parse(plaintext.toString("utf8")));
}

async function writeState(config: AuthConfig, state: AuthState) {
  const dir = directory(config);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const path = join(dir, STATE_FILE);
  const temporary = join(dir, `.auth-state-${process.pid}-${randomBytes(8).toString("hex")}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(encrypt(config, validateState(state))), { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally {
    await unlink(temporary).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  }
}

async function loadState(config: AuthConfig): Promise<AuthState> {
  const path = join(directory(config), STATE_FILE);
  try {
    return decrypt(config, await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Authentication state is unavailable.");
    const state: AuthState = { version: STATE_VERSION, generation: randomBytes(32).toString("base64url") };
    await writeState(config, state);
    return state;
  }
}

export async function initializeAuthState(config: AuthConfig) {
  await serialized(async () => { await loadState(config); });
}

export async function authStateStatus(config: AuthConfig) {
  return serialized(async () => {
    const state = await loadState(config);
    return { enabled: Boolean(state.totpSecret), activatedAt: state.activatedAt ?? null, generation: state.generation };
  });
}

export async function currentAuthGeneration(config: AuthConfig) {
  return (await authStateStatus(config)).generation;
}

export async function storePendingTotp(config: AuthConfig, secret: string, now = Date.now()) {
  if (!base32.test(secret)) throw new Error("Invalid TOTP secret.");
  return serialized(async () => {
    const state = await loadState(config);
    if (state.totpSecret) return { status: "already-enabled" as const };
    const expires = now + SETUP_SECONDS * 1000;
    await writeState(config, { ...state, pendingTotp: { secret, expires } });
    return { status: "ready" as const, expires };
  });
}

export async function activatePendingTotp(
  config: AuthConfig,
  token: string,
  now: number,
  verifier: (secret: string, token: string, now: number) => Promise<number | null>,
) {
  if (!/^\d{6}$/.test(token)) return { status: "invalid" as const };
  return serialized(async () => {
    const state = await loadState(config);
    if (state.totpSecret) return { status: "already-enabled" as const };
    if (!state.pendingTotp || state.pendingTotp.expires <= now) {
      if (state.pendingTotp) {
        const withoutPending = { ...state };
        delete withoutPending.pendingTotp;
        await writeState(config, withoutPending);
      }
      return { status: "expired" as const };
    }
    const timeStep = await verifier(state.pendingTotp.secret, token, now);
    if (timeStep === null) return { status: "invalid" as const };
    const next: AuthState = {
      version: STATE_VERSION,
      generation: randomBytes(32).toString("base64url"),
      totpSecret: state.pendingTotp.secret,
      lastTimeStep: timeStep,
      activatedAt: now,
    };
    await writeState(config, next);
    return { status: "activated" as const, generation: next.generation };
  });
}

export async function verifyStoredTotpOnce(
  config: AuthConfig,
  token: string,
  now: number,
  verifier: (secret: string, token: string, now: number, lastTimeStep?: number) => Promise<number | null>,
) {
  if (!/^\d{6}$/.test(token)) return false;
  return serialized(async () => {
    const state = await loadState(config);
    if (!state.totpSecret) return false;
    const timeStep = await verifier(state.totpSecret, token, now, state.lastTimeStep);
    if (timeStep === null) return false;
    await writeState(config, { ...state, lastTimeStep: timeStep });
    return true;
  });
}

export const authStateFile = (config: AuthConfig) => join(directory(config), STATE_FILE);
