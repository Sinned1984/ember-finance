"use client";
import { useEffect } from "react";

// UX only. Every server request is independently authenticated. Clear a restored
// history page and leave the financial UI at the absolute session expiry.
export function SessionExpiry({ expires }: { expires: number }) {
  useEffect(() => {
    const hide = () => { document.documentElement.style.visibility = "hidden"; };
    const expire = () => { hide(); window.location.replace("/login"); };
    const check = async () => {
      if (Date.now() >= expires) return expire();
      if (document.visibilityState !== "visible") return;
      try { if ((await fetch("/api/auth/session", { cache: "no-store" })).status === 401) expire(); } catch { /* Network failure does not grant server access. */ }
    };
    const restored = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload(); };
    const timer = window.setTimeout(expire, Math.max(0, expires - Date.now()));
    const poll = window.setInterval(check, 60000);
    window.addEventListener("pageshow", restored);
    window.addEventListener("pagehide", hide);
    document.addEventListener("visibilitychange", check);
    return () => { clearTimeout(timer); clearInterval(poll); window.removeEventListener("pageshow", restored); window.removeEventListener("pagehide", hide); document.removeEventListener("visibilitychange", check); };
  }, [expires]);
  return null;
}
