# Claude → ChatGPT Handover

Diese Datei wird von Claude (Reviewer) auf dem Branch `claude/handover` laufend überschrieben. Sie enthält immer den neuesten Stand.
Verbindlich bleibt die Mailbox in Issue #539. Diese Datei ist nur eine Zusammenfassung.
Der Branch wird nie gemergt und hat keinen Einfluss auf main, die Frozen-Pins oder die CI-Gates.

- last_update: 2026-10-05 17:55 Europe/Vienna
- reviewer: CLAUDE
- main_sha: 3360fb555b56a1abf72924ece6554ecbcfdd72a3

## Offene Aufgaben für ChatGPT (Priorität absteigend)

### 1. PR #549: R2 → REVISION REQUIRED (review_loop 2/3)
- Review: https://github.com/Achi1984/meridian/issues/539#issuecomment-5997996525
- reviewed HEAD: `d52b09343192b5433c73cd757792768907ebacb9`
- Verdict: `REVIEW d52b09343192b5433c73cd757792768907ebacb9: REVISION REQUIRED`

**MAJOR (AUTHORIZATION_BOUNDARY): Synthetic-Guard per Provenance-Rewrap umgehbar**
- `assertCrossVenueV2SyntheticSourceAllowed` prüft nur `expectedReceiptDigest`.
- Der Receipt-Digest enthält `provenanceDigest`, und `stable()` ignoriert nur `collectedAt`.
- Ein zusätzliches Provenance-Feld ergibt daher einen neuen, gültigen Digest bei byte-identischen Marktdaten.
- Fix: Zusätzlich ablehnen, wenn einer der vier `validation.receipt.dataDigests` oder der `integrityDigest` den kanonischen Pins entspricht. Die Pins stehen in `research/cross-venue-funding-edge-v2-source-evaluation.json` unter `digests`:
  - binanceFunding `442c4a68ef728ec42ccd0bedeb8a6c786e9ac9de573565d18aaaf9eb942ffef1`
  - okxFunding `f35f14e28c8d3093a7ceaceeb488f2b930f27530fed876936b3f5c8cfeeb2c9f`
  - binanceMarks `0a5679947c8bcd5562ef9aecded5eb36706fc33515e7821aeff6deaeb86e57a7`
  - okxMarks `ef7beb1a849710831c950cc561b90b7b80d3b0feb927bf7c966354cbde2c284b`
  - integrityDigest `0e0a7e1dc0b8ab616114d99ba7d475185b027caacdd1544d4ce06c8b2d9d4b07`
- Die Pins als Konstanten im Driver hinterlegen, ohne Datei-Read zur Laufzeit.
- Regression:
  - (a) Pure Helper `(receipt, pins)` mit synthetischen Pins testen: Ein Provenance-Rewrap wird abgelehnt, auch wenn nur ein einzelner Stream übereinstimmt.
  - (b) Statischer Test: Die Konstanten entsprechen `source-evaluation.json`.
  - (c) Normale synthetische Fixtures bleiben erlaubt.

**MINOR (CAUSAL_EVENT_ORDERING): Unvollständiger Terminal-Prefix**
- Die Terminal-Breaks im Hold-Loop (driver ~212-216) und vor EXIT_FILL (~233-236) rufen `appendTerminalPrefixSlotsThrough` nicht auf.
- Folge: Kausale COMMON_DECISIONs zwischen entryFill und Terminalität fehlen.
- Probe: aktive Spreads bei T-16h/T-8h/T/T+8h, Binance-Mark openTime T+9h entfernt. Dann fehlt COMMON_DECISION@T+8h, und `commonDecisions` ist um 1 zu niedrig.
- Fix: Auf beiden Branches `appendTerminalPrefixSlotsThrough(hour, hour+1)` bzw. `(exitFillAt, exitFillAt+1)` aufrufen und danach Terminalität erneut prüfen.
- Regression:
  - Probe-Fall: COMMON_DECISION@T+8h ist vorhanden, `commonDecisions` +1, Outcome unverändert.
  - Analoger Fall für Terminalität zwischen EXIT_DECISION und EXIT_FILL.

**Bestätigt OK (nicht erneut ändern):**
- 6-Datei-Scope, Blobs, Frozen-Guard-Pins
- Unveränderte V2-Dateien byte-identisch zu main
- CI grün: Release Safety 1454/1454, Source Gate grün, Collection SKIPPED
- Holdout-Exit-Fix korrekt, kein Lookahead (96/96 Sweep)
- `SPREAD_NOT_PERSISTENT` bei [+,+,-] ist frozen-korrekt
- Fake-Lock, kopiertes Handle und `syntheticOnly:'true'` werden abgelehnt
- Phase-Order unverändert

**Nächster Schritt:** Fixen, Frozen-Pins aktualisieren, exakte CI auf dem neuen HEAD abwarten. Danach in #539 posten:
- `CROSS_MODEL_STATUS CV2-STRATEGY-DRIVER-PR2-IMPL-R2` mit `status: REVISION_ADDRESSED`
- `CROSS_MODEL_REQUEST CV2-STRATEGY-DRIVER-PR2-IMPL-R3` (review_loop 3/3, neuer head_sha, neue Blobs, CI-Run-IDs)

### 2. Funding-Carry A: Kosten-Vorfilter → PASS_TO_DATA_DESIGN (eingeschränkt)
- Antwort: https://github.com/Achi1984/meridian/issues/539#issuecomment-5998023104
- Erlaubter Rahmen: Haltedauer ≥14d, Maker/Maker oder Maker/Taker, 1x–2x ohne geliehenes Spot.
- Base-Hurdle bei Maker/Taker: ca. 1,47 bp/8h bei 14d, ca. 0,77 bp/8h bei 30d.
- Vorab verworfen: alle 3d-Varianten, Taker/Taker unter 14d, 3x mit Borrow, Stress Taker/Taker.
- Nächster Schritt: nur `CROSS_MODEL_STATUS FUNDING-CARRY-A-COST-PREFILTER-R1` (ACK) posten.
- Ein Data-Design-Request erst nach #549 und nur mit ausdrücklicher Freigabe durch den User.

## Harte Grenzen (unverändert)
- kein canonical Source Read/Run
- keine kanonische Source→Events→Strategy→Runner-Ausführung
- kein PnL
- keine Discovery-, Validation-, Holdout-, Paper- oder Live-Freigabe bzw. kein Stage-Advance
- kein Merge ohne exaktes GREEN LIGHT auf dem aktuellen SHA
- keine Änderung der eingefrorenen V2-Regeln
- #549 hat Priorität
