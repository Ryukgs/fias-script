# ryuk hub - discord setup

Eine Datei, keine dependencies, keine Nachrichten in den Kanaelen.
Der Aufbau ist 1:1 der Referenz-Server: gleiche Kategorien, gleiche
Kanal-Namen mit Emoji, gleiche Kanal-Typen.

## Update-Ritual (immer)

Wenn das Script geupdated wird, wird Discord **immer** mitgepflegt:

- `#👀・features` -> Liste der Funktionen aktualisieren, falls sich was geaendert hat
- `#🛠・updates` -> Post im Format:

  ```
  new update

  - ...
  - ...
  ```

  ohne Versionsnummer - nur was neu/verbessert ist

- `#❗・announcement` -> nur allgemeine Neuigkeiten, keine Script-Updates
- `#ℹ️・info` -> Executor-Support, Anti-Cheat-Bypass (Adonis) aktualisieren
  (keine Versionsnummer)

## Versionierung

- **+0.1 nur bei neuen Features** (neuer Toggle/Slider/Funktion)
- Verbesserungen an bestehenden Features (Fix, Tuning) = **kein Bump**,
  Update-Post traegt dann nur die aktuelle Version

News vom Nutzer -> sofort `#❗・announcement`.
Jedes Script-Update -> **immer** neuer Post in `#🛠・updates`.

Alles auf Englisch, ohne Nachfrage.

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
node setup.mjs <server_id> --reset --force
```

Erst schauen, was passieren wuerde (ohne Token, ohne Server):

```powershell
node setup.mjs <server_id> --dry
```

Server-ID: Einstellungen -> Erweitert -> Entwicklermodus an, dann Rechtsklick
auf den Server -> **Server-ID kopieren**.

`--reset` raeumt alles weg, was frueher von diesem Script angelegt wurde
(beide alten Layouts). Ohne `--force` bleiben Kanaele mit Nachrichten stehen.

## Aufbau

```
rules                       Megafon, read-only      (ohne Kategorie)
tos                         #, read-only
STATUS: 🟢                  #, privat (nur Staff)

IMPORTANT
  📣・announcements          Megafon, read-only
  📣・affiliate-program      #
  📣・updates                #, read-only
  🍑・purchase               #
  🎫・ticket                 #
  📘・info                   #, read-only
  💰・stock                  #
  💰・limiteds               #
  💰・robux                  #
  💰・discord-accounts       #

COMMUNITY
  💬・chat                   #, slowmode 3s
  🎥・uploads                #, slowmode 10s
  💡・suggestions            #
  ⚙️・configs                #

VOUCHES
  ⭐・reviews                #
  💬・feedback               #
```

**Kanal-Typen wie im Bild:**

- **Megafon** = Announcement-Kanal (`rules`, `📣・announcements`). Braucht das
  Community-Feature im Server. Ist es aus, legt das Script die Kanaele als
  normale Text-Kanaele an, statt abzubrechen.
- **#** = normaler Text-Kanal.
- **Schloss** = privat, nur Staff sieht ihn (`STATUS: 🟢`).

Rollen von oben nach unten: `Owner`, `Admin`, `Moderator`, `Helper`, `Verified`,
`Member`, `Muted` (Graustufen, passend zum schwarz/weiß-Look).

## Was noch per Hand kommt

- **Community aktivieren**, wenn du die Megafon-Icons willst:
  Server Settings -> Enable Community.
- **Reihenfolge** der Kategorien ziehen (IMPORTANT, COMMUNITY, VOUCHES).
- **Banner** hochladen (16:9).
- Dir selbst die Rolle `Owner` geben.

## Token

Nur als Umgebungsvariable setzen, nie in eine Datei schreiben, die committed
wird. Wenn er doch mal irgendwo landet: Developer Portal -> **Reset Token**.
