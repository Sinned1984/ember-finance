# Production security boundary

Ember Finance itself authenticates visitors. The reverse proxy supplies HTTPS and proxying
only: **no external authentication gateway is assumed or required**. The Firefly token
identifies Ember to Firefly and never authenticates visitors or enters their sessions.

`Internet → HTTPS reverse proxy → Ember authentication → private financial UI → Firefly API`

## Authentication decision (Milestones 3B.1 and 3B.2)

The verified runtime is Next.js 16.3.6 App Router on Node 24. The selected libraries are
iron-session 9.0.1, bcryptjs 3.0.3 and otplib 13.5.0, pinned in package.json and the lockfile. iron-session
explicitly supports Next App Router cookie stores and Node requests; its current release
requires Node 22.13+, compatible with this application. It owns cookie encryption, integrity
and expiration. bcryptjs verifies the single deployment-supplied password hash without a
native binary dependency. otplib verifies Google Authenticator-compatible six-digit TOTP codes
with constant-time comparison and a bounded clock window. A broader identity platform/user database is unnecessary for this
single-user scope. There is no registration, reset email, OAuth, role system or financial database.

Configuration is server-only: EMBER_AUTH_USERNAME, EMBER_AUTH_PASSWORD_HASH, EMBER_AUTH_SECRET
and EMBER_APP_URL. Production requires a canonical HTTPS origin (no path/query/credentials).
The validated origin, not arbitrary forwarded headers, controls CSRF checks and redirect targets.
Missing/invalid configuration fails closed; container startup exits with a fixed safe message.

## Sessions and enforcement

- Next's Node `src/proxy.ts` verifies sealed cookies **and active server records** before allowing
  any application path except exact `/login`, `/login/2fa`, `/api/auth/login`, `/api/auth/totp`,
  `/api/auth/logout`, `/api/health`
  and framework static assets under `/_next/static/`. Arbitrary extensions, API prefixes, image
  optimization, RSC/prefetch requests and unimplemented future endpoints are not public exceptions.
  The two TOTP exceptions do not accept an authenticated session substitute: they require a separate
  active pre-authentication record created only after successful password verification.
- All six financial pages independently call `requireUser()` before fetching any financial data;
  the financial route-group layout also checks. Layout-only protection would not be sufficient
  because Next can render child components in parallel. There is no arbitrary Firefly proxy endpoint.
- `/api/auth/session` is protected and returns only 204/401, no identity or financial payload.
  Login and logout allow POST only, validate the exact configured Origin and reject cross-site
  Fetch Metadata. Login accepts bounded form data only. Absent/null Origin is not accepted.
- Production cookie: `__Host-ember-session`, HttpOnly, Secure, SameSite=Lax, Path=/, no Domain,
  absolute eight-hour expiry. It contains only an opaque random session ID and expiry, encrypted
  by iron-session. No password/hash, Firefly credentials or financial information enters it.
- After 2FA enrolment, password success creates only a five-minute `__Host-ember-preauth` cookie (HttpOnly, Secure,
  SameSite=Strict, Path=/, no Domain) and a temporary server record. It contains only an opaque
  challenge ID and expiry and cannot pass financial route checks. At most five invalid TOTP codes
  are accepted per challenge. Expiry, cancellation, logout and successful verification revoke it.
- Before enrolment, password success creates the normal full session. Authenticated enrolment generates
  the seed server-side, returns it only to that browser as a local QR/manual key, and requires a valid code.
  Activation rotates a persistent random security generation, so all full and pre-auth sessions become
  invalid even across a concurrent password login. Each later successful TOTP verification rotates the
  presented full session ID; there is no silent sliding renewal.
  Logout removes its server record before destroying the cookie. A captured old cookie cannot be
  replayed after logout. Password, username, secret or canonical-origin changes also invalidate
  records via their configuration namespace. Security-generation rotation deliberately signs all devices out.
- Revocation records are tiny expiry/generation files in a private directory under the OS temporary
  directory (0700 directory/0600 files on Linux). Opaque IDs are strictly validated before file
  access. At most 32 active records are retained per configuration; oldest devices are evicted.
  Expired records are removed on login. Container `/tmp` is tmpfs: stopping/recreating the container
  loses sessions and users sign in again. The encrypted enrollment/security-generation/TOTP replay
  state is separate and persistent in `ember-auth-state`; back it up with the matching auth secret.
  A Node process restart with the same temporary directory may retain unexpired records.
