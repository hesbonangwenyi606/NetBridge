# Management API

Base URL: `http://127.0.0.1:3000/v1`. Interactive OpenAPI: `/docs`.
JSON bodies reject unknown fields. Emails are trimmed and lowercased; passwords
must contain 12–128 characters. Names are trimmed and require 1–80 characters.
Resource IDs must be UUIDs.

## Accounts

| Method | Path | Access | Result |
| --- | --- | --- | --- |
| POST | `/auth/register` | Public, rate limited | 201: public account; duplicate email returns 409 |
| POST | `/auth/login` | Public, rate limited | 200: `accessToken`, `tokenType`, `expiresAt` |
| GET | `/auth/me` | Account bearer token | 200: `id`, `email`, `createdAt` |
| POST | `/auth/logout` | Account bearer token | 204: current token revoked |

Register/login body: `{ "email": "owner@example.com", "password": "a long unique password" }`.
Registration also accepts optional `firstName`, `lastName` (1?80 characters each),
and `contact` (7?30 characters using digits, spaces, +, parentheses, dots, or hyphens).
These profile fields are returned with the public account and `/auth/me`.
The web form collects a full name, contact number, and matching password confirmation,
then returns to sign-in with the email prefilled.
Registration does not log you in. Send `Authorization: Bearer <accessToken>`
on protected routes. Tokens expire after 24 hours; log in again to renew.
Logout affects only the current session.

`GET /dashboard` requires an account bearer token and returns account-wide counts:
`pairedGateways`, `approvedDevices`, `activeConnections`, and `pendingDevices`.
These counts are independent of resource-list pagination.

## Gateways

All `/gateways` routes require an account bearer token and enforce ownership.
Another owner's resource ID returns 404.

| Method | Path | Result |
| --- | --- | --- |
| POST | `/gateways` | 201: pending gateway and `pairingToken`, `pairingExpiresAt` |
| GET | `/gateways` | 200: paginated owned gateways |
| GET | `/gateways/:id` | 200: gateway metadata |
| POST | `/gateways/:id/pairing-token` | 200: replace pending gateway's pairing token |
| POST | `/gateways/:id/revoke` | 200: revoke gateway and end its active records |
| POST | `/gateway-agent/pair` | Public, rate limited; 200: paired gateway and `gatewayToken` |
| POST | `/gateway-agent/heartbeat` | Gateway bearer token; 200: `{ "status": "ok" }` |

Create body: `{ "name": "Home gateway" }`. Pair body:
`{ "pairingToken": "<token from create or renewal>" }`.
Deliver the pairing token privately to the agent. Tokens expire in ten minutes,
can be consumed once, and become invalid when renewed or revoked. The gateway
credential is returned only when pairing succeeds. Save it securely and use it
as the bearer token for heartbeats, which update `lastSeenAt`. Gateway and account
tokens are not interchangeable.

Lifecycle: `PENDING → PAIRED → REVOKED`; pending gateways can also be revoked.
Revocation is idempotent. Paired/revoked gateways cannot be re-paired; register a
new gateway if its credential is lost. Lists/get responses contain no token or
credential hashes. `lastSeenAt` is the last report, not proof of connectivity.

## Devices and connection records

All routes require an account bearer token and enforce ownership.

| Method | Path | Result |
| --- | --- | --- |
| POST | `/devices` | 201: pending device |
| GET | `/devices` | 200: paginated owned devices |
| GET | `/devices/:id` | 200: device |
| POST | `/devices/:id/approve` | 200: explicitly approved device |
| POST | `/devices/:id/revoke` | 200: revoked device; active records end |
| POST | `/connections` | 201: active connection record |
| GET | `/connections` | 200: paginated owned connection records |
| GET | `/connections/:id` | 200: connection record |
| POST | `/connections/:id/end` | 200: ended connection record |

Device body: `{ "name": "My phone", "platform": "android" }`. Supported
platforms: `android`, `ios`, `linux`, `windows`, `macos`. Devices start `PENDING`
and need explicit approval. Revoked devices cannot be approved again; register
a new device. Approval is a management decision, not cryptographic device
attestation or tunnel authorization.

Connection body: `{ "gatewayId": "<uuid>", "deviceId": "<uuid>" }`.
Both resources must belong to the caller; the gateway must be paired and device
approved. Each device can have only one active record. Ending is idempotent and
preserves the original `endedAt`. Revocation closes active records atomically.
These endpoints record intent/history; no network tunnel starts or stops, and
records do not automatically expire after inactivity.

Lists accept `?limit=50&cursor=<previous nextCursor>` and return
`{ "items": [...], "nextCursor": "<uuid or null>" }`, newest first. Maximum
limit: 100. Invalid limits, UUIDs, and unknown filters return 400.

