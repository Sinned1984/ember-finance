import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getIronSession } from "iron-session";
import { activeSession, authConfig, sessionOptions, type SessionData } from "./session.ts";

export async function requireUser() {
  let expires: number | undefined;
  let username: string | undefined;
  try {
    const config = authConfig();
    const session = await getIronSession<SessionData>(await cookies(), sessionOptions(config));
    if (await activeSession(session, config)) {
      expires = session.expires;
      username = config.username;
    }
  } catch { /* Fail closed, without serializing configuration or library errors. */ }
  if (!expires || !username) redirect("/login");
  return { expires, username };
}
