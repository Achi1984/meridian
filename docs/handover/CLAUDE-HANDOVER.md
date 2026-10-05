# Claude → ChatGPT Handover

Diese Datei wird von Claude (Reviewer) auf dem Branch `claude/handover` nach jedem Review überschrieben. Sie enthält immer den neuesten Stand.
Verbindlich bleibt die Mailbox in Issue #539. Diese Datei ist nur eine Zusammenfassung.
Der Branch wird nie gemergt und hat keinen Einfluss auf main, die Frozen-Pins oder die CI-Gates.

- last_update: 2026-10-05 19:45 Europe/Vienna
- reviewer: CLAUDE

## Offene Aufgaben für ChatGPT (Priorität absteigend)

### 1. PR #551 FIB-MAP-V2 (r114): R1B → GREEN LIGHT
- Review: https://github.com/Achi1984/meridian/issues/539#issuecomment-5999727319
- Verdict: `REVIEW 71f7e132c7590857d1c244e9fd04a46928b95613: GREEN LIGHT`
- Merge ist **nur** auf exakt `71f7e132c7590857d1c244e9fd04a46928b95613` erlaubt. Jeder weitere Commit macht das Verdict ungültig.
- Vor dem Merge prüfen:
  - PR-HEAD ist noch `71f7e13`
  - Base ist noch `dd62c33`
  - `mergeable=true`
- Nach dem Merge: `CROSS_MODEL_STATUS FIB-MAP-V2-IMPL-R1B` mit Merge-SHA posten.
- Nicht blockierende NITs für einen späteren Durchgang (optional):
  1. Desktop H=390: Steht CURRENT mehr als ca. 2 % der Spanne außerhalb aller Levels, stauen sich Labels an der unteren Kante (ca. 5,4 px Abstand, z. B. 0.786 und 1.000). Mobile 430 ist nicht betroffen. Fix: Reverse-Compaction-Pass vom Rand aus.
  2. Fehlende Tests: DOWN-Swing, H=390, CURRENT außerhalb der Level-Range, CURRENT exakt auf einem Level.
  3. `fibLayoutHeightPx()` liest die Breite nur beim Rendern; ein Resize über 600 px ohne Re-Render verschiebt die Labels leicht.
  4. `MERIDIAN_AGENT_STATE.json` und `MERIDIAN_RESUME.json` stehen noch auf r113. Nach dem Merge nachziehen.
  5. Den Zusatz „DISPLAY" beim Cluster-Label und die Legende beibehalten. Sie verhindern, dass das Cluster als Konfluenz-Signal gelesen wird.

### 2. Abgeschlossen
- #549 CV2 Strategy Driver: GREEN auf `70a2f94` und gemergt.
- Funding-Carry A Kosten-Vorfilter: PASS_TO_DATA_DESIGN (eingeschränkt) und bestätigt. Data-Design nur mit ausdrücklicher Freigabe durch den User.

### Infrastruktur
- Der `@claude`-Mailbox-Workflow scheitert noch am fehlenden Repo-Secret `CLAUDE_CODE_OAUTH_TOKEN`. Das muss der User selbst anlegen.

## Harte Grenzen (unverändert)
- kein canonical Source Read/Run
- kein PnL
- keine Discovery-Freigabe und kein Stage-Advance
- kein Merge ohne exaktes GREEN LIGHT auf dem aktuellen SHA
- keine Änderung der eingefrorenen V2-, FIB- oder SK-Regeln
