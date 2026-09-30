try {
  const response = await fetch(`http://127.0.0.1:${process.env.PORT || "3000"}/api/health`, {
    signal: AbortSignal.timeout(3000), redirect: "error",
  });
  if (!response.ok || (await response.json()).status !== "ok") process.exit(1);
} catch {
  process.exit(1);
}