- Authenticated and login responses use private/no-store. Full navigation after logout, clearing
  browser cache where supported, absolute-expiry UI handling and history restoration checks reduce
  stale displays. A lightweight session check on tab visibility and every minute detects logout
  from another tab. These client measures are UX only; every server request remains checked.

## Login abuse and limitations

A process-wide limiter permits ten password-login attempts per fifteen minutes and one concurrent
password verification. Successful attempts count too. Incorrect username and password have the
same Dutch error and both go through password verification. Input has a 4 KiB limit, five-second
body-reading deadline, and bcrypt's 72-byte password limit is enforced to avoid silent truncation.

TOTP input is exactly six decimal digits with a 512-byte request limit and five-second deadline.
A separate process-wide limiter serializes and bounds TOTP verification. Each password-created
challenge is revoked after five incorrect codes. Verification permits one 30-second period of clock
drift in either direction. The last accepted TOTP time step is stored in encrypted persistent auth state and
passed back as an exclusive lower bound, so the same or an older code cannot be accepted again.

The limiter never trusts X-Forwarded-For. It is designed for **one Node process / one container**,
resets on process restart, and can temporarily deny the legitimate user if an attacker exhausts
its global allowance. It is not distributed or durable DDoS protection. Keep only one replica;
scaling requires shared session/challenge/replay stores and shared limiters. TOTP is mandatory after enrollment;
there is deliberately no environment switch that silently falls back to password-only login.
The HTTPS edge should additionally bound request sizes, connection rates and slow connections;
this is ordinary proxy hardening, not external user authentication.

No website can erase data already viewed/copied by an authenticated user. Logout cannot cancel
responses already in flight; inactive tabs may retain previously rendered data until their next
visibility/session check. Browser/OS password-manager storage is outside Ember's session storage.
Ember stores no credentials in localStorage or sessionStorage.

## HTTPS and network boundary

- Set EMBER_APP_URL to your exact public HTTPS origin, such as `https://finance.example.com`.
  It is runtime configuration, not a hardcoded dependency. Serve Ember at the hostname root.
- Default Compose publishing is `127.0.0.1:3000`, suitable for a host-native same-host proxy.
  For a remote proxy, bind the Ubuntu private IP and apply Docker-aware firewall rules allowing
  only that proxy. Private-IP binding alone is not an allowlist. Check IPv6/direct routing too;
  ordinary UFW rules alone may not filter Docker-published ports. Never internet-forward raw HTTP.
- A proxy container's localhost is itself; use a suitable existing private network or a restricted
  host connection. Do not change Firefly's stack, database, importer or Docker configuration.
- Forward cookies, Origin, Host, query strings, Next routing headers and streaming responses.
  Replace untrusted X-Forwarded-Host/Proto with the public host and `https`. Do not rewrite or
  strip Set-Cookie or Origin, and do not downgrade cookie security to make HTTP login work.
- Never cache financial HTML/RSC/auth responses at the proxy/CDN. Versioned static assets retain
  their normal caching. Set TLS/HSTS at the HTTPS edge. Login redirects use EMBER_APP_URL.
- Use a maintained Docker Engine 28+ (older engines have a documented same-L2 exception to
  loopback publishing), and keep Node, Next and authentication dependencies patched.

