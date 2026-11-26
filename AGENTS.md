# Regeln fuer dieses Projekt

## Discord-Update-Ritual (Pflicht)

Immer wenn `src/source.lua` / `loader.lua` (das Script) geaendert oder geupdatet wird,
wird **im selben Zug** der Discord-Server `ryuk hub` (Guild-ID `1575576191920898171`)
mitgepflegt:

1. **`#👀・features`** aktualisieren, wenn sich Funktionen geaendert haben
   (neu, entfernt, umbenannt). Format: Liste wie im bestehenden Post.
2. **`#🛠・updates`** einen Update-Post schreiben, Format:

   ```
   new update

   **v1.x**
   - ...
   - ...
   ```

   Kurz, Englisch, nur was sich wirklich geaendert hat. Version aus dem
   `CHANGELOG` in `src/source.lua`.
3. **`#❗・announcement`** nur fuer allgemeine Neuigkeiten (free/paid, Events,
   grosse Ankuendigungen) - **keine** Script-Updates.
4. **`#ℹ️・info`** aktualisieren, wenn sich Version, erlaubter Executor
   (aktuell nur **Madium**) oder der Anti-Cheat-Bypass (Adonis) aendert.

Alles auf Englisch, Kanaele sind read-only (Post per Bot).

## Versionierung (wichtig)

- Version **+0.1 nur bei neuen Features** (neuer Toggle, neuer Slider, neue
  Funktion, die es vorher nicht gab).
- **Verbesserungen an bestehenden Features (Bugfix, Feintuning, schneller,
  stabiler) = KEIN Versionsbump.** Dann bleibt die Version gleich und der
  Update-Post traegt die aktuelle Version.
- Bei jedem Update trotzdem `#🛠・updates` posten und im `CHANGELOG` in
  `src/source.lua` ergaenzen (unter der aktuellen Version).

Zusaetzlich:

- **News vom Nutzer** (Ankuendigungen, free/paid, Events) -> sofort nach
  `#❗・announcement` posten, Englisch, kurz.
- **Jedes Script-Update** bekommt **immer** einen neuen Post in
  `#🛠・updates` (Version + was sich geaendert hat).

Nicht fragen, ob gepostet werden soll - einfach machen und danach kurz melden.
