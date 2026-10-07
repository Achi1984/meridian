# MERIDIAN – Chat-Übergabe / Live-Reconciliation-Paket
**Stand:** 2026-10-07, Abend (Europa/Wien). **Dieses Dokument ist eine Momentaufnahme – vor JEDEM neuen Arbeitsschritt GitHub live prüfen.**
**Auftrag:** Alle relevanten Entscheidungen, Arbeitsstände und nächsten Schritte für die nahtlose Fortsetzung in einem neuen Chat sichern. Dieses Dokument ist **keine** neue Release-Freigabe und kein Ersatz für den aktuellen Repo-State.

## 1. Start im neuen Chat
Der User schreibt am besten:
> **Go Meridian. Lies zuerst GitHub Issue #571 (neueste Kommentare), MERIDIAN_LIVE_CHECKPOINT.json, dieses Handover-Dokument und MERIDIAN_GO.md. Reconcile live main, version.json, PR #599, exakte CI/Visual QA. Führe den nächsten sicheren Entwicklungsschritt autonom aus. Melde dich nur bei Entscheidungen mit Einfluss auf Richtung, Sicherheit, Kosten oder Freigaben. Stündlichen Autopilot/Watchdog-Wunsch berücksichtigen. Keine Live-Trades.**

GitHub repo: https://github.com/Achi1984/meridian
Canonical mailbox (nicht altes #539!): https://github.com/Achi1984/meridian/issues/571
Produktbrief Command Pro: https://github.com/Achi1984/meridian/issues/596
Command-Pro-Draft: https://github.com/Achi1984/meridian/pull/599
Aktueller Docs-/Kommunikations-Branch: `process/meridian-low-noise-decisions-only-v1`.
Grundregeln: `MERIDIAN_GO.md`, `MERIDIAN_AGENT_WORKFLOW.md`, `MERIDIAN_LIVE_CHECKPOINT.json`, `version.json`. Die Defaults auf main können hinsichtlich der neuesten Entscheidungs-Kommunikationsregel noch veraltet sein.

## 2. Nutzerauftrag / Product Owner
- ChatGPT ist Lead-Architekt, Hauptentwickler, Produktverantwortlicher und **alleiniger Merge-Owner**; Claude ist unabhängiger **read-only** Cross-Model-Reviewer und Challenger. Claude darf außerhalb der angeforderten Antwort in #571 nicht schreiben, mergen oder technische Änderungen vornehmen.
- Ziel: eine verlässliche, optisch professionelle MERIDIAN Command-/Trading-Analyseoberfläche, mit korrekt validierten Portfolio-/Bot-/Marktdaten, FIB/SK, Edge-/Paper-Entwicklung, produktiven Sicherheitsgates; keine Freigabe für Live-Orders.
- Nutzer möchte große, eigenständige Entwicklungsschritte. **Nicht für jeden Fehler, Test, CI-Ausfall, Fortschrittsstand oder Claude-Revisionswunsch unterbrechen.** Nur Entscheidungen zu Entwicklungsrichtung, Architektur, Produktumfang/Priorität, Safety/Trust, Kosten, externen Services, Autonomieregeln, Release-Ausnahmen, Research-/Trading-Freigaben vorlegen.
- Entscheidungen-only-Kommunikation explizit genehmigt: Mailbox #571 Kommentar **6045216366**, `MERIDIAN-USER-COMMUNICATION-V2`. Im Kommunikationsbranch ist `MERIDIAN_GO.md` dazu bereits geändert (Commit `8c385d08640c75bfa4c4ca59ede1dec3096f0370`); `MERIDIAN_AGENT_WORKFLOW.md` wurde noch **nicht** entsprechend angepasst, es gibt noch keinen geprüften/mergten Docs-PR.
- Keine falsche Zusage, dass eine offene Chat-Unterhaltung 24/7 weiterläuft. Tatsächlich autonom können separat eingerichtete ChatGPT-Automationen/GitHub Actions laufen. User will sichtbaren Status auf Abruf, aber keine Routine-Pushes.

## 3. Bestätigter GitHub-Live-Stand vor dieser Übergabe
- main SHA: `96e41f20da4fba8f4ea1db73bb9d5c957dc97786` (R131 Merge-Commit).
- Produktiver Terminal-Build in main: **`10.0-r127`**; nicht als R132 deployed bezeichnen.
- R131 / PR #597 ist **gemerged**, Claude GREEN_LIGHT auf exaktem Head `59faa06133304d01aaffb2171eb41af7f335866d`, Post-Merge Kern-Gates inklusive Pages/Runtime grün. R131 führte Market-State/Freshness-Unterbau ein. **Qualitäts-Nacharbeit:** Die in R131 geänderten sechs Legacy-Testdateien und das Regression-Script lückenlos auf Invarianten-Abschwächung auditieren; 30s Future-Timestamp-Toleranz dokumentieren.
- R132 / PR #599: Branch `r132-command-pro-ui-v1`, **OPEN / Draft**, letzter verifizierter Head `fcbf87c6c2426949342620fa7916617e7eb09c8b`, Base `96e41f20da4fba8f4ea1db73bb9d5c957dc97786`, nicht hinter main, mergeable. **Kein Merge / keine Release-Freigabe / kein terminalBuild-Bump.**
- PR #599 geändert (6 Dateien): `v10/v10.js`, `v10/v10.css`, `test/r132-command-pro-browser.test.js`, `test/v10-r120-command-decision-hierarchy.test.js`, `test/v10-r117-ui-trust-bundle.test.js`, `scripts/v10-ui-regression-check.mjs`.
- Exakte R132 Release Safety auf Head `fcbf87c6`: Run **37673750106**, **1781/1789 Tests bestanden, 8 fehlgeschlagen**. Acht verbleibende Tests (alte R120-/R117-Prüfungen sind inzwischen grün):
  1. r13: legacy bridge unknown USD exposure / idempotent Command
  2. r59: legacy repaint duplicates
  3. r79: Action Hub render/binding/NEXT ACTION
  4. r91: source provenance/strip
  5. r92: Next/Open/Attention decision surfaces
  6. r93: portfolio hero before data state + missing authority fail closed
  7. r96: collapsed diagnostics after live risk
  8. Smart Terminal R2: critical asset and guarded Next Action ahead of legacy risk
- Exakte R132 Visual QA: Run **37673750100**, **FAILURE**; nicht als pass behaupten. Noch separat aus dem Job die konkreten Layout-Invarianten/Telefon-Captures auswerten. Tests/CI nie durch Löschung oder Abschwächung von Safety-Asserts grün „färben“.
- R132 Chrome-Akzeptanztest in `test/r132-command-pro-browser.test.js`: echtes Headless-Chrome, **20 Render-/Navigation-/Zeitraumwechsel-Zyklen** auf 320/375/390/430 px und gesondert 390 px stale; prüft Owner=1, Portfolio Details=1, source disclosure, verified danger precedence, unknown statt falscher 0, Touchflächen, Overflow, Fokus. War im letzten grünen Teil der Release-Safety-Prüfungen; bei jeder Änderung erneut exakte CI verlangen.

## 4. R132 implementiertes Produktkonzept und wichtige Fixes
Produktvertrag Issue #596:
- **Eine** Karte „JETZT WICHTIG“ statt dreier konkurrierender STATUS/NEXT ACTION/ATTENTION-Oberflächen, mit Ursache, Evidenz, Konsequenz und einem ungefährlichen Navigationsbutton.
- **Gesamtportfolio** aus kanonischer Authority, fehlende Quelle = „—“ / bekannter Teilwert ausdrücklich NICHT Gesamtwert. Valide 1h/1d/1w-Historie, niemals erfundene Rendite/Kurve.
- **Verifizierte kritische Kapitalgefahr darf VOR** den Portfolio-Hero; sonst Portfolio zuerst. Höchstens drei priorisierte Risikozeilen, Ranking aus bestehender Bot-/Safety-Domäne, nicht nur Liquidationsdistanz.
- Separate kompakte Statusfelder Kapitalrisiko/Datenlage/Aktualisierung. Datenquellen, diagnostische Technik, Wallet-/Futures-Authority und Wartungsdetails in **einem** aufklappbaren „DATEN & QUELLEN“. Portfolio Details genau einmal, Controls/Acknowledgements erreichbar. Optionales Paper nicht als autorisiert ausgeben.
- Mobile 320/375/390/430, touch >=44px, robuste Degraded/Stale-/Refresh-/Navigation-/Reload-Zustände, fail-closed bei fehlender Quellgültigkeit.
R132 besitzt native `commandProModel`, `commandProDecisionHtml`, `commandProHealthHtml`, `commandProRiskHtml`, `commandProNavigationHtml`, `renderCommand`.
Veröffentlichte Korrekturen:
- Command-Button-Selector: `$()` (querySelector) versus `$$()` (querySelectorAll) – ein `forEach` auf `$()` war Laufzeitfehler. Vorsicht: String-`.replace` behandelt `$$` als Escape; bei Codeänderungen `.replace(old,()=>replacement)` verwenden.
- R132 CSS auf native Komponenten, Smartphone-Floors, scoped Order: R132-Regeln **vor** R125/R126/Stage2, sodass die alten CSS-Scope-Tests intakt bleiben.
- Portfolio range-switch darf keinen neuen eingebetteten Details-Klon erzeugen; Disclosure/Fokus erhalten.
- Command-Disclosure-State `commandProDisclosureState` über 20 Wechsel und v9-Repaints erhalten; alte duplizierte Details vor neuer Zeichnung entfernen.
- R117+ und R120+ Tests haben **zusätzliche, strengere R132-Successor-Prüfpfade** unter Erhalt der alten Bedingungen; Browserabdeckung referenziert.
- Letzter Commit `fcbf87c6` migrierte das zentrale `scripts/v10-ui-regression-check.mjs` auf R132-Successor-Ownership, ohne alte Guards bei älteren Releases zu entfernen. Resultat: 8 andere Legacy-Tests noch rot.
- Vermeide Statusmeldung „UI fehlerfrei“ bevor die gesamte Release Safety + Visual QA + unabhängige exakte Claude-Review bestanden sind.

## 5. Weiterarbeit R132 (nächste autonome Schritte)
1. Wieder Live-State-Reconciliation (nicht blind alten Head verwenden): #571 Mailbox-Tail, Checkpoint, live main, version, PR #599, genaue CI-Run-IDs, Konkurrenz-/Release-Lease, nur relevante offene PRs.
2. Die **acht** oben aufgeführten alten DOM-/String-Vertragsprüfungen sorgfältig **nach alter Sicherheitsabsicht** auf den R132-Successor umstellen: eine echte R132-Option plus alte Assertions bei älteren Layouts; nicht einfach abschalten. Guards für Risk Rank, Freshness, negative/missing Authority, Fail-Closed, Readonly, Legacy-Controls, 20 cycles und UI-Laufzeit beibehalten bzw. verstärken. Ein File/eine Repo-Mutation pro Chat-Turn.
3. Visual QA FAILURE `37673750100` konkret analysieren. Die R122-/R123-Adapter hängen an alter COMMAND-Struktur; bei R132 nicht irrtümlich Legacy-Präsentation erzwingen. Browser-Layout/Navigation/Hit-Targets/critical precedence ehrlich prüfen. Screenshot- und reale Chrome-Invarianten für R132 ergänzen.
4. Nach exakter vollständiger GREEN CI und Browser/Visual QA über **aktuellem** PR-Head: finalen Diff, Legacy-Assertion-Audit und echte Autoritätsregeln prüfen; **erst dann** unabhängigen `@claude CROSS_MODEL_REQUEST` in Issue #571 für diesen exakten SHA schicken (kein Duplikat, Claude read-only). Ein Request zählt als eine Mutation, dann Chat-Turn beenden.
5. Nach Claude GREEN_LIGHT auf identischem Head, Release-Identität/Single-Writer/UTC-Tagescadence überprüfen; bei benötigtem Sonder-Release explizite Nutzerentscheidung. Erst danach Merge mit `expected_head_sha`, Post-Merge Runtime/Pages/Safety prüfen. Der UI-Entwicklungsstand darf R127 nicht als R132 „ausliefern“, bevor ein gültiger R132 Release Candidate angelegt ist.
6. Kein ungeprüftes paralleles Ops/Research/Release-Merge.

## 6. Autopilot: **stündlich**, Benachrichtigungen nur bei Richtungsentscheidungen
Zuletzt eingegangene und ausdrücklich dokumentierte Nutzervorgabe: „Go und wir müssen den Automatismus nur alle 1h verkürzen“.
Autoritative Freigabe #571 Kommentar **6045685684**, `MERIDIAN-HOURLY-ONLY-AUTOMATION-V1`.
- Die existierende ChatGPT-Automation **„Meridian Autopilot“ war bereits ENABLED und `RRULE:FREQ=HOURLY`**, mit geplantem Ziel ungefähr **:27**. Letzter dokumentierter Lauf 2026-10-07 19:30:34 UTC. **Keine doppelte oder häufigere ChatGPT-Automation anlegen.**
- Die GitHub-Datei `.github/workflows/claude-watchdog-15m.yml` hat bereits `cron: '57 * * * *'` (stündlich um :57) **ABER zusätzlich** einen `workflow_run`-Trigger bei erfolgreicher Release Safety. Das kann Extra-Runs innerhalb einer Stunde auslösen.
- Genehmigte technische Änderung **noch nicht umgesetzt:** In separatem Ops-PR `workflow_run`-getriebene extra Invocations entfernen/unterdrücken; `workflow_dispatch` erhalten, exakte Claude-Mailbox-Review-Prozesse erhalten, Quota-Schutz und Fingerprinting nicht schwächen. Vor Merge vollständige Tests/CI, Claude exact-head Review, dokumentierte Benutzerfreigabe. Nicht mit R132 kombinieren.
- **Activity Monitor** ebenfalls genehmigter separater read-only Scope: letzte tatsächliche Autopilot-/Claude-Watchdog-Ausführung, offener PR+Head, CI/Review und nächstes Checkpoint; RUNNING/WAITING/FAILED/STALE/UNKNOWN korrekt trennen. **Noch nicht als implementiert behaupten.** Nur auf Abruf, keine Routine-Pushs.
- ChatGPT-/GitHub-Cron-Delivery ist best effort, keine garantierte Minute. Kein Hintergrund-Chatarbeit-Versprechen.

## 7. Governance / unveränderliche Gates
- Pro sichtbarem User-/Agent-Turn unter **STREAM-SAFE-V7 maximal EINE Repo-Mutation**, danach Checkpoint und STOP. Kein heimliches Multi-Commit oder endloses Tool-/Poll-Loop. Nach Streaming-Abbruch immer OP_APPLIED/OP_ABSENT/OP_CONFLICT/WAITING/BLOCKED_STREAM anhand GitHub einordnen; nichts blind wiederholen.
- Branch-Head und Blob-SHA vor Writes abgleichen; `op-id`, begrenzte Quellen/Logs, transport-preflight `maxSourceFileBytes=262144`, `maxSerializedUploadBytes=393216` und Read-back-Verify einhalten.
- Mailbox nur für CROSS_MODEL_REQUEST/RESPONSE, NEEDS_USER_DECISION, FINAL_MERGE_STATUS; normale Fortschritts- und CI-Informationen im PR-local Status und Actions, nicht als separate Chat-Nachricht.
- Claude darf nicht mergen/ändern, ChatGPT bleibt Merge-Owner. Kein Merge ohne exaktem Head/Base, grünem CI, unabhängiger Claude-Review und Release-Lease/UTC-Cadence-Disziplin (max 1 normale UI-Auslieferung pro Tag, außer echte bugfix/trust/safety-Ausnahme oder explizit einzeln genehmigter Scope).
- `CROSS_VENUE_FUNDING_EDGE_V2` weiterhin **SOURCE_AUDIT** und Synthetic Pipeline FROZEN; `canonicalExecutionAuthorized=false`, `strategyPnlAuthorized=false`, `discoveryAuthorized=false`, `validationAuthorized=false`, `holdoutAuthorized=false`, `paperAuthorized=false`, `liveAuthorized=false`. Keine PnL-Strategieausführung, Discovery, Paper-Umstellung oder Live-Orders ohne eigenständiges Gate.
- Repo-Priorität: QUALITY > SPEED; EVIDENCE > ASSUMPTIONS; CLARITY > FEATURE COUNT; RISK > PROFIT.

## 8. Prozess-/Kommunikations-Branch nach Übergabe
- Branch: `process/meridian-low-noise-decisions-only-v1`, Start auf Main SHA `96e41f20da4fba8f4ea1db73bb9d5c957dc97786`. Bereits existierender HEAD vor Erstellung dieser Datei: `8c385d08640c75bfa4c4ca59ede1dec3096f0370`, darin `MERIDIAN_GO.md` mit „decision-only communication“ geändert.
- Es fehlt noch die korrespondierende Anpassung von `MERIDIAN_AGENT_WORKFLOW.md` §16 und STREAM-SAFE Reporting-Wortlaut sowie ein eigenständiger docs-only PR, CI und Claude-Review. Nicht unreviewt direkt auf main mergen.
- Dieses Handover gehört zu diesem Branch. **Dokumentation ist nicht gleich Release-Freigabe.**
- Falls im neuen Chat diese Datei bereits existiert: nicht erneut erstellen; nur live aktualisieren, wenn sich wichtige Tatsachen nachweislich geändert haben.

## 9. Kontext weiterer Entwicklungsziele
MERIDIAN soll schrittweise ein vertrauenswürdiges Trading-Analyse-/Paper-Bot-System liefern: Asset Watch mit aufklappbaren Karten, korrekte Portfolio-Gesamtsumme und 1h/1d/1w-Chart, SAFE/WATCH/DANGER mit konservativem Puffer, Bot-Performance-/Gebührenanalyse, ROI/Drawdown, Opportunity Scanner, FIB-Level-Rechner, Trendwendezonen, SK-System, Hedge-/Trailing-Regeln, profitables **isoliertes Paper-Trading vor jeder API/Live-Integration**. Bei tatsächlichem Börsen-/Bot-Review immer Live-Evidenz/Screenshots und mehrere Quellen; keine stale Werte als aktuelle Autorität ausgeben.

**Kompaktes nächstes Startsignal:** `Go Meridian – Übergabe lesen; R132 PR #599 und stündlichen Autopilot/Watchdog-Prozess autonom fortsetzen, nur bei Richtungsentscheidungen melden.`
