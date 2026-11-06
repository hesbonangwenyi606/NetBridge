param([switch]$ShareApp)
$ErrorActionPreference = 'Stop'
$tailscalePath = Join-Path $env:ProgramFiles 'Tailscale/tailscale.exe'
if (-not (Test-Path -LiteralPath $tailscalePath)) { throw 'Install Tailscale first: winget install --id Tailscale.Tailscale --exact' }
$statusText = & $tailscalePath status --json
if ($LASTEXITCODE -ne 0) { throw 'Cannot read Tailscale status. Open Tailscale and start its service.' }
$status = $statusText | ConvertFrom-Json
if ($status.BackendState -ne 'Running') {
    Write-Host 'Open Tailscale from the Start menu and sign in. Then run this script again.'
    exit 2
}
& $tailscalePath set --advertise-exit-node --unattended
if ($LASTEXITCODE -ne 0) { throw 'Cannot enable the home exit node. Run this script from PowerShell as Administrator.' }
Write-Host 'Home exit node advertised. In https://login.tailscale.com/admin/machines approve Use as exit node for this PC.'
Write-Host ('Home PC Tailscale IP: ' + ($status.TailscaleIPs | Select-Object -First 1))
if ($ShareApp) {
    Invoke-RestMethod 'http://127.0.0.1:5173/v1/health/ready' | Out-Null
    & $tailscalePath serve --bg --https=443 http://127.0.0.1:5173
    if ($LASTEXITCODE -ne 0) { throw 'Could not share the app. Follow any Tailscale HTTPS authorization prompt and retry.' }
    Write-Host 'App shared privately in your tailnet. The URL is printed above. Keep npm run app:dev running.'
}
Write-Host 'Pairing in NetBridge does not control Tailscale permissions. Remove VPN access in the Tailscale admin console.'
