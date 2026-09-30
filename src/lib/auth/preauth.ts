import "server-only";
import type { SessionOptions } from "iron-session";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthConfig } from "./config.ts";
import { currentAuthGeneration } from "./auth-state.ts";

export const PREAUTH_SECONDS = 5 * 60;
export const PREAUTH_MAX_ATTEMPTS = 5;
export type PreAuthData = { id: string; expires: number; generation: string };
type PreAuthRecord = { expires: number; attempts: number; generation: string };

const validId = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
const validGeneration = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
const namespace = (config: AuthConfig) => createHash("sha256")
  .update(JSON.stringify([config.secret, config.username, config.passwordHash, config.origin, "preauth"]))
  .digest("hex");
const directory = (config: AuthConfig) => join(tmpdir(), "ember-preauth-" + namespace(config));

export function preAuthOptions(config: AuthConfig): SessionOptions {
  const password = createHash("sha256").update(config.secret + ":ember-preauth").digest("base64url");
  return {
    password,
    cookieName: config.production ? "__Host-ember-preauth" : "ember-preauth",
    ttl: PREAUTH_SECONDS,
    cookieOptions: { httpOnly: true, secure: config.production || config.origin.startsWith("https:"), sameSite: "strict", path: "/", maxAge: PREAUTH_SECONDS },
  };
}

async function record(session: Partial<PreAuthData>, config: AuthConfig, now = Date.now()): Promise<PreAuthRecord | null> {
  if (!validId(session.id) || !validGeneration(session.generation) || !Number.isSafeInteger(session.expires) || session.expires! <= now || session.expires! > now + PREAUTH_SECONDS * 1000) return null;
  try {
    if (session.generation !== await currentAuthGeneration(config)) return null;
    const value = JSON.parse(await readFile(join(directory(config), session.id), "utf8")) as Partial<PreAuthRecord>;
    const expires = value.expires, attempts = value.attempts, generation = value.generation;
    if (typeof expires !== "number" || expires !== session.expires || typeof attempts !== "number" || !Number.isSafeInteger(attempts) || attempts < 0 || attempts >= PREAUTH_MAX_ATTEMPTS || generation !== session.generation) return null;
    return { expires, attempts, generation };
  } catch { return null; }
}

export async function activePreAuth(session: Partial<PreAuthData>, config: AuthConfig, now = Date.now()) {
  return (await record(session, config, now)) !== null;
}

export async function revokePreAuth(session: Partial<PreAuthData>, config: AuthConfig) {
  if (!validId(session.id)) return;
  try { await unlink(join(directory(config), session.id)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Unable to revoke two-factor challenge."); }
}

export async function createPreAuth(config: AuthConfig, expectedGeneration?: string): Promise<PreAuthData> {
  const generation = expectedGeneration ?? await currentAuthGeneration(config);
  if (!validGeneration(generation) || generation !== await currentAuthGeneration(config)) throw new Error("Authentication state changed.");
  const dir = directory(config);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const now = Date.now();
  const active: Array<{ id: string; expires: number }> = [];
  for (const id of await readdir(dir)) {
    if (!validId(id)) continue;
    try {
      const value = JSON.parse(await readFile(join(dir, id), "utf8")) as Partial<PreAuthRecord>;
      if (typeof value.expires !== "number" || !Number.isSafeInteger(value.expires) || value.expires <= now) await revokePreAuth({ id }, config);
      else active.push({ id, expires: value.expires });
    } catch { await revokePreAuth({ id }, config); }
  }
  active.sort((a, b) => a.expires - b.expires);
  for (const old of active.slice(0, Math.max(0, active.length - 15))) await revokePreAuth(old, config);
  const challenge = { id: randomUUID(), expires: now + PREAUTH_SECONDS * 1000, generation };
  await writeFile(join(dir, challenge.id), JSON.stringify({ expires: challenge.expires, attempts: 0, generation }), { mode: 0o600, flag: "wx" });
  return challenge;
}

export async function registerPreAuthFailure(session: Partial<PreAuthData>, config: AuthConfig) {
  const current = await record(session, config);
  if (!current || !validId(session.id)) return false;
  const attempts = current.attempts + 1;
  if (attempts >= PREAUTH_MAX_ATTEMPTS) {
    await revokePreAuth(session, config);
    return false;
  }
  await writeFile(join(directory(config), session.id), JSON.stringify({ expires: current.expires, attempts, generation: current.generation }), { mode: 0o600 });
  return true;
}

export async function revokeAllPreAuth(config: AuthConfig) {
  try {
    for (const id of await readdir(directory(config))) if (validId(id)) await revokePreAuth({ id }, config);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Unable to revoke two-factor challenges.");
  }
}
