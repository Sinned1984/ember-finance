import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

try {
  if (process.argv.length !== 3 || process.argv[2] !== "reset") throw new Error("Usage: node scripts/totp-admin.mjs reset");
  const directory = process.env.EMBER_AUTH_STATE_DIR || "/var/lib/ember-auth";
  for (const name of ["auth-state.json", ...await readdir(directory).then(entries => entries.filter(entry => /^\.auth-state-\d+-[0-9a-f]{16}\.tmp$/.test(entry))).catch(error => {
    if (error.code === "ENOENT") return [];
    throw error;
  })]) {
    await unlink(join(directory, name)).catch(error => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  console.log("2FA-instelling gewist. Start Ember opnieuw om alle bestaande sessies ongeldig te maken.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
