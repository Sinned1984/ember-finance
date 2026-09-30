import { randomBytes } from "node:crypto";
import { emitKeypressEvents } from "node:readline";
import { hash } from "bcryptjs";

async function hiddenInput(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Use an interactive terminal; passwords are not accepted as command arguments or piped input.");
  process.stdout.write(prompt);
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return await new Promise((resolve, reject) => {
    let value = "";
    function finish(error) {
      process.stdin.off("keypress", keypress);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error); else resolve(value);
    }
    function keypress(text, key = {}) {
      if (key.ctrl && key.name === "c") return finish(new Error("Cancelled."));
      if (key.name === "return" || key.name === "enter") return finish();
      if (key.name === "backspace") value = [...value].slice(0, -1).join("");
      else if (text && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(text)) value += text;
    }
    process.stdin.on("keypress", keypress);
  });
}

try {
  if (process.argv.length !== 3) throw new Error("Usage: node scripts/auth-config.mjs password|secret");
  if (process.argv[2] === "secret") console.log(`EMBER_AUTH_SECRET=${randomBytes(32).toString("base64url")}`);
  else if (process.argv[2] === "password") {
    const password = await hiddenInput("Wachtwoord (minimaal 12 tekens; invoer verborgen): ");
    const confirmation = await hiddenInput("Herhaal wachtwoord: ");
    if (password !== confirmation) throw new Error("De wachtwoorden komen niet overeen.");
    if ([...password].length < 12 || Buffer.byteLength(password, "utf8") > 72) throw new Error("Gebruik minimaal 12 tekens en maximaal 72 UTF-8 bytes.");
    console.log(`EMBER_AUTH_PASSWORD_HASH='${await hash(password, 12)}'`);
  } else throw new Error("Usage: node scripts/auth-config.mjs password|secret");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
