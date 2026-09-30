# Ember Finance

**An independent modern web interface for Firefly III.**

Ember is not an official Firefly III project. Firefly remains the
financial backend and source of truth. Ember is a separate, read-only
Next.js/React/TypeScript/Tailwind frontend. Milestones 1, 2A
(Transactions), 2B (Budgets), 2C (monthly transactions, Subscriptions,
Ember branding), 2D (Reports), 3A (Dutch localization) and 3C (financial
navigation and monthly insights) are implemented. **Ember Finance v0.1
release candidate.** Milestone 3B repository hardening is implemented;
Milestone 3B.1 built-in authentication and the user-managed TOTP/2FA
revision are implemented. The Ubuntu/Docker deployment, password/secret
generators, real TOTP enrolment/login flow and persistent
`ember-auth-state` behavior have been user-verified on the target
deployment. Milestone 3C preserves that deployment and authentication
architecture. See PROJECT_STATUS.md.

## Local Windows development

Requirements: Node.js 24 and pnpm 11.19.0
(`npm install --global pnpm@11.19.0`).

``` powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env
# Edit .env locally with your existing Firefly URL and personal access token.
# Generate/configure authentication as described below; set EMBER_APP_URL=http://127.0.0.1:3000.
pnpm dev
```

Open http://127.0.0.1:3000. Do not overwrite an existing configured
`.env`; copy the example only for initial setup. Never commit or paste
credentials into chat. Restart after configuration changes.

  -----------------------------------------------------------------------
  Variable                            Meaning
  ----------------------------------- -----------------------------------
  `FIREFLY_BASE_URL`                  Instance root, without `/api` or
                                      `/api/v1`; path prefixes are
                                      supported.

  `FIREFLY_API_TOKEN`                 Personal access token used only by
                                      the server.
  -----------------------------------------------------------------------

Use the existing HTTPS URL for remote connections. An existing shared
private Docker network can use HTTP with Firefly's service DNS name and
internal port. URL credentials, query strings and fragments are
rejected. TLS verification stays enabled. Never use public-network HTTP.

## Security and production installation

Ember runs beside an existing Firefly III installation and reads its official
REST API. Do not change Firefly's database, importer or Docker configuration.
Both supported production modes require HTTPS. Production LAN HTTP is not
implemented. Local development HTTP is documented separately in the README.

### Prerequisites and configuration

Use a maintained Docker Engine (28 or newer) and Docker Compose plugin
2.24.4 or newer on a Linux host. Keep the host clock synchronized for TOTP.
Obtain the Ember source from this project's release/repository and run commands
from that directory. Do not deploy Windows `.next` or `node_modules` artifacts.

In Firefly III, create a Personal Access Token under your profile's OAuth/personal
token settings. Store it only in Ember's private environment file. Ember uses GET
requests only, but the token itself may permit writes: protect it accordingly.
Use a URL reachable from the Ember container, without `/api/v1`.
`localhost` inside that container refers to Ember itself. Use remote HTTPS or an
existing private Docker network; do not alter Firefly's stack to deploy Ember.

For a **fresh installation**:

```sh
umask 077
cp -n .env.example .env
chmod 600 .env
docker build --pull -t ember-finance:0.1.0-rc.1 .
docker run --rm -it --entrypoint node ember-finance:0.1.0-rc.1 scripts/auth-config.mjs password
docker run --rm --entrypoint node ember-finance:0.1.0-rc.1 scripts/auth-config.mjs secret
```

The password generator prompts twice without echoing the password and emits a
bcrypt hash. Use at least 12 characters and at most 72 UTF-8 bytes. Copy the
generated lines into `.env` locally, keeping the hash single-quoted so `$`
remains literal. Never put passwords in command arguments or share generator
output. Existing installations must retain their existing auth secret and state;
follow [migration](docs/deployment-migration.md) before starting the renamed service.

Configure these required values:

