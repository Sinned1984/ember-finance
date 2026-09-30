import { cp, mkdir, mkdtemp, readdir, rm, lstat, readlink, symlink } from "node:fs/promises";
import { basename, dirname, join, resolve, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

// Mirror the runner layout using the local standalone build, without local .env files.
// This validates the entrypoint/artifact on the host; it is NOT Linux Docker validation.
const root = await mkdtemp(join(tmpdir(), "ember-standalone-check-"));
try {
  const links = [];
  await cp(".next/standalone", root, {
    recursive: true,
    filter: async path => {
      if (basename(path).startsWith(".env")) return false;
      if ((await lstat(path)).isSymbolicLink()) { links.push(path); return false; }
      return true;
    },
  });
  // Windows Next tracing emits absolute junctions into the original pnpm tree.
  // Relocate them inside the staged artifact; never resolve packages from the checkout.
  for (const source of links) {
    const target = resolve(dirname(source), await readlink(source));
    const traced = relative(resolve(".next/standalone"), target);
    const dependency = relative(resolve("node_modules"), target);
    const inside = value => !value.startsWith("..") && !isAbsolute(value);
    const destination = inside(traced) ? join(root, traced) : inside(dependency) ? join(root, "node_modules", dependency) : null;
    if (!destination) throw new Error("Standalone dependency points outside the traced package tree");
    const link = join(root, relative(resolve(".next/standalone"), resolve(source)));
    await mkdir(dirname(link), { recursive: true });
    await symlink(destination, link, process.platform === "win32" ? "junction" : "dir");
  }
  await cp(".next/static", join(root, ".next/static"), { recursive: true });
  await mkdir(join(root, "scripts"), { recursive: true });
  for (const file of ["start.mjs", "healthcheck.mjs", "auth-config.mjs", "totp-admin.mjs"]) await cp(join("scripts", file), join(root, "scripts", file));
  await cp(dirname(fileURLToPath(import.meta.resolve("bcryptjs"))), join(root, "scripts/node_modules/bcryptjs"), { recursive: true, dereference: true });
  const generated = spawnSync(process.execPath, ["scripts/auth-config.mjs", "secret"], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(generated.status, 0, "Staged auth generator must resolve its dependencies");
  assert.ok(/^EMBER_AUTH_SECRET=[A-Za-z0-9_-]{43}\r?\n$/.test(generated.stdout), "Expected a generated session secret");
  const password = spawnSync(process.execPath, ["scripts/auth-config.mjs", "password"], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(password.status, 1);
  assert.ok(password.stderr.includes("terminal"), "Password generation must load successfully and require an interactive terminal");
  await mkdir(join(root, "src/lib"), { recursive: true });
  await cp("src/lib/config-validation.ts", join(root, "src/lib/config-validation.ts"));
  await cp("src/lib/deployment-config.ts", join(root, "src/lib/deployment-config.ts"));
  await mkdir(join(root, "src/lib/auth"), { recursive: true });
  await cp("src/lib/auth/config.ts", join(root, "src/lib/auth/config.ts"));
  await cp("src/lib/auth/auth-state.ts", join(root, "src/lib/auth/auth-state.ts"));
  if ((await readdir(root)).some(file => file.startsWith(".env"))) throw new Error("Unexpected environment file in staged artifact");
  process.env.EMBER_STANDALONE_ROOT = root;
  await import("./smoke.mjs");
} finally {
  delete process.env.EMBER_STANDALONE_ROOT;
  if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("ember-standalone-check-")) throw new Error("Invalid temporary cleanup path");
  await rm(root, { recursive: true, force: true });
}