The optional `compose.https.yaml` companion provides this HTTPS edge using pinned Caddy.
It publishes only TCP 80/443 and removes Ember's raw host port. Automatic public TLS
requires the user's public DNS hostname and reachable challenge ports. Ember rejects
unsupported origins before initializing auth state. Existing proxy mode and its bind/port
variables remain available; production HTTP is not supported in either mode. Caddy's admin
endpoint is loopback-only inside its container. Its health check confirms local readiness,
not public certificate issuance. The companion receives only the public origin and uses
separate persistent TLS volumes. See [installation](../README.md#security-and-production-installation).

## Runtime privacy and headers

The non-root `ember` user/group retain UID/GID 1001 and the read-only Compose filesystem.
`/tmp` holds temporary revocation records; `/var/lib/ember-auth` holds encrypted persistent
TOTP enrollment, replay and security-generation state. Preserve this volume and its matching
auth secret across recreation and deployment-mode changes. The external-volume migration
override prevents silent replacement; see [migration](deployment-migration.md).
Runtime secrets are not build arguments or image
layers; the build context is allowlisted and excludes .env/private keys/local .next output.
Host/Docker administrators remain trusted: runtime environment variables are visible to them.
Use mode 600 on .env; do not publish rendered Compose config, inspect output or environment dumps.

Headers include nosniff, DENY/frame-ancestors, restricted camera/microphone/geolocation and a
compatible base/object/form CSP. Referrer-Policy is **same-origin**: it prevents cross-site
referrer disclosure while preserving Origin on native login/logout form submissions.
The former no-referrer policy produced Origin:null and was incompatible with strict origin checks.
The CSP is not a strict script/nonce policy; Next inline hydration remains supported.

`/api/health` is public, cheap, no-store and returns only `{"status":"ok"}`. It does not test
Firefly or credential validity. No token, URL or financial data appears in it. Operational
errors remain sanitized, no raw auth/Firefly responses are logged, and no telemetry is added.
Only authentication endpoints write local auth/session state; all Firefly operations remain GET-only.
The enabled TOTP seed, last accepted time step and a random security generation are stored in one
AES-256-GCM encrypted file on the dedicated auth volume. The encryption key is derived from
`EMBER_AUTH_SECRET` with HKDF; the plaintext seed is never written to disk. Corrupt encrypted state
fails startup/authentication closed. The root filesystem remains read-only.

## Deployment acceptance (must be performed on the target)

1. Build the normal final production image, then generate the password hash and session secret using
   README's container commands. Configure the exact
   public HTTPS origin, start Compose and check health. Confirm the host clock is synchronized.
   On updates, retain existing credentials. Run `python3 tests/docker-auth-smoke.py ember-finance:0.1.0-rc.1`
   on Ubuntu/CI to exercise both credential-generator modes in the final image without host dependency mounts.
2. Through the real HTTPS proxy (without external authentication), check anonymous denial on all
   six pages, API/session and RSC requests. Verify the first password login succeeds, then enrol from
   Profielinstellingen → Beveiliging using the QR/manual key. Confirm activation forces logout. Verify that
   the next correct password reaches `/login/2fa` but still cannot access financial routes, an incorrect
   TOTP is rejected, a current Google Authenticator code creates the full session, and logout clears access.
3. Verify direct raw-port access from untrusted IPv4/IPv6 clients is blocked by deployment networking.
   Even trusted direct requests without a session must not reveal financial data.
4. Check all pages, data, months, filters and assets after login; verify no-store headers and safe logs.
5. Restart/recreate the container, check health recovery and login after lost temporary sessions.
   Verify previously enrolled TOTP still challenges, replay state persists, and the mounted
   volume name/UID/GID are unchanged. Verify host-admin reset on an isolated synthetic installation.
   Validate `/tmp` permissions, read-only filesystem behavior and bounded logging on Ubuntu.
6. Temporarily unavailable Firefly must leave health healthy and show isolated safe errors after
   authentication. Do not alter financial data for tests.

If the authenticator device is lost, recovery is deliberately host-admin only: stop the service, run
`docker compose run --rm --no-deps ember node scripts/totp-admin.mjs reset`, then start it again.
Retain all selected HTTPS/migration `-f` flags; see [installation](../README.md#updates-backups-and-recovery).
The next password login can enrol a new authenticator. There are no browser-exported recovery codes.
The encrypted state lives in the named auth volume; loss of that volume resets 2FA and therefore has
to be treated as a security event.

Repository validation uses the real Compose parser, native Caddy with an isolated test CA,
and the production build with synthetic GET-only Firefly responses. It covers HTTPS redirects,
cookies/origin checks, enrollment/login/logout, replay/state persistence across fresh process/temp
storage recreation, certificate persistence and packaged admin reset. Native tests do not prove
Linux container runtime behavior or public ACME issuance. Docker is absent on the development
machine; acceptance of the final Linux image, real public TLS and host firewall boundary remains
required. Keep the product labelled v0.1 release candidate until then.

## References

- [iron-session API and Next examples](https://github.com/vvo/iron-session)
- [bcryptjs API and input length](https://github.com/dcodeIO/bcrypt.js)
- [Next authentication and server-side authorization](https://nextjs.org/docs/app/guides/authentication)
- [Next self-hosting](https://nextjs.org/docs/app/guides/self-hosting)
- [Docker port publishing](https://docs.docker.com/engine/network/port-publishing/)
- [Docker firewall behavior](https://docs.docker.com/engine/network/packet-filtering-firewalls/)
- [Caddy automatic HTTPS prerequisites](https://caddyserver.com/docs/automatic-https)
- [Compose reset override](https://docs.docker.com/reference/compose-file/merge/#reset-value)
- [Compose external volume names](https://docs.docker.com/reference/compose-file/volumes/#name)
