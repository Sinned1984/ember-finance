import "server-only";

// Single Node instance, global bucket (not spoofable X-Forwarded-For/IP buckets).
// Synchronous reservation also bounds concurrent expensive password verification.
export class LoginThrottle {
  private attempts: number[] = [];
  private busy = false;
  reserve(now = Date.now()) {
    this.attempts = this.attempts.filter(time => time > now - 15 * 60 * 1000);
    if (this.busy || this.attempts.length >= 10) return false;
    this.attempts.push(now);
    this.busy = true;
    return true;
  }
  release() { this.busy = false; }
}
const globalAuth = globalThis as typeof globalThis & { emberLoginThrottle?: LoginThrottle };
export const loginThrottle = globalAuth.emberLoginThrottle ??= new LoginThrottle();
const globalTotp = globalThis as typeof globalThis & { emberTotpThrottle?: LoginThrottle };
export const totpThrottle = globalTotp.emberTotpThrottle ??= new LoginThrottle();
const globalEnrollment = globalThis as typeof globalThis & { emberEnrollmentThrottle?: LoginThrottle };
export const enrollmentThrottle = globalEnrollment.emberEnrollmentThrottle ??= new LoginThrottle();

export function sameOriginPost(request: Request, origin: string) {
  return request.method === "POST" && request.headers.get("origin") === origin &&
    !["cross-site", "none"].includes(request.headers.get("sec-fetch-site") ?? "") &&
    request.headers.get("content-type")?.split(";")[0].trim() === "application/x-www-form-urlencoded";
}

// Enforce a real byte bound even when Content-Length is absent/false.
export async function loginFields(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 5000);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 4096) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    if (timedOut) return null;
    const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
    if (form.getAll("username").length !== 1 || form.getAll("password").length !== 1) return null;
    const username = form.get("username")!;
    const password = form.get("password")!;
    if (username.length > 128 || !password || Buffer.byteLength(password, "utf8") > 72) return null;
    return { username, password };
  } finally { clearTimeout(timeout); reader.releaseLock(); }
}

export async function totpField(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 5000);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 512) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    if (timedOut) return null;
    const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
    if (form.getAll("code").length !== 1) return null;
    const code = form.get("code")!;
    return /^\d{6}$/.test(code) ? code : null;
  } finally { clearTimeout(timeout); reader.releaseLock(); }
}
