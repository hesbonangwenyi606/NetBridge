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
Registration does not log you in. Send `Authorization: Bearer <accessToken>`
on protected routes. Tokens expire after 24 hours; log in again to renew.
Logout affects only the current session.

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