| Variable | Value |
| --- | --- |
| `FIREFLY_BASE_URL` | Firefly instance root, such as `https://firefly.example.com` |
| `FIREFLY_API_TOKEN` | Your private Personal Access Token |
| `EMBER_APP_URL` | Exact browser HTTPS origin, such as `https://finance.example.com` |
| `EMBER_AUTH_USERNAME` | Your chosen single-user login name |
| `EMBER_AUTH_PASSWORD_HASH` | Generated bcrypt hash, cost 12–14 |
| `EMBER_AUTH_SECRET` | Generated random 32-byte base64url secret |

Serve Ember at the hostname root. Do not include a trailing slash, path, query,
fragment or credentials in `EMBER_APP_URL`. Credentials remain server-side.
Never commit `.env`, publish rendered Compose configuration, or use the example
domains as actual deployment addresses.

### Mode A: bundled HTTPS, no existing proxy

Use your own public DNS hostname. Its A record must resolve to the host's public
IPv4 address; publish an AAAA record only if IPv6 also reaches this host. Forward
TCP ports 80 and 443 through the router/firewall to this host, and ensure no other
service owns those ports. DNS must resolve correctly for certificate issuance.
CGNAT, blocked challenge ports or an arbitrary LAN IP will not work with this
mode. Use mode B with a suitable HTTPS edge in those environments.

Set `EMBER_APP_URL=https://your-actual-hostname` and leave
`EMBER_HTTPS_BIND_ADDRESS=0.0.0.0`, or use a specific host address. Caddy obtains
and renews publicly trusted certificates. Ember's raw HTTP port is removed from
host publication; only the HTTPS companion reaches it over the Compose network.
The companion receives the public origin, never Firefly or authentication secrets.

```sh
docker compose -f compose.yaml -f compose.https.yaml config --quiet
docker compose -f compose.yaml -f compose.https.yaml up --no-build -d --wait --wait-timeout 120
docker compose -f compose.yaml -f compose.https.yaml ps
docker compose -f compose.yaml -f compose.https.yaml exec -T ember node scripts/healthcheck.mjs
curl --fail https://your-actual-hostname/api/health
```

Expect `{"status":"ok"}`. Check the certificate in a normal browser without
certificate exceptions. HTTP requests redirect to HTTPS; never send passwords
over HTTP. Caddy's container health check only confirms its local configuration
endpoint, **not** certificate issuance or public reachability. If HTTPS fails,
check DNS/IPv6, port forwarding and bounded `ember-https` logs locally. Logs can
contain hostnames/request paths; redact them before sharing. Never disable TLS
verification to make installation pass.

Always retain both `-f` flags for subsequent commands. TLS material persists in
`ember-tls-data` and `ember-tls-config` volumes; auth state persists separately.
This mode has been checked with the real Compose parser and native Caddy;
Linux Docker runtime and public ACME acceptance remain required on the target.

### Mode B: existing HTTPS reverse proxy

The base file retains the existing configuration:

```sh
docker compose config --quiet
docker compose up --no-build -d --wait --wait-timeout 120
docker compose exec -T ember node scripts/healthcheck.mjs
```

Set `EMBER_APP_URL` to the origin actually opened in the browser. With a
host-native proxy, keep `EMBER_BIND_ADDRESS=127.0.0.1` and `EMBER_PORT=3000`,
and proxy to `http://127.0.0.1:3000`. A proxy in another container cannot reach
the host through its own localhost; attach Ember using an appropriate private
network override and use `http://ember:3000`. A remote proxy requires a private
host binding and Docker-aware firewall rules allowing only that proxy. Binding
to a private IP alone is not an allowlist; ordinary UFW rules may not filter
Docker-published traffic. Check IPv4 and IPv6/direct access from another host.

Terminate trusted TLS at the proxy. Preserve Host, Origin, cookies, query strings,
Next routing headers and streaming responses. Replace untrusted forwarded
host/protocol headers; never cache financial/authentication HTML or RSC responses,
rewrite cookies, strip Origin or remove Secure. Only versioned static assets
may retain their normal caching. Protect the raw Ember port from internet access.
If proxy DNS previously used `bloom`, change its upstream to `ember:3000` during
the documented migration. Existing host/port proxy routes remain compatible.

