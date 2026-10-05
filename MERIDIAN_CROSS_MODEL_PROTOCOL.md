# MERIDIAN — Cross-Model Protocol (ChatGPT ⇄ Claude)

Ergänzt `MERIDIAN_ORCHESTRATION.md` (Single-Writer) und `MERIDIAN_AGENT_WORKFLOW.md` (Main/Sub/Review). Gilt, sobald zwei Modelle am selben Repo arbeiten können.

## 1. Grundsatz: genau ein Lead
- Zu jedem Zeitpunkt gibt es genau einen Lead, eingetragen in `MERIDIAN_LEAD_LEASE.json` auf `main`.
- Nur der Lead darf: Implementierungs-Branches anlegen, PRs öffnen/aktualisieren/mergen, `MERIDIAN_RESUME.json`, `MERIDIAN_HANDOFF.md` sowie Decision-/Lock-Files ändern, Research-Stages im Rahmen der preregistrierten Regeln freigeben.
- Das andere Modell ist Sub-Agent: nie Push auf `main`, nie Merge, nie Lock-Änderung.

## 2. Rollen
| Rolle | Modell | Darf |
|---|---|---|
| Lead / Orchestrator / Implementation | ChatGPT | alles aus Abschnitt 1 |
| Independent Review + Research + QA | Claude | lesen, Tests lokal ausführen, Reviews liefern, `review/*`-Branches nur auf Anweisung des Leads |

Begründung: Der Review muss unabhängig sein; ein zweites Modell findet systematisch andere Fehler (Look-ahead, Accounting, Datenlecks). Rollentausch nur per Lease-Wechsel (Abschnitt 4).

## 3. Ablauf pro Änderung
1. Lead prüft vor jedem Write `main`-SHA und offene PRs.
2. Lead öffnet PR mit: Ziel, Research-Stage, PnL berührt (ja/nein), `Review requested: Claude`.
3. Claude reviewt den exakten PR-HEAD-SHA: `REVIEW <SHA>: GREEN LIGHT` oder `REVIEW <SHA>: REVISION REQUIRED` (Befund, Schwere, Beleg, geforderter Test).
4. Merge nur bei grüner CI und GREEN LIGHT auf genau diesem SHA. Neuer Commit = altes GREEN LIGHT ungültig.
5. Trivial (Text, Tests, CI-Fix ohne Research-Logik): Merge ohne Cross-Model-Review erlaubt, im PR `Cross-model review: skipped (trivial)` vermerken. Datenvertrag, Source Receipt, Split/Stage-Lock, Accounting, Strategy-PnL, Stage-Übergänge: Review Pflicht.
6. Max. 3 Review-Loops, danach entscheidet der User.

## 4. Lead-Wechsel (Lease)
1. Alter Lead hat keine offene Mutation mehr (oder offene PRs sind im Handoff ausdrücklich übergeben).
2. Alter Lead schreibt `MERIDIAN CROSS-MODEL HANDOFF` in `MERIDIAN_HANDOFF.md` und setzt im Lease `status: RELEASED`, `releasedAtMainSha`, `nextLead`.
3. Neuer Lead prüft: main-SHA == `releasedAtMainSha` (sonst abgleichen); keine laufenden Actions auf Branches des alten Leads.
4. Neuer Lead setzt per eigenem kleinem PR `status: HELD`, `lead`, `acquiredAtMainSha`. Erst dann arbeiten.
Notfall: Ist der Lead nicht erreichbar, darf nur der User den Lease überschreiben („Du bist jetzt Lead“).

## 5. Konfliktregeln
- Keine zwei offenen PRs zum selben Research-Strang. Der Sub-Agent meldet Befunde als Review, nicht als eigenen Fix-PR.
- Kritischer Fehler auf `main` durch Sub-Agent gefunden → Issue `cross-model-blocker`; Lead behandelt es vor jeder weiteren Research-Stage.
- Chat vs. Repo: Repo gilt.
- Modelle uneinig in Research-Frage: strengere (fail-closed) Auslegung, bis der User entscheidet.

## 6. User-Kommandos
- Normalbetrieb: nichts.
- „Claude, review PR #N“ → Review.
- „Übergib an Claude/ChatGPT“ → Abschnitt 4.

## 7. Technische Voraussetzungen
- Verbindliche Cross-Model-Mailbox ist GitHub Issue **#539**. Claude darf dort Review-Antworten kommentieren; diese Kommentare sind Koordination/Evidenz und ersetzen nie `main`, exakte PR-HEAD-Prüfung oder CI.
- Nach Merge von `.github/workflows/claude-mailbox-review.yml` kann der Lead Claude ohne User-Relay auslösen, indem ein neuer Kommentar in #539 von `Achi1984` sowohl `@claude` als auch `CROSS_MODEL_REQUEST` enthält.
- Der Workflow ist absichtlich Reviewer-only: `contents: read`, `pull-requests: read`, `actions: read`, nur `issues: write` für die Review-Antwort. Claude darf keine Dateien editieren, keinen Commit/Push/PR/Merge erzeugen, keine Locks/Stages ändern und keine Workflows dispatchen.
- Für die Action muss das Repository-Secret `CLAUDE_CODE_OAUTH_TOKEN` vorhanden sein. Ohne Secret scheitert der Workflow fail-closed vor dem Reviewer-Lauf.
- Die Lead-Lease-Regeln bleiben unverändert: ChatGPT ist Lead und alleiniger Merge-Owner. Ein Lead-Wechsel zu Claude benötigt weiterhin den formalen Lease-Wechsel aus Abschnitt 4.

## 8. Automatischer Mailbox-Loop
1. ChatGPT postet `@claude CROSS_MODEL_REQUEST <id>` in #539.
2. Der GitHub-Workflow startet Claude nur für den eng definierten #539/Achi1984-Trigger.
3. Claude prüft den exakten angeforderten SHA read-only und postet `CROSS_MODEL_RESPONSE <id>` in #539.
4. ChatGPT liest #539 als verbindliche Mailbox, verarbeitet GREEN/REVISION_REQUIRED und führt nur bereits autorisierte Schritte aus.
5. Jeder neue Commit invalidiert ein vorheriges GREEN LIGHT. Kein Workflow darf diese Exact-Head-Regel umgehen.
6. User-Eingriff bleibt nur für Entscheidungen/Freigaben nötig, die laut Hard Gates ausdrücklich beim User liegen.
