# NetBridge

NetBridge manages an owner's gateways and approved phones for remote access to
their home or office internet gateway.

The MVP management backend includes account registration, login/logout,
gateway pairing and heartbeats, device approval/revocation, and connection-session
records. It uses NestJS, Prisma, and PostgreSQL. Routes are versioned under `/v1`;
interactive OpenAPI documentation is available at `/docs`.

The web workspace in `apps/web` provides account registration and sign-in, an
overview dashboard, gateway pairing tokens, device approval/revocation, and
connection-session history. It uses the real API through a same-origin server
proxy, so browser requests do not require broad CORS permissions. There is no
demo data. Authentication is kept in per-tab session storage and cleared by logout.

## Frontend

With the API running, open a second terminal:

```powershell
npm.cmd run web:dev
```

Open `http://127.0.0.1:5173`. The web server proxies `/v1` to
`http://127.0.0.1:3000`; set `API_URL` to another trusted API origin if needed.
Set `WEB_PORT` or `WEB_HOST` to change the frontend listener. Register your own
account to begin. Pairing tokens must be transferred privately to your gateway
agent; the frontend does not impersonate an agent or establish a traffic tunnel.

For a production build, run `npm run web:build` followed by `npm run web:start`.
`docker compose up --build -d` builds and starts PostgreSQL, migrations, the API,
and the web UI. The `web` Docker target runs the frontend as a non-root user at
port 5173 and proxies requests to the API over the private Compose network.

Frontend checks:

```powershell
npm.cmd run web:test
npm.cmd run test:e2e
```

The browser test uses disposable embedded PostgreSQL and a separate API process.
Set `NETBRIDGE_TEST_DATABASE_URL` to test with real PostgreSQL instead (as CI does);
the test creates and removes its own randomly named schema, keeping existing data
untouched. On memory-constrained machines, prefer real PostgreSQL. On Windows it uses installed Edge
(override `PLAYWRIGHT_CHANNEL` with `chrome` if preferred). On Linux, run
`npx playwright install --with-deps chromium` first. The test exercises account
creation, gateway pairing through the agent API, device approval/revocation,
session history, logout/login, session restoration, and mobile navigation.
The test uses a one-connection pool to match the embedded engine. Normal API
instances default to ten connections; set `DATABASE_POOL_MAX` (1–100) to tune this
for your deployment.

Connection records track management state. They do not establish tunnels or
prove traffic is flowing. Native Android/Linux tunnel clients, first-party relay infrastructure,
payments, email verification, and password recovery are outside this MVP.
Validate a real Android-to-Linux connection before committing to a relay design.

## Local development

Requirements: Node.js 20.19+, 22.12+, or 24+ (Prisma-supported versions), npm,
and Docker Desktop with Compose. Node.js 24 is used by the container and CI.

```powershell
Copy-Item .env.example .env
npm.cmd install
npm.cmd run db:generate
docker compose up -d postgres
npm.cmd run db:deploy
npm.cmd run start:dev
```

The API defaults to `127.0.0.1:3000` and PostgreSQL to `localhost:5432`.
Set `HOST`, `PORT`, and `DATABASE_URL` in `.env` as needed. Use a dedicated
database for NetBridge. The example database password is for local use only.
Use `npm.cmd` when PowerShell execution policy blocks `npm.ps1`.

```powershell
Invoke-RestMethod http://127.0.0.1:3000/v1/health
Invoke-RestMethod http://127.0.0.1:3000/v1/health/ready
```

Liveness checks the API; readiness queries PostgreSQL. PostgreSQL is required
during startup. After startup, a database outage returns HTTP 503 on readiness
while liveness remains HTTP 200. Connection and query timeouts are bounded.
Stop the API with `Ctrl+C`; `docker compose down` retains database data.

## Verification

```powershell
npm.cmd test
npm.cmd run db:validate
npm.cmd run verify:deployment
```

Tests build the API, compile tests, and run Node's test runner. Builds regenerate
Prisma. Health tests use a database stub. Management integration tests apply the
committed migration to disposable in-memory PostgreSQL (PGlite), then exercise
HTTP routes through Prisma and the PostgreSQL wire protocol. Tests never modify
your configured database. PGlite is single-connection; deployment testing must
also cover multi-connection PostgreSQL concurrency and infrastructure failures.

