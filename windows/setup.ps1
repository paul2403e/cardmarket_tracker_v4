# CM-Tracker auf dem Windows-Laptop einrichten – einmalig, darf jederzeit erneut laufen.
#
# In PowerShell (normales Fenster, kein Administrator nötig – nur die Chrome-Installation fragt evtl. nach) einfügen:
#   irm https://raw.githubusercontent.com/paul2403e/cardmarket_tracker_v4/main/windows/setup.ps1 | iex
#
# Macht: Python und Google Chrome installieren (falls nötig), Scraper laden, Zugangsdaten abfragen
# (verschlüsselt gespeichert), Zeitplan 03:30 Uhr anlegen, Wecken auf Akku erlauben, Befehl "cm" einrichten.

$ErrorActionPreference = 'Stop'
$Repo = 'paul2403e/cardmarket_tracker_v4'
$CmHome = Join-Path $env:LOCALAPPDATA 'cmtracker'

function Step($text) { Write-Host ''; Write-Host "==> $text" -ForegroundColor Cyan }

if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
    throw "Dieser Laptop hat keinen x64-Prozessor ($env:PROCESSOR_ARCHITECTURE). Der Scraper ist nur für x64 eingerichtet (die FlareSolverr-Reserve gibt es für Windows nur für x64)."
}

Step 'Python suchen'
$py = $null
foreach ($v in '313', '312') {
    $candidate = Join-Path $env:LOCALAPPDATA "Programs\Python\Python$v\python.exe"
    if (Test-Path $candidate) { $py = $candidate; break }
}
if (-not $py) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw 'winget fehlt. Bitte Python 3.13 von https://www.python.org/downloads/ installieren und dieses Skript erneut starten.'
    }
    Step 'Python 3.13 installieren (einmalig, 1-2 Minuten)'
    winget install -e --id Python.Python.3.13 --scope user --silent --accept-package-agreements --accept-source-agreements
    $candidate = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python313\python.exe'
    if (-not (Test-Path $candidate)) { throw 'Python wurde nicht gefunden. Bitte Python 3.13 von python.org installieren und erneut starten.' }
    $py = $candidate
}
& $py --version

Step 'Steuerskript laden'
New-Item -ItemType Directory -Force -Path (Join-Path $CmHome 'runner') | Out-Null
$runner = Join-Path $CmHome 'runner\cmwin.py'
Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/$Repo/main/windows/cmwin.py" -OutFile $runner

$env:PYTHONUTF8 = '1'
& $py $runner setup
if ($LASTEXITCODE -ne 0) { throw "Einrichtung abgebrochen (Fehlercode $LASTEXITCODE). Einfach dieses Skript erneut starten." }

Step 'Wecken aus dem Energiesparmodus erlauben (am Kabel und auf Akku)'
$power = 'powercfg /setacvalueindex SCHEME_CURRENT SUB_SLEEP RTCWAKE 1; ' +
         'powercfg /setdcvalueindex SCHEME_CURRENT SUB_SLEEP RTCWAKE 1; ' +
         'powercfg /setactive SCHEME_CURRENT'
$ErrorActionPreference = 'Continue'   # Fehlermeldungen von powercfg sollen das Skript nicht abbrechen
$out = powercfg /setacvalueindex SCHEME_CURRENT SUB_SLEEP RTCWAKE 1; $ok1 = $LASTEXITCODE -eq 0
$out = powercfg /setdcvalueindex SCHEME_CURRENT SUB_SLEEP RTCWAKE 1; $ok2 = $LASTEXITCODE -eq 0
$out = powercfg /setactive SCHEME_CURRENT; $ok3 = $LASTEXITCODE -eq 0
$ErrorActionPreference = 'Stop'
if (-not ($ok1 -and $ok2 -and $ok3)) {
    Write-Host 'Dafür braucht Windows einmal Administrator-Rechte – bitte die folgende Rückfrage mit "Ja" bestätigen.'
    Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile', '-Command', $power
}
Write-Host 'Wecken erlaubt.'

Step 'Befehl "cm" einrichten'
$bin = Join-Path $CmHome 'bin'
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not $userPath) { $userPath = '' }
if (($userPath -split ';') -notcontains $bin) {
    [Environment]::SetEnvironmentVariable('Path', ($userPath.TrimEnd(';') + ";$bin").TrimStart(';'), 'User')
}
if (($env:Path -split ';') -notcontains $bin) { $env:Path += ";$bin" }

Write-Host ''
Write-Host 'Fertig!' -ForegroundColor Green
Write-Host 'Nächster Schritt – Testlauf mit 20 Produkten (dauert ca. 5-10 Minuten):'
Write-Host ''
Write-Host '    cm test' -ForegroundColor Yellow
Write-Host ''
Write-Host 'Weitere Befehle:  cm status  |  cm logs  |  cm run --now  |  cm help'
Write-Host '(Ein neues PowerShell-Fenster kennt den Befehl cm ebenfalls.)'
