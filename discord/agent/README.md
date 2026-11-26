# ryuk agent - mit dem bot im chat reden

Du schreibst normal in einen Kanal, der Bot baut. Keine Commands.
Er kann Kategorien, Kanäle und Rollen anlegen, umbenennen, verschieben
und (nach Rückfrage) löschen.

## Was du brauchst

1. **Bot-Token** — Developer Portal, deine App, Bot -> Reset Token.
2. **Deine User-ID** — Discord -> Entwicklermodus an -> Rechtsklick auf dich -> ID kopieren.
3. **Server-ID** — Rechtsklick auf den Server -> ID kopieren.
4. **API-Key** — gratis ueber dein Google-Konto (siehe unten).

## Gratis-Key (Google Gemini)

1. https://aistudio.google.com/apikey oeffnen und mit dem Google-Konto einloggen.
2. **Create API key** klicken und den Key kopieren.
3. In der `.env` so eintragen:

```
OPENAI_API_KEY=dein_gemini_key
OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
OPENAI_MODEL=gemini-3.8-flash
```

Geht das Modell nicht: `OPENAI_MODEL=gemini-3.5-flash-lite`.

**Andere gratis-Anbieter mit demselben Format:**

| Anbieter | Base URL | Modell | Key |
| --- | --- | --- | --- |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` | console.groq.com/keys |
| OpenRouter | `https://openrouter.ai/api/v1` | `meta-llama/llama-3.3-70b-instruct:free` | openrouter.ai/keys |

**Mit Credits:** https://freebuff.com/account/api
(`OPENAI_BASE_URL=https://freebuff.com/api/v1/paid`, `OPENAI_MODEL=gpt-4o-mini`).

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
| `api 404` | `OPENAI_MODEL` oder `OPENAI_BASE_URL` falsch (Gemini: `.../v1beta/openai/` + `gemini-3.8-flash`) |
| Bot antwortet nicht | Message Content Intent aus, oder falscher Kanal |
| `Missing Permissions` | Bot braucht Administrator |
