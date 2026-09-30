import "server-only";
import { getIronSession, type SessionOptions } from "iron-session";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateAuthConfig, type AuthConfig } from "./config.ts";
import { currentAuthGeneration } from "./auth-state.ts";

export const SESSION_SECONDS = 8 * 60 * 60;
export type SessionData = { id: string; expires: number; generation: string };
export const authConfig = () => validateAuthConfig(process.env);
export function sessionOptions(config: AuthConfig): SessionOptions {
  return {
    password: config.secret,
    cookieName: config.production ? "__Host-ember-session" : "ember-session",
    ttl: SESSION_SECONDS,
    cookieOptions: { httpOnly: true, secure: config.production || config.origin.startsWith("https:"), sameSite: "lax", path: "/", maxAge: SESSION_SECONDS },
  };
}

// iron-session handles all cookie encryption/integrity/expiry. These small server-side
// revocation records make destroy/logout effective against replayed copies as well.
// The config namespace invalidates existing records when credentials/secrets change.
function directory(config: AuthConfig) {
  const namespace = createHash("sha256").update(JSON.stringify([config.secret, config.username, config.passwordHash, config.origin])).digest("hex");
  return join(tmpdir(), "ember-auth-" + namespace);
}
const validId = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
const validGeneration = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);

export async function revokeSession(session: Partial<SessionData>, config: AuthConfig) {
  if (!validId(session.id)) return;
  try { await unlink(join(directory(config), session.id)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Unable to revoke session."); }
}

export async function activeSession(session: Partial<SessionData>, config: AuthConfig, now = Date.now()) {
  if (!validId(session.id) || !validGeneration(session.generation) || !Number.isSafeInteger(session.expires) || session.expires! <= now || session.expires! > now + SESSION_SECONDS * 1000) return false;
  try {
    if (session.generation !== await currentAuthGeneration(config)) return false;
    const record = JSON.parse(await readFile(join(directory(config), session.id), "utf8")) as Partial<SessionData>;
    return record.expires === session.expires && record.generation === session.generation && record.expires! > now;
  } catch { return false; }
}

export async function createSession(config: AuthConfig, expectedGeneration?: string): Promise<SessionData> {
  const generation = expectedGeneration ?? await currentAuthGeneration(config);
  if (!validGeneration(generation) || generation !== await currentAuthGeneration(config)) throw new Error("Authentication state changed.");
  const dir = directory(config);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const now = Date.now();
  const active = [];
  for (const id of await readdir(dir)) {
    if (!validId(id)) continue;
    try {
      const record = JSON.parse(await readFile(join(dir, id), "utf8")) as Partial<SessionData>;
      if (!Number.isSafeInteger(record.expires) || record.expires! <= now || !validGeneration(record.generation)) await revokeSession({ id }, config);
      else active.push({ id, expiry: record.expires! });
    } catch { await revokeSession({ id }, config); }
  }
  // Bound temporary storage; the oldest device is signed out when the limit is reached.
  active.sort((a, b) => a.expiry - b.expiry);
  for (const old of active.slice(0, Math.max(0, active.length - 31))) await revokeSession(old, config);
  const session = { id: randomUUID(), expires: now + SESSION_SECONDS * 1000, generation };
  await writeFile(join(dir, session.id), JSON.stringify(session), { mode: 0o600, flag: "wx" });
  return session;
}

export async function revokeAllSessions(config: AuthConfig) {
  try {
    for (const id of await readdir(directory(config))) if (validId(id)) await revokeSession({ id }, config);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Unable to revoke sessions.");
  }
}

export async function requestAuthenticated(request: Request) {
  try {
    const config = authConfig();
    const session = await getIronSession<SessionData>(request, new Response(), sessionOptions(config));
    return await activeSession(session, config);
  } catch { return false; }
}
