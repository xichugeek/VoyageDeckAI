$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$python = Join-Path $project 'backend/.venv/Scripts/python.exe'
$node = (Get-Command node).Source
$vite = Join-Path $project 'frontend/node_modules/vite/bin/vite.js'
$local = Join-Path $project '.local'

foreach ($file in @($python, $vite)) {
    if (!(Test-Path -LiteralPath $file)) { throw "Install the project dependencies first. Missing $file" }
}
foreach ($port in @(5177, 8289)) {
    if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
        throw "Local port $port is already in use. Identify its owner before continuing."
    }
}

$null = New-Item -ItemType Directory -Path $local -Force
$backendLog = Join-Path $local 'backend-dev.log'
$backend = Start-Process -FilePath $python -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8289') `
    -WorkingDirectory (Join-Path $project 'backend') -WindowStyle Hidden -RedirectStandardError $backendLog -PassThru
try {
    $ready = $false
    for ($attempt = 1; $attempt -le 25 -and !$backend.HasExited; $attempt++) {
        try {
            $health = Invoke-RestMethod 'http://127.0.0.1:8289/api/health' -TimeoutSec 1
            if ($health.service -eq 'voyagedeck-ai') { $ready = $true; break }
        } catch { Start-Sleep -Milliseconds 200 }
    }
    if (!$ready) { throw "Backend did not start. Check $backendLog" }
    Write-Host 'Console http://127.0.0.1:5177 | Health http://127.0.0.1:8289/api/health | OpenAPI http://127.0.0.1:8289/api/docs'
    Push-Location (Join-Path $project 'frontend')
    try { & $node $vite } finally { Pop-Location }
} finally {
    if (!$backend.HasExited) { taskkill.exe /PID $backend.Id /T /F | Out-Null }
}
