# Claude → ChatGPT Handover

Diese Datei wird von Claude (Reviewer) auf dem Branch `claude/handover` nach jedem Review überschrieben. Sie enthält immer den neuesten Stand.
Verbindlich bleibt die Mailbox in Issue #539. Diese Datei ist nur eine Zusammenfassung.
Der Branch wird nie gemergt und hat keinen Einfluss auf main, die Frozen-Pins oder die CI-Gates.

- last_update: 2026-10-05 18:17 Europe/Vienna
- reviewer: CLAUDE
- main_sha: 3360fb555b56a1abf72924ece6554ecbcfdd72a3

## Offene Aufgaben für ChatGPT (Priorität absteigend)

### 1. PR #549: R3 → GREEN LIGHT (review_loop 3/3, abgeschlossen)
- Review: https://github.com/Achi1984/meridian/issues/539#issuecomment-5998407737
- Verdict: `REVIEW 70a2f943c6af6f8b60ac1ccaad5a1e5ddf3d4e4a: GREEN LIGHT`
- R2-Findings sind beide geschlossen:
  - MAJOR: Denylist für receipt, integrity und alle vier Stream-Digests
  - MINOR: Terminal-Prefix vollständig auf allen drei Branches
- Merge ist **nur** auf exakt `70a2f943c6af6f8b60ac1ccaad5a1e5ddf3d4e4a` erlaubt, und nur als synthetische Strategy-Adapter/Driver-Implementierung.
- Vor dem Merge prüfen:
  - PR-HEAD ist noch `70a2f94`
  - Base ist noch `3360fb5`
  - `mergeable=true`
- Jeder weitere Commit auf #549 macht das Verdict ungültig. Dann ist ein neuer Request nötig.
- Nach dem Merge: `CROSS_MODEL_STATUS CV2-STRATEGY-DRIVER-PR2-IMPL-R3` mit Merge-SHA posten.

### 2. Funding-Carry A: Kosten-Vorfilter → PASS_TO_DATA_DESIGN (eingeschränkt), von ChatGPT bestätigt
- Antwort: https://github.com/Achi1984/meridian/issues/539#issuecomment-5998023104
- Erlaubter Rahmen: Haltedauer ≥14d, Maker/Maker oder Maker/Taker, 1x–2x ohne geliehenes Spot.
- Base-Hurdle bei Maker/Taker: ca. 1,47 bp/8h bei 14d, ca. 0,77 bp/8h bei 30d.
- Ein Data-Design-Request erst nach dem #549-Merge und nur mit ausdrücklicher Freigabe durch den User.

## Was nach #549 noch NICHT freigegeben ist
- canonical Source→Events→Strategy→Runner-Ausführung
- PnL
- Discovery-, Validation-, Holdout-, Paper- oder Live-Freigabe und jede Stage- oder Lock-Änderung

Für jeden dieser Schritte braucht es einen eigenen Request und eine ausdrückliche Freigabe durch den User.

## Harte Grenzen (unverändert)
- kein canonical Source Read/Run
- kein PnL
- keine Discovery-Freigabe und kein Stage-Advance
- kein Merge ohne exaktes GREEN LIGHT auf dem aktuellen SHA
- keine Änderung der eingefrorenen V2-Regeln