### First login and optional 2FA

Open the configured HTTPS origin and sign in with your username and password.
In the sidebar profile control, choose **Beveiliging → 2FA instellen**. Scan the
QR code or enter the manual key in Google Authenticator/a compatible authenticator,
then confirm a six-digit code. Activation signs all devices out. Subsequent
password login requires a TOTP challenge before any financial routes become
available. TOTP is optional before enrollment and mandatory afterwards; a
consumed time step cannot be reused. Keep your authenticator securely backed up.

Production uses Secure, HttpOnly, host-only `__Host-` cookies and exact-origin
checks. Sessions expire after eight hours; logout revokes them server-side.
Temporary sessions are lost when the container is recreated. The enrolled seed,
replay protection and security generation are encrypted in persistent auth state.
One Ember process/container is supported; do not scale replicas.

### Updates, backups and recovery

Keep the directory/Compose project identity and **all chosen `-f` flags** stable.
Preserve `.env`, especially `EMBER_AUTH_SECRET`, and the `ember-auth-state` volume.
After obtaining the new source/release, for bundled HTTPS run:

```sh
docker compose -f compose.yaml -f compose.https.yaml build --pull ember
docker compose -f compose.yaml -f compose.https.yaml pull ember-https
docker compose -f compose.yaml -f compose.https.yaml up -d --wait --wait-timeout 120
docker compose -f compose.yaml -f compose.https.yaml exec -T ember node scripts/healthcheck.mjs
```

For mode B omit `-f compose.https.yaml` and the `pull ember-https` command.
Migrated installations must also keep `-f compose.auth-state.yaml` and their
verified volume pin. Never use `down -v` as an update/removal procedure.
Changing environment requires `up -d --force-recreate --wait`; restart alone
does not reload `.env`. Do not casually rotate the auth secret with enrolled
TOTP: the old encrypted state requires the old secret. Restore both together,
or deliberately follow the host-admin reset procedure.

Back up private `.env` and the verified auth-state volume together, with access
restricted to the host administrator. Stop Ember while copying state for a
consistent backup; use a host/volume backup tool or the tar example in
[migration](docs/deployment-migration.md). Also protect the TLS volumes if retaining
certificate state. Rehearse restoration to an isolated deployment. Missing auth
state removes enrolled 2FA protection and is a security event, not an ordinary
update. Firefly's own backups remain independent.

For a lost authenticator, **host administrator only**, stop Ember, reset its
encrypted state with the packaged command, and recreate it. Bundled HTTPS:

```sh
docker compose -f compose.yaml -f compose.https.yaml stop ember
docker compose -f compose.yaml -f compose.https.yaml run --rm --no-deps ember node scripts/totp-admin.mjs reset
docker compose -f compose.yaml -f compose.https.yaml up -d --wait --wait-timeout 120
```

For mode B omit the HTTPS file; preserve the migration override when used.
Verify the next password login succeeds and enroll a new authenticator promptly.
There is no email reset or browser-exported recovery code. Do not delete the
volume, change ownership arbitrarily, or log/share encrypted state or secrets.

Health is independent of Firefly and reveals only liveness. Unhealthy status
does not automatically restart a running container; the restart policy handles
exited processes. Monitor public HTTPS and upstream connectivity separately.
See [production security](docs/production-security.md) for target-host acceptance.


## Pages and API behavior

-   **Overview:** active-account shortcut, shared selected-month
    budget/bill/cash-flow summaries and latest five transaction groups.
    Month selection defaults to the current Amsterdam month. The recent
    transaction list stays a latest-activity list; account information
    remains current. Each API feature handles its own failure.
-   **Accounts:** `GET /api/v1/accounts?type=asset&page=N&limit=50`, all
    asset accounts including labelled inactive accounts. 100-page cap;
    15-second overall retrieval timeout. Amounts remain decimal strings.
