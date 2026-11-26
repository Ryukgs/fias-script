# ryuk hub - discord setup

Legt Rollen, Kategorien, Kanaele, Rechte und die Start-Texte in deinem Server an.
Das Script ist idempotent: was schon da ist, bleibt unangetastet.

## 1. Server anlegen

Discord -> **+** -> **Server erstellen** -> Name (z. B. `ryuk hub`) -> fertig.
Discord erlaubt keiner App, einen Server fuer dich zu erstellen, das ist der eine Klick.

## 2. Bot anlegen

1. https://discord.com/developers/applications -> **New Application** -> Name `ryuk setup`.
2. Links **Bot** -> **Reset Token** -> Token kopieren (nicht in den Chat schreiben).
3. **OAuth2 -> URL Generator**: Scope `bot`, Permissions `Administrator`.
4. Die erzeugte URL oeffnen und den Bot in deinen Server einladen.

## 3. Script ausfuehren

**Einfachster Weg — eine Datei, kein npm:**

```powershell
Invoke-WebRequest "https://raw.githubusercontent.com/Ryukgs/fias-script/main/discord/setup-standalone.mjs" -OutFile setup.mjs
$env:DISCORD_TOKEN="dein_token"
node setup.mjs <server_id>
```

Erst schauen, was passieren wuerde (ohne Token, ohne Server):

```powershell
node setup.mjs <server_id> --dry
```

**Alternativ mit discord.js:**

```bash
npm install
DISCORD_TOKEN=dein_token node setup.mjs <server_id>
```

Die Server-ID: Discord -> Einstellungen -> Erweitert -> Entwicklermodus an,
dann Rechtsklick auf den Server -> **Server-ID kopieren**.

Wichtig: den Ordner `discord/` gibt es nur im Repo. Wenn `cd discord` fehlschlaegt,
bist du im falschen Ordner (z. B. im Discord-Installationsordner).
Nimm den Pfad, in den du das Repo entpackt hast, oder den Ein-Datei-Weg oben.

## Was danach noch per Hand kommt

- **Verifizierung**: Server Settings -> Onboarding, Schwelle so setzen, dass neue
  Member erst `Verified` bekommen (sonst sehen sie `download` und `support` nicht).
- **Reihenfolge**: Kategorien ziehen, bis sie passen.
- **Banner**: Server Settings -> Overview -> Banner (16:9).
- **Rollen**: deinem Account `Owner` geben, Helpern/Mods die passende Rolle.

## Aufbau

```
INFO       announcements (read-only)  rules (read-only)  updates (read-only)  info (read-only)
SCRIPT     download (verified)  support (verified)  showcase (verified)
COMMUNITY  general  media  memes  bot-commands
VOICE      General  Chill  Script Talk
STAFF      staff-chat  logs        (nur Staff sichtbar)
```

Rollen von oben nach unten: `Owner`, `Admin`, `Moderator`, `Helper`, `Verified`,
`Member`, `Muted`.

## Token

Der Token gehoert in keine Datei, die committed wird. Am besten nur als
Umgebungsvariable setzen, wie oben. Wenn er doch mal irgendwo landet:
im Developer Portal **Reset Token** und neu starten.