## Example flow (PowerShell)

```powershell
$api = 'http://127.0.0.1:3000/v1'
$credentials = @{ email = 'owner@example.com'; password = 'choose a long unique password' } | ConvertTo-Json
Invoke-RestMethod "$api/auth/register" -Method Post -ContentType application/json -Body $credentials
$login = Invoke-RestMethod "$api/auth/login" -Method Post -ContentType application/json -Body $credentials
$accountHeaders = @{ Authorization = "Bearer $($login.accessToken)" }

$gateway = Invoke-RestMethod "$api/gateways" -Method Post -Headers $accountHeaders -ContentType application/json -Body '{"name":"Home gateway"}'
# Pair on the gateway agent after privately transferring the token.
$pairBody = @{ pairingToken = $gateway.pairingToken } | ConvertTo-Json
$paired = Invoke-RestMethod "$api/gateway-agent/pair" -Method Post -ContentType application/json -Body $pairBody
$gatewayHeaders = @{ Authorization = "Bearer $($paired.gatewayToken)" }
Invoke-RestMethod "$api/gateway-agent/heartbeat" -Method Post -Headers $gatewayHeaders

$device = Invoke-RestMethod "$api/devices" -Method Post -Headers $accountHeaders -ContentType application/json -Body '{"name":"My phone","platform":"android"}'
Invoke-RestMethod "$api/devices/$($device.id)/approve" -Method Post -Headers $accountHeaders
$connectionBody = @{ gatewayId = $gateway.id; deviceId = $device.id } | ConvertTo-Json
$connection = Invoke-RestMethod "$api/connections" -Method Post -Headers $accountHeaders -ContentType application/json -Body $connectionBody
Invoke-RestMethod "$api/connections/$($connection.id)/end" -Method Post -Headers $accountHeaders
Invoke-RestMethod "$api/auth/logout" -Method Post -Headers $accountHeaders
```

## Errors

400: invalid input. 401: missing, invalid, expired, consumed, or revoked
credential. 404: absent resource or different owner. 409: duplicate email or
invalid/conflicting lifecycle transition. 429: public authentication/pairing
rate limit. Readiness returns 503 for database failures. Unexpected database
errors use the framework's generic 500 response without returning credentials
or SQL details.

## Paystack subscription checkout

Prices are fixed on the server: 24 hours KSh 25, 7 days KSh 120, and 30 days KSh 700.
These are one-time duration purchases, without automatic renewal. Store private
Paystack credentials in `.env`, never in frontend code or Git:

```dotenv
PAYSTACK_SECRET_KEY=your_private_test_key
PAYSTACK_CALLBACK_URL=http://127.0.0.1:5173/
```

Use a real `sk_test_...` key privately, then restart `npm run app:dev` so the
payment migration is applied. Use a reachable HTTPS callback for shared deployment.
A Kenya Paystack account with the required KES channels enabled is needed for M-Pesa
and cards. Payment details are collected on Paystack's hosted checkout.

Configure a public HTTPS webhook URL in Paystack:
`https://YOUR_HOST/v1/billing/webhook`. If the web app proxies the API, the same
origin works. Localhost and a private Tailscale-only URL cannot receive Paystack
webhooks. The handler verifies the raw-body signature, then independently verifies
the transaction with Paystack before activation. If your Paystack account uses the
new `Paystack-Signature` header, also set `PAYSTACK_WEBHOOK_SECRET=whsec_...` privately;
otherwise legacy `x-paystack-signature` uses the API secret. Use test-mode secrets
with test-mode events. Never commit either secret.

After checkout returns, the signed-in browser asks the server to verify the payment.
Pending payments do not open gateway setup. Only successful payments with the exact
reference, account, KES amount, and currency open the gateway selector. Choosing a
pending gateway generates a fresh single-use token. Paste it into the home-PC agent;
the screen automatically confirms pairing. Internet traffic still requires the
separately configured Tailscale tunnel. NetBridge payment and device records do not
enforce Tailscale network permissions or automatically disconnect it at expiry.

`POST /v1/billing/checkout` takes `{plan: daily|weekly|monthly, channel: mpesa|card}`.
`POST /v1/billing/payments/:reference/verify` verifies an account-owned purchase.
Repeat verification does not extend the paid duration, which starts at Paystack's
confirmed payment time. If the browser loses its saved reference, use the payment
reference from your merchant records to recover the payment through the verification
endpoint. Configure public HTTPS hosting and test the full provider callback/webhook
flow before accepting live payments. No live payments were taken during local tests.

Provider references: https://paystack.com/docs/api/transaction/ and
https://paystack.com/docs/payments/webhooks/.