-   **Transactions:**
    `GET /api/v1/transactions?page=N&limit=25&start=YYYY-MM-DD&end=YYYY-MM-DD`.
    Defaults to the current month in Europe/Amsterdam. Shared month
    navigation with Budgets; month changes reset pagination.
    Previous/next pages retain the month. API date boundaries are
    inclusive. Only one page is fetched, never the full history.
    Searching submits `q` to Ember and uses
    `GET /api/v1/search/transactions?query=...&page=N&limit=100` with
    inclusive `date_after`/`date_before` month bounds and an optional
    authoritative `transaction_type` filter. Exact Dutch type terms
    (`uitgave`/`uitgaven`, `inkomen`/`inkomsten`,
    `overschrijving`/`overschrijvingen`, `saldocorrectie`, `beginsaldo`)
    select Firefly's type independently of descriptions and amount signs.
    Other searches match full descriptions, visible split titles, source
    and destination accounts, categories, budgets, Dutch type labels,
    displayed dates and amounts across the entire selected month.
    Text matching ignores case and normalizes whitespace without changing
    stored text. Dates use the table's Dutch calendar date (`28-09-2026`).
    Amounts match the complete displayed Dutch number (`57,90`,
    `1.234,56`), optionally with its displayed sign or full currency
    label. Unsigned numbers also match expenses; `57,90` does not match
    `157,90`. No rounding or floating-point financial comparisons are
    introduced, and currencies remain distinct.
    Firefly 6.7.5 supports individual field operators but no combined OR
    across the required table fields. Arbitrary text therefore never
    enters Firefly's query language: Ember matches it server-side after
    reading all bounded result pages for this month. Retrieval has one
    shared 15-second deadline, at most 100 API pages and 10,000 returned
    journal rows. Oversized months, failed later pages and detected
    inconsistent responses never show partial search results. No
    full-history download, browser dataset or persistent financial cache
    is used. Search text retains the existing 200-character limit and
    rejection of backslashes/control characters.
    Changing/submitting/clearing search resets pagination; paging
    preserves `month`/`q`, month changes preserve `q`. Clearing restores
    normal monthly fetching. Filtered results sort by newest calendar
    date, then descending journal ID, and paginate in sets of 25 matching
    rows. Their count represents matching journals, including individual
    split entries; unfiltered pagination still uses Firefly's own count.
    Split groups spanning API pages retain their split marker, IDs,
    amounts and metadata; only matching siblings are displayed.
    Identical upstream journal overlaps are deduplicated; conflicting
    contents fail safely. Transfers stay distinct from income/expenses.
    Each page request reads fresh data; concurrent Firefly edits can
    change results because the API provides no snapshot spanning reads.
    Overview's recent list remains an unfiltered latest-five-group
    request. Unfiltered requests retain their existing 15-second timeout.
-   **Budgets:** `GET /api/v1/budgets` and
    `GET /api/v1/budgets/{id}/limits`, with monthly `start`/`end` and
    pagination. Spending is Firefly's authoritative monthly value.
    Remaining and percentage are derived with exact integer-scaled
    decimal arithmetic only for one matching calendar-month
    limit/currency. Close means 80--100%; over means above 100%. Zero
    limits have no percentage. Missing spending is not invented as zero;
    overlapping/non-monthly limits are shown with their dates, without
    prorating. No currency aggregation. Retrieval has a 20-second
    timeout, 100-page cap and at most four concurrent budget-limit
    fetches.
-   **Subscriptions:** reads both `GET /api/v1/bills` and
    `GET /api/v1/recurrences`, separately. Both use pagination, 50
    records/page, a 100-page cap and a 15-second retrieval timeout per
    model. Bills are Firefly's subscription records: amount ranges,
    frequency/skip, active state, notes, end dates and
    `next_expected_match`. Bills requests include today through today +
    90 days for Firefly-generated `pay_dates`; these are a fallback only
    when the next-match field is absent. Recurrences are separate
    transaction-generation templates, with expense/income/transfer
    types, individual entry amounts, accounts/categories and supplied
    repetition descriptions/occurrences. Notes are escaped plain text.
    No schedules are generated locally, and missing data stays
    unavailable.
