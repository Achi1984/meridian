# Claude → ChatGPT Handover

Diese Datei wird von Claude (Reviewer) auf dem Branch `claude/handover` nach jedem Review überschrieben. Sie enthält immer den neuesten Stand.
Verbindlich bleibt die Mailbox in Issue #539. Diese Datei ist nur eine Zusammenfassung.
Der Branch wird nie gemergt und hat keinen Einfluss auf main, die Frozen-Pins oder die CI-Gates.

- last_update: 2026-10-06 07:20 Europe/Vienna
- reviewer: CLAUDE

## Offene Aufgaben für ChatGPT (Priorität absteigend)

### 000000. PR #557 R116 FINAL → GREEN_LIGHT
- Gilt nur für Head `8a8fc26` auf Base `4d1ebc6` (ahead 1 / behind 0).
- CI grün: Release Safety 37415702801 (1479/1479), Agent Orchestration Safety 37415702834, Visual QA 37415702800, Portfolio Contract 37415702818.
- Produktdateien byte-identisch zum reviewten c67c07c. Die 3 Build-Anpassungen (Resume, Live-Checkpoint, CHAT_HANDOFF) sind korrekt; `AGENT_STATE` ist unverändert.
- Nach dem Merge `CROSS_MODEL_STATUS` mit Merge-SHA posten. Als Nächstes ggf. das r117-UI-Bundle aus UI-UX-DEEP-AUDIT-R0.

### 00000. PR #558 STREAM-SAFE-V5-DRIFT-GUARDS: FINAL → GREEN_LIGHT
- Gilt nur für Head `1a1b5c0` auf Base `24d0f3e`. CI grün: Release Safety 37370697691, Agent Orchestration Safety 37370697742.
- Nach dem Merge muss jedes `v10-rNN`-Release-PR in denselben PR drei Felder mitziehen: Resume `build`, Live-Checkpoint `terminalBuild` und CHAT_HANDOFF `Build:`. `AGENT_STATE.lastCheckpoint` bleibt historisch und wird nicht angefasst.
- Für r116 heißt das: #557 in place rebasen und genau diese 3 Felder ergänzen.

### 0000. UI-UX-DEEP-AUDIT-R0 → ADVISORY_COMPLETE
- Backlog in #539 (Kommentar UI-UX-DEEP-AUDIT-R0). Empfohlenes r117-Bundle, nur Präsentation:
  1. iOS-Inputs ≥16px (aktuell 7px → Auto-Zoom)
  2. Liq-„STAGE SAFE“ (grün) neben „PROTECTION RISK“ entschärfen
  3. Preisquelle im Liq-Strip kennzeichnen
  4. Source-Chip für Nearest-FIB plus gleicher Referenzpreis
  5. Command-Top-Fold im PARTIAL-Zustand (NEXT ACTION liegt aktuell bei ca. 950px)
  6. Teilwert im Depot- und Command-Hero gleich anzeigen
  7. QA-Harness: `qaView` asset-detail/paper fallen still auf Command zurück; Font-Floor- und Parity-Tests ergänzen
- Danach r118: Typografie-Floor (aktuell bis 5px), Sprungleiste im Asset Detail (4117px).
- r116 ändert davon nichts; den Loading-Text in r116 nicht anfassen.

### 000. R116-REBASE-PREP-AUDIT-R0 → ADVISORY_COMPLETE (keine Merge-Autorität)
- Der frühere Review für #557 (Base f23fc2d) ist **nicht** mehr Merge-Autorität. Für den neuen r116-SHA ist ein neues Exact-Head-Review nötig.
- Keine Dateiüberschneidung zwischen #557 und main 24d0f3e; der Rebase ist konfliktfrei. Die 9 Dateien müssen byte-identisch zu `c67c07c` bleiben.
- **Lease-Falle:** Den #557-Branch in place aktualisieren. Ein neuer `v10-r116-*`-PR wird vom Release-Coordinator blockiert, solange #557 offen ist.
- **#558 zuerst:** Dann muss das r116-PR zusätzlich genau 4 Build-Felder auf r116 setzen (Resume `build`, Checkpoint `terminalBuild`, Agent-State `lastCheckpoint.build`, CHAT_HANDOFF „Build:“). Sonst schlägt continuity-audit fehl.
- **r116 zuerst:** Dann muss #558 diese 4 Felder beim Rebase nachziehen.
- Vor dem neuen Review optional zwei Tests ergänzen: Cross-Output-Mode/Window-Supersession und Detached-Output.

### 00. PR #555 STREAM-SAFE-V5: R3 → GREEN LIGHT
- Verdict: `REVIEW 48fd763d117e57d9d91ad42493bdcbe999870a3b: GREEN LIGHT` (Kommentar STREAM-SAFE-V5-IMPL-R3 in #539)
- Merge nur auf exakt `48fd763`. CI grün: Release Safety 37360886391, Agent Orchestration Safety 37360886467.
- Follow-ups (MINOR, nicht blockierend):
  1. `RESUME.coordination.maxVisibleBurstSeconds` steht noch auf 90 statt 45. Wert korrigieren und im Validator prüfen.
  2. Die Continuity-Audit gleicht `lastSubstantiveCheckpoint` / `lastContinuityMerge` nicht gegen `resume.sourceOfTruth.verifiedSha` ab. Außerdem prüft Release Safety nicht, ob `resume.build` zu `version.json` passt (Staleness nach r116).
  3. Bootstrap-Schritt 1 sagt „latest comment“. Besser: alle #539-Kommentare seit dem letzten Checkpoint plus alle offenen Requests lesen.

### 0. R116 FIB-CROSS-VIEW-LIFECYCLE: R1 (veraltet, Base f23fc2d)
- Verdict: `REVIEW c67c07cd38c132a44e634355b1f9a554d0118400: GREEN LIGHT` (Kommentar FIB-CROSS-VIEW-LIFECYCLE-R1 in #539)
- #556 ist geschlossen. Sein Release Safety ist nur am Branch-Namen-Gate gescheitert.
- Derselbe SHA ist als **#557** offen. Merge nur über #557 und nur auf exakt `c67c07c`.
- CI auf #557 grün: Release Safety 37360921196 (1477/1477), Portfolio Contract 37360921203, Visual QA 37360921119.
- NIT (optional): Ein überholter versteckter View zeigt weiter „werden berechnet …“, obwohl `aria-busy=false` ist. Optional einen neutralen Text setzen.

### 1a. PR #552 FIB-NEAREST-SYNC (r115): R2 → GREEN LIGHT
- Review: https://github.com/Achi1984/meridian/issues/539#issuecomment-6000698996
- Verdict: `REVIEW f7b8d3b704634dffd50741f88ca4431d896ee4bf: GREEN LIGHT`
- Merge ist **nur** auf exakt `f7b8d3b704634dffd50741f88ca4431d896ee4bf` erlaubt. Jeder weitere Commit macht das Verdict ungültig.
- Der R1-MAJOR (Async-Race) ist geschlossen. Mit einem Harness verifiziert: Out-of-order-Antworten, Fehlschlag des neuesten Laufs, MANUAL↔AUTO-Wechsel, Fenster-Wechsel, Mixed-Case-Symbole.
- NIT (optional): `fibRunSeq` ist über alle Views global. Ein überholter Forecast-Lauf lässt die versteckte Forecast-Map auf „lädt“ stehen. Das wird beim Navigieren geheilt (forced Render). Optional: zusätzlich ein Run-Token pro `out`-Element.
- Nach dem Merge `CROSS_MODEL_STATUS FIB-NEAREST-SYNC-R2` mit Merge-SHA posten.

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
