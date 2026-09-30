"""Ubuntu/CI check of credential generators in the FINAL image; no app secrets needed.

Run: python3 tests/docker-auth-smoke.py [ember-finance:0.1.0-rc.1]
Python is only a test-runner requirement, not an installation requirement.
Captured credentials and terminal output are never printed, even on failure.
"""

import errno
import os
import re
import select
import subprocess
import sys
import time
import uuid


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def run_check(image):
    import pty  # Linux/macOS only: supplies a real terminal to docker run -it.

    base = ["docker", "run", "--rm", "--pull=never", "--network=none", "--read-only",
            "--cap-drop=ALL", "--security-opt=no-new-privileges", "--entrypoint", "node"]
    secrets = []
    for _ in range(2):
        result = subprocess.run(base + [image, "scripts/auth-config.mjs", "secret"],
                                capture_output=True, timeout=30, check=False)
        require(result.returncode == 0, "Final-image secret command failed")
        require(re.fullmatch(rb"EMBER_AUTH_SECRET=[A-Za-z0-9_-]{43}\r?\n", result.stdout),
                "Invalid secret output")
        secrets.append(result.stdout)
    require(secrets[0] != secrets[1], "Secret generator must produce fresh randomness")

    # Exactly the documented interactive command, with extra runtime restrictions.
    # No host script/dependency mounts, env file, or dependency-stage image.
    name = "ember-auth-check-" + uuid.uuid4().hex
    master, slave = pty.openpty()
    child = None
    captured = b""
    password = b"synthetic-container-check-" + uuid.uuid4().hex.encode()
    prompts = [b"invoer verborgen): ", b"Herhaal wachtwoord: "]
    answered = 0
    try:
        child = subprocess.Popen(base + ["--name", name, "-it", image,
                                        "scripts/auth-config.mjs", "password"],
                                 stdin=slave, stdout=slave, stderr=slave)
        os.close(slave)
        slave = None
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            if select.select([master], [], [], 0.2)[0]:
                try:
                    chunk = os.read(master, 65536)
                except OSError as error:
                    if error.errno == errno.EIO:
                        break
                    raise
                if not chunk:
                    break
                captured += chunk
                require(len(captured) < 65536, "Unexpected excessive generator output")
                if answered < len(prompts) and prompts[answered] in captured:
                    os.write(master, password + b"\r")
                    answered += 1
            elif child.poll() is not None:
                break
        require(child.wait(timeout=5) == 0, "Final-image password command failed")
        require(answered == 2, "Password generator must ask twice")
        require(password not in captured, "Password was echoed by the generator")
        match = re.search(rb"EMBER_AUTH_PASSWORD_HASH='(\$2[aby]\$12\$[./A-Za-z0-9]{53})'", captured)
        require(match is not None, "Missing cost-12 bcrypt hash")
        # Verify the generated hash using the shipped CLI package, with synthetic input
        # on stdin, never in command arguments or diagnostic output.
        verify = """
import { createRequire } from 'node:module';
const require = createRequire(process.cwd() + '/scripts/auth-config.mjs');
const { compareSync } = require('bcryptjs');
let input = ''; for await (const part of process.stdin) input += part;
const [password, hash] = input.trim().split('\\n');
if (!compareSync(password, hash) || compareSync(password + 'wrong', hash)) process.exit(1);
if (process.getuid() !== 1001 || process.getgid() !== 1001) process.exit(1);
const { readFileSync } = require('node:fs');
if (!readFileSync('/etc/passwd', 'utf8').split('\\n').some(line => /^ember:[^:]*:1001:1001:/.test(line))) process.exit(1);
"""
        verified = subprocess.run(base + ["-i", image, "--input-type=module", "-e", verify],
                                  input=password + b"\n" + match.group(1) + b"\n",
                                  capture_output=True, timeout=30, check=False)
        require(verified.returncode == 0, "Hash verification/non-root check failed")
    finally:
        # Only the uniquely named temporary test container is eligible for removal.
        subprocess.run(["docker", "rm", "-f", name], capture_output=True, timeout=15, check=False)
        if child is not None and child.poll() is None:
            child.kill()
            child.wait(timeout=5)
        os.close(master)
        if slave is not None:
            os.close(slave)

    non_tty = subprocess.run(base + [image, "scripts/auth-config.mjs", "password"],
                             capture_output=True, timeout=30, check=False)
    require(non_tty.returncode != 0 and b"interactive terminal" in non_tty.stderr,
            "Non-interactive password entry must be rejected")
    reset = subprocess.run(base + ["--tmpfs", "/tmp:size=16m,mode=1777,noexec,nosuid",
                                  "-e", "EMBER_AUTH_STATE_DIR=/tmp/ember-auth-check", image,
                                  "scripts/totp-admin.mjs", "reset"],
                           capture_output=True, timeout=30, check=False)
    require(reset.returncode == 0, "Packaged admin reset failed on isolated empty test state")
    print("PASS: final-image generators, hidden input, bcrypt verification, Ember UID/GID, non-TTY rejection and packaged admin reset")


if __name__ == "__main__":
    try:
        require(os.name == "posix", "Run this Docker terminal check on Ubuntu/Linux or macOS")
        require(len(sys.argv) <= 2, "Usage: python3 tests/docker-auth-smoke.py [image]")
        run_check(sys.argv[1] if len(sys.argv) == 2 else "ember-finance:0.1.0-rc.1")
    except Exception:
        # Never include captured terminal/subprocess output in failure diagnostics.
        print("FAIL: final-image auth generator check; verify Docker/image availability and inspect the test locally.", file=sys.stderr)
        sys.exit(1)
