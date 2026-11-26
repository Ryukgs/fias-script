# ryuk agent - mit dem bot im chat reden

Du schreibst normal in einen Kanal, der Bot baut. Keine Commands.
Er kann Kategorien, Kanäle und Rollen anlegen, umbenennen, verschieben
und (nach Rückfrage) löschen.

## Was du brauchst

1. **Bot-Token** — Developer Portal, deine App, Bot -> Reset Token.
2. **Deine User-ID** — Discord -> Entwicklermodus an -> Rechtsklick auf dich -> ID kopieren.
3. **Server-ID** — Rechtsklick auf den Server -> ID kopieren.
4. **API-Key** — https://freebuff.com/account/api (Account -> Developer API).

## 1. Message Content Intent an

Developer Portal -> deine App -> **Bot** -> unten bei *Privileged Gateway Intents*:
**MESSAGE CONTENT INTENT** einschalten -> Save. Ohne das sieht der Bot deine
Nachrichten nicht.

## 2. Einrichten

```powershell
cd discord\agent
npm install
Copy-Item .env.example .env
notepad .env
```

In der `.env` ausfüllen:

```
DISCORD_TOKEN=...
OWNER_DISCORD_ID=...
DISCORD_GUILD_ID=...
AGENT_CHANNEL=bot-chat
OPENAI_API_KEY=...
```

`AGENT_CHANNEL` ist der Kanal, in dem der Bot zuhört (Name reicht, auch mit
Emoji davor). Leer lassen = er hört in allen Kanälen zu.

## 3. Starten

```powershell
node --env-file=.env bot.mjs
```

Im Kanal `bot-chat` schreiben, z. B.:

- „leg eine kategorie script an mit den kanälen download, changelog und support"
- „mach support read-only und nur für verified sichtbar"
- „bau die kategorie important mit den kanälen wie im screenshot"
- „benenne chat in general um"
- „leg eine rolle helper an, grau"

Der Bot antwortet mit einer kurzen Liste, was er angelegt hat.

## Wichtig

- **Der Bot muss laufen.** Solange das Fenster zu ist, ist er offline.
  Für 24/7: auf einen Host mit Dauerbetrieb legen (VPS) oder den PC laufen lassen.
- **Nur du** kannst mit ihm bauen: `OWNER_DISCORD_ID` ist die Sperre.
- **Löschen** fragt vorher nach — bestätigen mit „ja".
- **API-Kosten** laufen über deinen Key. Jede Nachricht ist ein Request.

## Wenn etwas nicht geht

| Fehler | Ursache |
| --- | --- |
| `missing env: ...` | `.env` unvollständig oder `--env-file` vergessen |
| `api 401` | API-Key falsch |
| `api 404` | `OPENAI_MODEL` oder `OPENAI_BASE_URL` falsch |
| Bot antwortet nicht | Message Content Intent aus, oder falscher Kanal |
| `Missing Permissions` | Bot braucht Administrator |