To run the same suite against PostgreSQL, set `NETBRIDGE_TEST_DATABASE_URL` to a
test database URL, then run `npm test`. The test account must be allowed to create
schemas. Tests create a random `netbridge_test_*` schema, run `prisma migrate deploy`
twice to verify migration idempotence, exercise concurrent pairing/session/revocation
requests, and remove only that generated schema afterward. Existing application
schemas are left untouched. CI runs both embedded and PostgreSQL 17 test modes.

`npm run verify:deployment` starts the compiled API as a separate process against
a disposable embedded PostgreSQL instance and isolated schema. It verifies
startup, account persistence, readiness failure during a database outage,
liveness during that outage, and recovery after the database returns. It checks
process termination on Windows; graceful SIGTERM handling still requires Linux
or container verification. This check applies the SQL migration directly; the
real PostgreSQL suite verifies Prisma CLI migration deployment and idempotence.

`npm run db:deploy` applies committed migrations to the configured database.
Use `npm run db:migrate` when changing models and commit the migration. Preserve
the initial migration's partial unique index (one active record per device) and
session-end consistency constraint in future migrations.

See [API usage and lifecycle](docs/api.md) for endpoints and an example.

## Deployment

Run the complete local stack with `docker compose up --build -d`. PostgreSQL must
be healthy before the migration container runs; the API starts only after
migrations succeed. Use `docker compose ps` and `docker compose logs api migrate`
to inspect startup. The API image runs as an unprivileged user, handles termination
signals through Compose's init process, and checks database readiness for health.
The build context excludes `.env`, generated files, and local dependencies.

The `migrate` Docker target contains the Prisma CLI; the `runtime` target contains
the compiled API and production dependencies. CI builds both images. These local
Compose defaults are intended for development; replace database credentials and
put HTTPS in front of the API for a shared deployment.

Build with development dependencies installed (`npm run build`), apply migrations,
then run `npm start` from the repository root. Set `NODE_ENV=production`, a private
`DATABASE_URL`, and `HOST=0.0.0.0` behind a container or reverse proxy. Termination
signals close database connections. Serve the API over HTTPS.

User tokens expire after 24 hours; logout revokes the current token. Gateway
credentials last until gateway revocation. Passwords use salted scrypt hashes;
bearer/pairing/gateway tokens are stored as SHA-256 hashes. Keep tokens out of URLs
and logs. API responses use `Cache-Control: no-store`; request logs omit bodies
and authorization headers.
Each request receives an `X-Request-Id`; completion logs include final HTTP status
for authentication rejections and unknown routes as well as handled requests.
Unknown paths are redacted and known routes use templates to avoid logging IDs or
query values. Disconnected requests are recorded with status 499.

Registration, login, and pairing share a per-IP limit of 20 attempts per minute
per process. Use a shared edge limiter for multiple replicas. Forwarded IP headers
are not trusted by default; configure trusted proxy boundaries at deployment.

Lists use cursor pagination (default 50, maximum 100). Revoked resources and ended
records remain available for history. Establish database backups and retention.
Periodically remove expired authentication sessions; login also removes the
account's expired sessions.

## Installable app: local trial

Run `npm run app:dev` to build the API and start the full app with embedded
PostgreSQL, without Docker. Open http://127.0.0.1:5173 in Edge or Chrome and use
**Install NetBridge** when offered, or the browser menu's app installation action.
The app opens in its own window. Stop the local stack with Ctrl+C.
This local trial stores its database in `.local/postgres`, separate from the
configured PostgreSQL database and automated test output. Create a new account
when using this database for the first time. Names and contact details persist
between restarts. Keep the local stack running while using the installed app.

The interface can reopen offline; account actions and network management need
the API online. API responses and account data are never cached by the service
worker. Phone installation requires a reachable HTTPS deployment; localhost on
your phone refers to the phone itself. This trial adds an installable management
app; it does not add VPN tunneling or a native Android tunnel client.

## Home PC gateway and Windows remote access

See [Windows home-network trial](docs/windows-connection.md) for gateway agent pairing,
Tailscale exit-node setup, remote connection, verification, and disconnect steps.
The gateway agent is included; Tailscale supplies the VPN separately.