-   **Reports:** monthly navigation, income/expenses/net per currency,
    previous-month net comparison, ranked expense/income categories and
    spending by budget, using these GET endpoints:
    `/api/v1/insight/income/total`, `/api/v1/insight/expense/total`,
    `/api/v1/insight/income/category`,
    `/api/v1/insight/expense/category`,
    `/api/v1/insight/income/no-category`,
    `/api/v1/insight/expense/no-category`,
    `/api/v1/insight/expense/budget`,
    `/api/v1/insight/expense/no-budget`. Each uses inclusive monthly
    `start`/`end`. Ten concurrent date-filtered aggregate reads per
    Reports render (eight selected-month endpoints plus two
    previous-month totals), with a 15-second deadline per request.
    Overview reads only two totals. Render-local promise reuse avoids
    duplicate reads; no persistent cache. No whole-history transaction
    download or local reconstruction of Firefly accounting. Firefly's
    withdrawal/deposit summaries count split journals once and exclude
    transfers, opening balances and reconciliations. Ember normalizes
    expense signs, subtracts income minus expenses and compares net
    figures using exact decimal arithmetic. CSS bars show relative sizes
    within a currency, without a chart library. Failed endpoints remain
    unavailable independently. Successful empty aggregates mean no
    recorded activity. Currencies are never merged; Firefly's own
    primary-currency preference can affect its returned figures. Insight
    responses lack currency scale metadata; amounts retain every
    significant decimal digit. Whole-month comparisons do not prorate
    incomplete months. Separate API reads are not an atomic snapshot.

**Category/budget drill-downs:** click a transaction's category or
budget to open `/categories/{id}` or `/budgets/{id}` with the selected
`month`. Identity comes from Firefly IDs, never names. The shared month
selector and transaction pagination retain that identity. Category
totals come from `GET /api/v1/categories/{id}?start=...&end=...`
(`spent`, `earned`, `transferred`); budget details use
`GET /api/v1/budgets/{id}` and the existing monthly
limits/remaining/percentage logic. Transactions use
`GET /api/v1/{categories|budgets}/{id}/transactions` with monthly bounds
and pagination. Totals never come from summing the visible table.
Transfers and currencies stay separate, and unavailable values stay
unavailable. A failed detail summary does not hide a successfully
retrieved transaction list.

**Monthly Overview bills:** `GET /api/v1/bills?start=...&end=...`
supplies `paid_dates` (matched journals) and `pay_dates` (Firefly's
generated schedule, which can retain already-matched payment dates).
Ember bounds these to the selected month; it never derives paid state
from elapsed dates or repeats Firefly's matching/schedule logic.
`GET /api/v1/summary/basic?start=...&end=...` supplies `bills-paid-in-*`
and `bills-unpaid-in-*` monetary strings per currency. Paid totals and
estimates concern active bills. Firefly calculates unpaid estimates
using average bill ranges, so Ember explicitly labels them **raming
Firefly**, not an exact outstanding total. The compact upcoming list
displays the supplied fixed amount or min/max range. Missing amounts are
not zero. The successfully parsed monthly summary alone determines
completion: no unpaid entry or only zero unpaid estimates means "Niets
meer te verwachten". Scheduled dates never override this result.
Completed or unavailable summaries hide the schedule list;
failed/invalid summaries show unavailable status, while paid amounts and
matching data remain independently available. When Firefly reports an
outstanding estimate, the list is labelled as scheduled dates that may
already be matched, not individual unpaid obligations. The full
Abonnementen page retains its separate bill/template models and 90-day
upcoming-date behavior. No currency merging, independent
remaining-fixed-costs calculation, or recurrence-template accounting is
added. Bills do not expose a transaction direction or associated
account/category in this contract. Recurring templates may overlap with
bills and are therefore never combined into one monetary total. No
future date is invented for inactive, expired, or missing schedules;
recurring occurrence dates already covered by `latest_date` are
excluded.

