"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { AppIcon } from "./app-icon";

export function RefreshButton({ label = "Vernieuwen" }: { label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <button className="button" disabled={pending} aria-busy={pending} onClick={() => startTransition(() => router.refresh())}><AppIcon name="refresh" /><span>{pending ? "Laden…" : label}</span></button>;
}

