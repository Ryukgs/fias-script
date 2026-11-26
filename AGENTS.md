# Regeln fuer dieses Projekt

## Discord-Update-Ritual (Pflicht)

Immer wenn `src/source.lua` / `loader.lua` (das Script) geaendert oder geupdatet wird,
wird **im selben Zug** der Discord-Server `ryuk hub` (Guild-ID `1575576191920898171`)
mitgepflegt:

1. **`#👀・features`** aktualisieren, wenn sich Funktionen geaendert haben
   (neu, entfernt, umbenannt). Format: Liste wie im bestehenden Post.
2. **`#🛠・updates`** einen Update-Post schreiben, Format:

   ```
   @everyone
   new update

   - ...
   - ...
   ```

   **Jeder Post in `#updates` und `#announcement` beginnt mit `@everyone`**
   (pingt den ganzen Server).

   **Keine Versionsnummer im Post** - nur was neu ist und was verbessert wurde.
   Kurz, Englisch, nur echte Aenderungen.
3. **`#❗・announcement`** nur fuer allgemeine Neuigkeiten (free/paid, Events,
   grosse Ankuendigungen) - **keine** Script-Updates.
4. **`#ℹ️・info`** aktualisieren, wenn sich Executor-Support oder der
   Anti-Cheat-Bypass (Adonis) aendert.

**Versionsnummer steht NIRGENDS in Discord** - weder im Update-Post noch in
`#info` noch sonst wo. Sie existiert nur im `CHANGELOG` in `src/source.lua`
(News-Fenster im Script).

Alles auf Englisch, Kanaele sind read-only (Post per Bot).

## Versionierung (wichtig)

- Version **+0.1 nur bei neuen Features** (neuer Toggle, neuer Slider, neue
  Funktion, die es vorher nicht gab).
- **Verbesserungen an bestehenden Features (Bugfix, Feintuning, schneller,
  stabiler) = KEIN Versionsbump.**
- Bei jedem Update trotzdem `#🛠・updates` posten (ohne Version) und im
  `CHANGELOG` in `src/source.lua` ergaenzen.

## Zusaetzlich

- **News vom Nutzer** (Ankuendigungen, free/paid, Events) -> sofort nach
  `#❗・announcement` posten, Englisch, kurz, mit `@everyone` davor.
- **Jedes Script-Update** bekommt **immer** einen neuen Post in `#🛠・updates`.

Nicht fragen, ob gepostet werden soll - einfach machen und danach kurz melden.
