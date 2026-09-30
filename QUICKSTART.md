# Ember Finance --- Quick Start

A short installation guide for **Ember Finance**, an independent,
read-only web interface for Firefly III.

This is for people who just want to get Ember running with Docker
Compose. For architecture, security details, API behaviour, validation
and development information, see the full `README.md`.

## Requirements

-   Working **Firefly III**
-   **Docker Engine 28+**
-   **Docker Compose plugin 2.24.4+**
-   Linux Docker host
-   Firefly III **Personal Access Token**
-   HTTPS hostname for Ember

> Ember is read-only towards Firefly III. Firefly remains the backend
> and source of truth.

## 1. Prepare Ember

Download/extract the release and open a terminal in its directory.

``` sh
umask 077
cp -n .env.example .env
chmod 600 .env
```

Do not commit or share `.env`.

## 2. Build and create login credentials

``` sh
docker build --pull -t ember-finance:0.1.0-rc.1 .
```

Generate your password hash:

``` sh
docker run --rm -it --entrypoint node ember-finance:0.1.0-rc.1 scripts/auth-config.mjs password
```

Generate the authentication secret:

``` sh
docker run --rm --entrypoint node ember-finance:0.1.0-rc.1 scripts/auth-config.mjs secret
```

Copy the generated values into `.env`. Keep `EMBER_AUTH_PASSWORD_HASH`
single-quoted because bcrypt hashes contain `$` characters.

## 3. Configure `.env`

At minimum:

``` env
FIREFLY_BASE_URL=https://firefly.example.com
FIREFLY_API_TOKEN=your-personal-access-token

EMBER_APP_URL=https://finance.example.com
EMBER_AUTH_USERNAME=your-username
EMBER_AUTH_PASSWORD_HASH='your-generated-bcrypt-hash'
EMBER_AUTH_SECRET=your-generated-secret
```

`FIREFLY_BASE_URL` is the root of Firefly --- do not add `/api` or
`/api/v1`. It must be reachable from the Ember container.

`EMBER_APP_URL` must exactly match the HTTPS address opened in your
browser.

## 4A. Existing HTTPS reverse proxy

Use this if you already run Synology Reverse Proxy, Nginx, Caddy,
Traefik or another HTTPS reverse proxy.

For a proxy running directly on the same Docker host, the defaults can
normally remain:

``` env
EMBER_BIND_ADDRESS=127.0.0.1
EMBER_PORT=3000
```

Start Ember:

``` sh
docker compose config --quiet
docker compose up -d --wait --wait-timeout 120
docker compose ps
```

Point your HTTPS reverse proxy at Ember's HTTP backend. Do not expose
Ember's raw HTTP port directly to the internet.

## 4B. No reverse proxy --- bundled Caddy HTTPS

Ember includes an optional Caddy setup that can obtain and renew a
trusted HTTPS certificate automatically.

You need a public DNS hostname pointing to your connection, TCP ports
**80 and 443** forwarded to the Docker host, and no other service using
those ports. Set:

``` env
EMBER_APP_URL=https://your-hostname
```

Then:

``` sh
docker compose -f compose.yaml -f compose.https.yaml config --quiet
docker compose -f compose.yaml -f compose.https.yaml up --no-build -d --wait --wait-timeout 120
docker compose -f compose.yaml -f compose.https.yaml ps
```

Check:

``` sh
curl --fail https://your-hostname/api/health
```

Expected:

``` json
{"status":"ok"}
```

> **Testing note:** The bundled Caddy deployment is included for
> community testing, but has not yet been tested by the project author
> in a real public deployment. The existing-reverse-proxy deployment has
> been tested in practice.

Caddy's public certificate mode will not work with an arbitrary private
LAN IP. DNS, public reachability and certificate validation must work
correctly.

For this mode, keep both `-f compose.yaml -f compose.https.yaml`
arguments in future Compose commands.

## 5. Login and optional 2FA

Open Ember and log in using your configured username and password.

Enable TOTP under:

**Profile → Beveiliging → 2FA instellen**

Scan the QR code or enter the key in your authenticator and confirm the
six-digit code. Future logins then require password + TOTP.

## Updating Ember

Preserve your `.env`, `EMBER_AUTH_SECRET`, `ember-auth-state` volume and
Compose project/directory identity.

> **Never use `docker compose down -v` for a normal update.** `-v`
> removes persistent volumes, including authentication/2FA state.

Existing reverse proxy:

``` sh
docker compose build --pull ember
docker compose up -d --wait --wait-timeout 120
```

Bundled Caddy:

``` sh
docker compose -f compose.yaml -f compose.https.yaml build --pull ember
docker compose -f compose.yaml -f compose.https.yaml pull ember-https
docker compose -f compose.yaml -f compose.https.yaml up -d --wait --wait-timeout 120
```

## Migrating an older Ember installation

If upgrading an older installation --- especially one using the old
`bloom` service name --- do **not** treat it as a fresh install.

Preserve `.env`, `EMBER_AUTH_SECRET` and the existing auth-state volume,
then follow:

`docs/deployment-migration.md`

Do not delete/recreate the auth-state volume if you want to retain
existing TOTP enrollment.

## Quick troubleshooting

``` sh
docker compose ps
docker compose exec -T ember node scripts/healthcheck.mjs
```

Check that `EMBER_APP_URL` exactly matches the browser URL, Firefly is
reachable from the container, the PAT is valid, and the host clock is
synchronized for TOTP.

For bundled Caddy, also check DNS and ports 80/443 and remember to use
both Compose files.

For detailed security, migration/recovery, API behaviour, development
and validation information, see `README.md` and `docs/`.
