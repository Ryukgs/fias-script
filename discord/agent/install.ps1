# ryuk agent - installer
# Rechtsklick -> "Mit PowerShell ausfuehren", oder:
#   powershell -ExecutionPolicy Bypass -File install.ps1
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Line($text, $color = "Gray") { Write-Host "  $text" -ForegroundColor $color }
function Head($text) {
  Write-Host ""
  Write-Host "  $text" -ForegroundColor White
  Write-Host "  $('-' * $text.Length)" -ForegroundColor DarkGray
}
function Ask($label, $default = "") {
  if ($default) {
    $value = Read-Host "  $label [$default]"
    if ([string]::IsNullOrWhiteSpace($value)) { return $default }
    return $value.Trim()
  }
  do { $value = Read-Host "  $label" } while ([string]::IsNullOrWhiteSpace($value))
  return $value.Trim()
}
function AskSecret($label) {
  $secure = Read-Host "  $label" -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringAuto($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

Clear-Host
Write-Host ""
Write-Host "  ryuk agent" -ForegroundColor White
Write-Host "  bot, mit dem du im discord redest" -ForegroundColor DarkGray

# --- 1. node pruefen -------------------------------------------------------
Head "1/4  Node pruefen"
try { $nodeVersion = (& node -v).Trim() } catch { $nodeVersion = $null }
if (-not $nodeVersion) {
  Line "Node fehlt." "Red"
  Line "Installiere es von https://nodejs.org (LTS), dann dieses Fenster neu starten." "Yellow"
  Read-Host "  Enter zum Schliessen"
  exit 1
}
Line "node $nodeVersion gefunden" "DarkGray"

# --- 2. bot-dateien holen --------------------------------------------------
Head "2/4  Bot herunterladen"
$root = Join-Path $env:USERPROFILE "Desktop\ryuk-agent"
if (Test-Path (Join-Path $root "bot.mjs")) {
  Line "schon vorhanden: $root" "DarkGray"
} else {
  Line "lade..."
  $zip = Join-Path $env:TEMP "ryuk-agent.zip"
  $tmp = Join-Path $env:TEMP "ryuk-agent-extract"
  Invoke-WebRequest "https://github.com/Ryukgs/fias-script/archive/refs/heads/main.zip" -OutFile $zip
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive $zip -DestinationPath $tmp -Force
  New-Item -ItemType Directory -Force -Path $root | Out-Null
  Copy-Item (Join-Path $tmp "fias-script-main\discord\agent\*") $root -Recurse -Force
  Line "entpackt nach $root" "DarkGray"
}
Set-Location $root

if (-not (Test-Path "node_modules")) {
  Line "installiere pakete (dauert kurz)..."
  & npm install --no-audit --no-fund | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Line "npm install fehlgeschlagen." "Red"
    Read-Host "  Enter zum Schliessen"
    exit 1
  }
}
Line "pakete ok" "DarkGray"

# --- 3. werte abfragen -----------------------------------------------------
Head "3/4  Werte eintragen"
Line "Wo du das findest:" "DarkGray"
Line "  Token        discord.com/developers/applications -> deine app -> Bot -> Reset Token" "DarkGray"
Line "  Deine ID     discord -> einstellungen -> erweitert -> entwicklermodus an -> rechtsklick auf dich -> ID" "DarkGray"
Line "  Server-ID    rechtsklick auf den server -> ID kopieren" "DarkGray"
Line "  API-Key      aistudio.google.com/apikey (gratis, google-konto)" "DarkGray"
Write-Host ""

$token = AskSecret "Bot-Token (wird nicht angezeigt)"
$ownerId = Ask "Deine User-ID"
$guildId = Ask "Server-ID" "1575576191920898171"
$channel = Ask "Kanal fuer den chat" "bot-chat"
$apiKey = AskSecret "API-Key (wird nicht angezeigt)"

if ($token.Length -lt 20 -or $apiKey.Length -lt 10) {
  Line "Token oder API-Key sieht zu kurz aus. Abgebrochen." "Red"
  Read-Host "  Enter zum Schliessen"
  exit 1
}

$envContent = @"
DISCORD_TOKEN=$token
OWNER_DISCORD_ID=$ownerId
DISCORD_GUILD_ID=$guildId
AGENT_CHANNEL=$channel
OPENAI_API_KEY=$apiKey
OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
OPENAI_MODEL=gemini-3.8-flash
OPENAI_FALLBACK_MODELS=gemini-3.5-flash-lite,gemini-2.5-flash
"@
# ohne BOM schreiben, sonst liest node den ersten schluessel falsch
[IO.File]::WriteAllText((Join-Path $root ".env"), $envContent, (New-Object System.Text.UTF8Encoding($false)))
Line ".env gespeichert" "DarkGray"

# --- 4. starten ------------------------------------------------------------
Head "4/4  Bot starten"
Line "Beenden mit Strg + C" "DarkGray"
Write-Host ""
& node --env-file=.env bot.mjs

Write-Host ""
Line "Bot beendet." "Yellow"
Read-Host "  Enter zum Schliessen"
