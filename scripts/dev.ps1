$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$python = Join-Path $project 'backend/.venv/Scripts/python.exe'
$node = (Get-Command node).Source
$vite = Join-Path $project 'frontend/node_modules/vite/bin/vite.js'

foreach ($file in @($python, $vite)) {
    if (!(Test-Path -LiteralPath $file)) { throw "Install the project dependencies first. Missing $file" }
}
foreach ($port in @(5177, 8289)) {
    if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
        throw "Local port $port is already in use. Identify its owner before continuing."
    }
}

$backend = Start-Process -FilePath $python -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8289') `
    -WorkingDirectory (Join-Path $project 'backend') -WindowStyle Hidden -PassThru
try {
    Write-Host 'Console http://127.0.0.1:5177 | Health http://127.0.0.1:8289/api/health | OpenAPI http://127.0.0.1:8289/api/docs'
    Push-Location (Join-Path $project 'frontend')
    try { & $node $vite } finally { Pop-Location }
} finally {
    if (!$backend.HasExited) { Stop-Process -Id $backend.Id -ErrorAction SilentlyContinue }
}
