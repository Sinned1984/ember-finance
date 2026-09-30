import "server-only";
import { generateSecret, generateURI, verify } from "otplib";
import type { AuthConfig } from "./config.ts";
import { activatePendingTotp, storePendingTotp, verifyStoredTotpOnce } from "./auth-state.ts";

async function verifyTimeStep(secret: string, token: string, now: number, lastTimeStep?: number) {
  const result = await verify({
    secret,
    token,
    epoch: Math.floor(now / 1000),
    epochTolerance: [30, 30],
    ...(lastTimeStep === undefined ? {} : { afterTimeStep: lastTimeStep }),
  });
  return result.valid && "timeStep" in result ? result.timeStep : null;
}

export async function beginTotpSetup(config: AuthConfig, now = Date.now()) {
  const secret = generateSecret();
  const stored = await storePendingTotp(config, secret, now);
  if (stored.status === "already-enabled") return stored;
  return {
    status: "ready" as const,
    secret,
    expires: stored.expires,
    uri: generateURI({ issuer: "Ember Finance", label: config.username, secret }),
  };
}

export async function activateTotp(config: AuthConfig, token: string, now = Date.now()) {
  return activatePendingTotp(config, token, now, verifyTimeStep);
}

export async function verifyTotpOnce(config: AuthConfig, token: string, now = Date.now()) {
  return verifyStoredTotpOnce(config, token, now, verifyTimeStep);
}