## Verified contracts

Installed Firefly III version: **6.7.5**, verified through
`GET /api/v1/about` during development. Its [official documentation
branch](https://github.com/firefly-iii/api-docs/tree/v6.7.5) publishes
[the v6.7.4 OpenAPI
file](https://raw.githubusercontent.com/firefly-iii/api-docs/v6.7.5/dist/firefly-iii-v6.7.4-v1.yaml)
as its latest versioned schema, with no separate v6.7.5 file.
Subscription fields were also checked against the installed release's
[BillTransformer](https://github.com/firefly-iii/firefly-iii/blob/v6.7.5/app/Transformers/BillTransformer.php)
and
[RecurrenceTransformer](https://github.com/firefly-iii/firefly-iii/blob/v6.7.5/app/Transformers/RecurrenceTransformer.php),
and live response field shapes. Earlier account/budget/transaction work
also used the official [v6.7.6
specification](https://raw.githubusercontent.com/firefly-iii/api-docs/v6.7.6/dist/firefly-iii-v6.7.6-v1.yaml).

Reports were checked against that v6.7.5 documentation branch, live
responses and release source: [expense
totals](https://github.com/firefly-iii/firefly-iii/blob/v6.7.5/app/Api/V1/Controllers/Insight/Expense/PeriodController.php),
[income
totals](https://github.com/firefly-iii/firefly-iii/blob/v6.7.5/app/Api/V1/Controllers/Insight/Income/PeriodController.php),
[expense
categories](https://github.com/firefly-iii/firefly-iii/blob/v6.7.5/app/Api/V1/Controllers/Insight/Expense/CategoryController.php)
and [budget
spending](https://github.com/firefly-iii/firefly-iii/blob/v6.7.5/app/Api/V1/Controllers/Insight/Expense/BudgetController.php).

## Dutch interface and presentation

The interface is Dutch (`nl-NL`): Overzicht, Transacties, Budgetten,
Rekeningen, Abonnementen and Rapporten. User-created Firefly names,
categories, descriptions and notes are never translated or rewritten.
Supplied recurrence schedule descriptions remain in Firefly's source
language.

-   Centralized formatters display amounts such as `€ 4.396,41`, dates
    such as `28-09-2026` or `28 september 2026`, and months such as
    `september 2026`. Currency symbols/scale follow supplied metadata or
    Intl defaults. Decimal strings retain all significant digits,
    including beyond the usual currency scale; there is no financial
    Number conversion or rounding. Missing currencies remain explicitly
    unknown.
-   Reports preserve the existing calculations. Income and budget cards
    stack beside longer expense lists, comparisons use concise
    higher/lower/equal wording, and technical context sits in an
    expandable section. Fully empty months show one empty state; partial
    failures still preserve other report sections.
-   Long transaction descriptions show an original-text preview with an
    accessible full-description disclosure. There is no heuristic SEPA
    rewriting. Whole-month table search includes the complete original
    text.
-   Subscriptions sort by supplied active next date. Undated/inactive
    records follow without changing their data. An empty
    recurring-template list is a compact line; the two Firefly models
    remain separate.
-   Responsive navigation, consistent tables and focus states preserve
    the dark Ember identity. Wide tables scroll within their container
    with a visible hint and keyboard access. Native month inputs may use
    the browser/OS language internally; displayed headings and dates are
    consistently Dutch.

All existing Firefly clients, exact calculations, aggregate semantics,
periods and authentication were preserved. Milestone 3A added no
dependencies, writes, persistent cache or infrastructure changes.

## Validation and remaining work

The deployment/branding hardening update passed **96 unit tests**, lint,
TypeScript, production build, real Compose/Caddy configuration parsing,
production HTTP smoke, and isolated standalone HTTPS/browser checks. Native
Caddy tests cover HTTP redirects, Secure cookies and origin checks, TOTP
enrollment/challenge/logout, encrypted enrollment/replay state through fresh
process/temp-storage recreation, certificate persistence and admin reset.
Existing UI/auth/financial/search source and dependency versions are unchanged.
The real Linux Docker build/recreation and public ACME issuance were not run
on this host; perform target acceptance before public release.

For deployment checks, install Docker Compose and Caddy locally and set
`EMBER_COMPOSE_BINARY` and `EMBER_CADDY_BINARY` to their executables, then run
`pnpm test:deployment` after `pnpm build`. These tests use synthetic loopback
data and an isolated test CA, never install host trust or contact live Firefly.
To run the existing standalone/browser suite through real Caddy, also set
`EMBER_TEST_CADDY_BINARY` and the browser settings described below, then run
`pnpm test:standalone`. Its browser context accepts only its isolated test
certificate for QA; production still requires normal trusted HTTPS. The
configuration validator is also available as `node tests/compose-check.mjs`.
Use the supported modes and migration procedure above for actual installation.

The following results retain earlier milestone history:

Milestone **3C** passed **76 unit tests**, lint, TypeScript, production
build, HTTP smoke and isolated standalone HTTPS/browser checks. New
category/budget routes passed anonymous-access protection checks.
Browser coverage includes whole-month search from normal page 2,
reset/clear, month-preserving links, detail pagination, desktop/mobile
layouts, completed bills and independent failure states. Live GET-only
checks recovered a page-2 transaction through search and reconciled
category/budget spending and monthly bill summaries against Firefly.
Existing live page/browser and credential-exclusion checks also passed.

To repeat the optional live API reconciliation after
building/configuring the application:

``` sh
node --env-file=.env --conditions=react-server tests/live-navigation.mjs
```

No live financial records or credentials are printed. Docker remains
unavailable on the development machine, so the 3C Linux image was not
built/run here. Retain working credentials, auth state and network settings
while following the current deployment/migration instructions above.
Detailed API sources, decisions and limitations
are in [PROJECT_STATUS.md](PROJECT_STATUS.md). The results below also
retain historical milestone validation records.

``` powershell
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm test:smoke
pnpm test:standalone
pnpm start
```

52 tests, lint, TypeScript, production build, HTTP smoke checks and
responsive browser checks passed for Milestone 3A. The smoke test runs
synthetic local APIs and shuts them down afterward; it does not contact
your Firefly instance. Browser checks covered monthly navigation,
pagination, filtering, notes escaping, responsive tables and budget
regression behavior. Live subscription and month-filtered transaction
parsing passed. The live recurrence endpoint returned an empty list;
populated recurrence handling is covered by synthetic tests. Live
Reports returned all sections successfully; current-month category and
budget breakdowns reconciled with Firefly totals. Previous-month totals
parsed successfully. Checks did not print financial records or tokens.
Report tests cover precision, currency separation, empty months, missing
categories, errors, date bounds, render-local request reuse and
consuming Firefly's split-aware, transfer-excluding aggregates without
resumming groups.

Localization tests cover EUR, USD, JPY, KWD/custom currency precision,
Dutch dates/months, signs, percentages, comparison wording, long Unicode
descriptions, subscription sorting and unchanged source data. Browser
checks covered all six primary pages at 390, 820, 1440 and 1920 pixels,
including month navigation, pagination, full-description search,
keyboard disclosure/scrolling, empty templates and isolated report
failures. All six localized production pages also passed a GET-only live
check; no financial records or credentials were logged. This is browser
emulation, not a physical-device or exhaustive screen-reader
certification.

The optional browser suite reuses the synthetic smoke server without
adding an application dependency. With an already available Playwright
module/browser, set `EMBER_BROWSER_MODULE` to its importable name or
absolute `file:///.../index.mjs` URL, optionally set
`EMBER_BROWSER_CHANNEL` (for example `msedge`), then run
`pnpm test:smoke`. Set `EMBER_SCREENSHOT_DIR` to choose an output
directory; otherwise synthetic screenshots go to the operating-system
temporary directory under `ember-3a-review`.

Milestone 3B adds four security tests: **56 tests pass**, as do lint,
TypeScript, production build, HTTP smoke and isolated standalone/browser
checks. `test:standalone` stages the local build without environment
files, relocates Windows dependency junctions inside that artifact, and
exercises the real container entrypoint/health script on the host. It
accepts the same optional browser settings above. This is not a
substitute for building/running the Linux container. Docker/WSL are
unavailable here; image build/contents, Compose
health/restarts/read-only filesystem and target network acceptance were
not validated on this development machine. The user subsequently
reported successful Ubuntu deployment after the packaging fix. External
proxy authentication is not required.

An opt-in live GET-only check is available with
`node --env-file=.env tests/live-smoke.mjs` after building. It checks
all six local production pages and scans output for the configured token
without printing financial records; the optional browser settings also
enable desktop/mobile live checks. It passed during 3B. The check now
signs into an isolated test process with ephemeral synthetic Ember
credentials, while using the configured Firefly token only for
server-side GET reads. It does not change your `.env` or admin
credentials. Do not deploy local `.next` output containing traced
environment files.

Milestone **3B.1** passes 61 unit tests, lint, TypeScript, production
build, authenticated HTTP and standalone tests. The bypass audit covers
all six routes, RSC, spoofed middleware/forwarded headers, API prefixes,
encoded paths, invalid/expired/unregistered sessions and replay after
logout. Anonymous requests make no Firefly calls. Browser tests cover
all pages at 390/820/1440/1920px and native Dutch login/logout over an
HTTPS test proxy which does no authentication. The tested header policy
prevents cross-site referrer disclosure while supporting strict
same-origin auth forms. Production dependency audit reported no known
vulnerabilities at validation time. No financial clients or calculation
helpers changed; live authenticated GET-only regressions also passed.

To reproduce HTTPS form checks, set `EMBER_TEST_TLS_CERT` and
`EMBER_TEST_TLS_KEY` to an existing temporary self-signed **test-only**
PEM certificate/key for localhost (outside the repository), plus the
browser-module/channel settings above, then run `pnpm test:standalone`.
The harness starts a loopback TLS proxy and accepts that test
certificate in its browser only; production TLS verification is never
disabled. Without these variables the ordinary HTTP/route audit still
runs, but HTTPS form browser checks are explicitly skipped. Never use
the production TLS private key for local testing.

### Final-image credential generator regression check

On an Ubuntu development/CI host with Docker and Python 3, after
building the **normal final image**:

``` sh
python3 tests/docker-auth-smoke.py ember-finance:0.1.0-rc.1
```

This optional automated test runs both documented generator commands
inside that image, supplies synthetic passwords through a real terminal,
checks that input is hidden, verifies the resulting bcrypt hash and
fresh secrets, checks non-root execution and rejects non-interactive
passwords. It uses no environment file, host dependency/script mounts,
network access or separate dependencies image; temporary test containers
are removed. It never prints generated credentials. Python is only
needed for this test harness, not installation. The image build itself
also runs a CLI resolution check, while unit/standalone tests cover
isolated generator packaging on the development host. For this
deployment fix, all **62 unit tests**, lint, TypeScript, production
build, HTTP smoke and isolated standalone checks passed, including HTTPS
login/logout and responsive browser regressions. The Docker terminal
harness passed a syntax check but could not run here because Docker is
unavailable; run it on the Ubuntu host against the rebuilt image. Do not
rotate existing working credentials merely to install this packaging
fix.

Complete [deployment
acceptance](docs/production-security.md#deployment-acceptance-must-be-performed-on-the-target)
on Ubuntu before exposing this **v0.1 release candidate**. Editing,
category management, savings goals, PWA and additional dashboard
features remain future work. Selected writes require explicit Milestone
4 approval. ESLint 9 remains pinned to match the current Next.js plugin
compatibility range.
