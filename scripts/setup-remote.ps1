param([string]$HomeIP, [switch]$Disconnect)
$ErrorActionPreference = 'Stop'
$tailscalePath = Join-Path $env:ProgramFiles 'Tailscale/tailscale.exe'
if (-not (Test-Path -LiteralPath $tailscalePath)) { throw 'Install Tailscale and sign in using the same account as the home PC.' }
if ($Disconnect) {
    & $tailscalePath set '--exit-node='
    if ($LASTEXITCODE -ne 0) { throw 'Could not disconnect the exit node.' }
    Write-Host 'Home exit node disconnected; normal internet routing restored.'
    exit
}
$parsedIP = $null
if (-not [System.Net.IPAddress]::TryParse($HomeIP, [ref]$parsedIP)) { throw 'Pass the home PC Tailscale IPv4 address using -HomeIP 100.x.y.z.' }
$ipBytes = $parsedIP.GetAddressBytes()
if ($ipBytes.Length -ne 4 -or $ipBytes[0] -ne 100 -or $ipBytes[1] -lt 64 -or $ipBytes[1] -gt 127) { throw 'Use the 100.64.0.0/10 Tailscale address of the home PC, not 192.168.1.1.' }
$statusText = & $tailscalePath status --json
if ($LASTEXITCODE -ne 0) { throw 'Cannot read Tailscale status.' }
$status = $statusText | ConvertFrom-Json
if ($status.BackendState -ne 'Running') { throw 'Open Tailscale and sign in, then retry.' }
& $tailscalePath ping --c=3 --timeout=10s $HomeIP
if ($LASTEXITCODE -ne 0) { throw 'Home PC is unreachable. Check that it is on and signed in to the same tailnet.' }
& $tailscalePath set "--exit-node=$HomeIP"
if ($LASTEXITCODE -ne 0) { throw 'Cannot select this exit node. Approve it in the Tailscale admin console first.' }
Write-Host 'Home exit node selected. Test a website and compare the public IP on both PCs to verify internet routing.'
Write-Host 'To undo: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-remote.ps1 -Disconnect'
