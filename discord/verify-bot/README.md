# ryuk verify bot

Ein Button in `#verify`. Klick = Account-Alter pruefen, Rolle `Verified`
geben, Eintrag in `#logs`. Kein Fremd-Bot, keine KI, keine Kosten.

## Was er braucht

- denselben **Bot-Token** wie dein `ryuk Bot` (Developer Portal -> Bot -> Reset Token)
- die Rolle **Verified** (existiert schon)
- die Kanaele **verify**, **logs**, **rules** (existieren schon)

## Einrichten

```powershell
mkdir "$env:USERPROFILE\Documents\ryuk-verify" -Force
cd "$env:USERPROFILE\Documents\ryuk-verify"
Invoke-WebRequest "https://raw.githubusercontent.com/Ryukgs/fias-script/main/discord/verify-bot/verify.mjs" -OutFile verify.mjs
Invoke-WebRequest "https://raw.githubusercontent.com/Ryukgs/fias-script/main/discord/verify-bot/package.json" -OutFile package.json
Invoke-WebRequest "https://raw.githubusercontent.com/Ryukgs/fias-script/main/discord/verify-bot/start.cmd" -OutFile start.cmd
Invoke-WebRequest "https://raw.githubusercontent.com/Ryukgs/fias-script/main/discord/verify-bot/.env.example" -OutFile .env.example
npm install
Copy-Item .env.example .env
notepad .env
```

In der `.env` nur zwei Zeilen ausfuellen:

```
DISCORD_TOKEN=dein_bot_token
DISCORD_GUILD_ID=1575576191920898171
```

Dann `start.cmd` doppelklicken. Beim ersten Start postet der Bot das Panel
in `#verify`.

## Wichtig: Rollen-Reihenfolge

Der Bot kann nur Rollen vergeben, die **unter** seiner eigenen Rolle stehen.
Also: Servereinstellungen -> Rollen -> **`ryuk Bot`** nach oben ziehen,
ueber `Verified`. Sonst kommt "Could not assign the role".

## Was passiert beim Klick

1. Account zu neu? -> Nachricht "try again in X days" (nur der Klickende sieht sie)
2. Sonst: Rolle `Verified` vergeben -> "Verified. Welcome."
3. Log in `#logs`: `✅ @user verified (account age X days)`

## Einstellungen (optional, in `.env`)

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `MIN_ACCOUNT_AGE_DAYS` | `7` | Mindestalter des Accounts |
| `VERIFY_CHANNEL` | `verify` | Kanal fuer das Panel |
| `VERIFY_ROLE` | `Verified` | Rolle, die vergeben wird |
| `LOG_CHANNEL` | `logs` | Kanal fuer Logs |

## Wenn etwas nicht geht

| Meldung | Ursache |
| --- | --- |
| `missing env` | `.env` fehlt oder `--env-file` nicht benutzt |
| `kanal nicht gefunden` | Kanalname in `.env` falsch |
| `Could not assign the role` | Bot-Rolle steht unter `Verified` |
| Panel fehlt | Kanal `verify` existiert nicht oder Bot hat keine Rechte |
