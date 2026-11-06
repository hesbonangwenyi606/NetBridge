# Windows home-network trial

NetBridge's agent pairs a PC and sends heartbeats. Tailscale provides the actual
encrypted tunnel and internet exit node. NetBridge approval/revocation and session
records do not grant or remove Tailscale access. Manage VPN permissions in Tailscale.

## Home PC (this computer)

1. Tailscale has been installed. Open it from the Start menu and sign in to your
   own account. Never paste your login password or auth keys into chat.
2. Keep `npm run app:dev` running and open http://127.0.0.1:5173.
3. Add a gateway named `Home PC`, or generate a fresh pairing token for your
   existing pending gateway. In a second terminal in this project run
   `npm run gateway:pair` and paste the token into its hidden prompt.
   The agent defaults to the local API at http://127.0.0.1:3000.
4. Run `npm run gateway:start` and leave that terminal open. Click **Done, check
   status** in NetBridge: the gateway should become Paired, with a recent heartbeat.
   You can also check with `npm run gateway:status`.
5. Open PowerShell as Administrator in the project folder and run:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-home.ps1 -ShareApp
   ```

   This advertises the PC as an exit node and enables Tailscale unattended mode.
   The optional `-ShareApp` flag serves the local web app privately over HTTPS
   within your tailnet. Tailscale may request HTTPS authorization. It does not
   expose the app to the public internet or require router port forwarding.
6. Open https://login.tailscale.com/admin/machines. Find this home PC, open its
   route settings, and approve **Use as exit node**. Record the PC's **100.x.y.z**
   Tailscale address printed by the setup script.

The gateway credential is encrypted with Windows per-user DPAPI in
`.local/gateway-agent/config.json`. It is not printed or committed. Start the
agent under the same Windows user after restarting the PC. Keep both the local
app and agent running; Tailscale's service alone does not start NetBridge.
Use separate `--config` paths for multiple gateways. Revoke a lost agent's gateway
in NetBridge and pair a new gateway. Never copy the credential to another PC.

## Remote Windows PC

1. Install Tailscale from https://tailscale.com/download/windows and sign in to
   the same account. Copy this repository or the `scripts/setup-remote.ps1` file
   to that PC. No Node.js is needed for the remote connection.
2. Connect the remote PC to a different internet connection, such as a phone
   hotspot. The hotspot still needs mobile data; a VPN does not provide free
   connectivity or work without internet at both ends.
3. In PowerShell run, replacing the example with the home Tailscale address:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-remote.ps1 -HomeIP 100.64.0.1
   ```

   Alternatively, use Tailscale's tray menu to select the home PC under Exit Node.
4. Open a website. Compare the public IPv4 address shown by an IP-checking website
   on both PCs. With the exit node enabled, both should show the home public IP.
   Repeat for IPv6 if available. A paired gateway or a successful ping alone does
   not prove internet traffic is using the home connection.
5. Open the private HTTPS URL printed by the home setup script to use NetBridge
   remotely. Register/approve a device in NetBridge to test management features;
   those records do not determine Tailscale VPN permissions.

Disconnect with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-remote.ps1 -Disconnect
```

Stop offering home internet by running `tailscale set --advertise-exit-node=false`
on the home PC (the CLI is in `C:\Program Files\Tailscale`). Remove a remote PC
from the Tailscale admin console to revoke its network access. To stop sharing
only this app, run `tailscale serve --https=443 off` on the home PC.

## Verification and limits

Run `npm run gateway:test` for isolated agent tests. Set
`NETBRIDGE_AGENT_TEST_API=http://127.0.0.1:3000` to additionally test the running
local API: it creates a test account and a gateway, pairs it, sends a heartbeat,
and verifies that revocation blocks the stored credential. It leaves the test
account and revoked gateway as test history. Windows DPAPI requires access to
the current Windows user's credential store. No router settings are changed.

The two-PC tunnel requires your Tailscale sign-in, exit-node approval, and the
remote PC. It cannot be verified from this machine alone.

Official instructions: https://tailscale.com/docs/features/exit-nodes/how-to/setup?tab=windows
