# ryuk hub - discord setup

Eine Datei, keine dependencies, keine Nachrichten in den Kanaelen.
Legt Rollen, Kategorien und Kanaele an — mit den Emojis wie in den
Referenz-Servern. Idempotent: was schon da ist, bleibt unangetastet.

## 1. Server anlegen

Discord -> **+** -> **Server erstellen** -> Name (z. B. `ryuk hub`).

## 2. Bot anlegen

1. https://discord.com/developers/applications -> **New Application** -> Name `ryuk setup`.
2. **Bot** -> **Reset Token** -> Token kopieren (nicht in den Chat schreiben).
3. **OAuth2 -> URL Generator**: Scope `bot`, Permission `Administrator`.
4. URL oeffnen, Server waehlen, autorisieren.

## 3. Ausfuehren

```powershell
Invoke-WebRequest "https://raw.githubusercontent.com/Ryukgs/fias-script/main/discord/setup-standalone.mjs" -OutFile setup.mjs
$env:DISCORD_TOKEN="DEIN_TOKEN"
node setup.mjs <server_id>
```

Erst schauen, was passieren wuerde (ohne Token, ohne Server):

```powershell
node setup.mjs <server_id> --dry
```

Server-ID: Einstellungen -> Erweitert -> Entwicklermodus an, dann Rechtsklick
auf den Server -> **Server-ID kopieren**.

### Alte Kanaele ersetzen

Wenn schon ein Satz ohne Emoji im Server liegt (announcements, rules, general,
staff-chat ...), einmal mit `--reset` laufen lassen. Alte Kanaele mit Nachrichten
bleiben standardmaessig stehen; mit `--force` werden sie auch entfernt:

```powershell
node setup.mjs <server_id> --reset --force
```

## Aufbau

```
📢 important   📢・announcements  📜・rules  🔄・updates  ℹ️・info
📥 script      📥・download  🧾・changelog  🛠️・support  🎬・showcase
💸 purchase    🎫・ticket  💳・purchase  💵・prices
💬 community   💬・chat  🖼️・uploads  💡・suggestions  ⚙️・configs
⭐ vouches     ⭐・reviews  💬・feedback
🔊 voice       🔊・party chat  🎧・script talk
🛡️ staff       🛡️・staff-chat  📋・logs        (nur Staff sichtbar)
```

Rollen von oben nach unten: `Owner`, `Admin`, `Moderator`, `Helper`, `Verified`,
`Member`, `Muted` (Graustufen, damit es zum schwarz/weiß-Look passt).

Rechte:

- `download`, `support`, `showcase` nur fuer `Verified`
- `announcements`, `rules`, `updates`, `info`, `changelog`, `logs` read-only
- `staff`-Kategorie komplett unsichtbar fuer alle anderen
- `Muted` kann nirgends schreiben oder sprechen

## Was noch per Hand kommt

- **Verifizierung**: Server Settings -> Onboarding, damit neue Member `Verified`
  bekommen. Sonst sehen sie `script` nicht.
- **Reihenfolge** der Kategorien ziehen.
- **Banner** hochladen (16:9).
- Dir selbst die Rolle `Owner` geben.

## Token

Nur als Umgebungsvariable setzen, nie in eine Datei schreiben, die committed
wird. Wenn er doch mal irgendwo landet: Developer Portal -> **Reset Token**.
