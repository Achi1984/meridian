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
3. Claude liest den vollständigen angeforderten Scope am exakten PR-HEAD-SHA; der Lead fragt erst nach grüner Exact-Head-CI an. Jedes GREEN_LIGHT muss einen Abschnitt `Executed checks` mit den tatsächlich ausgeführten read-only Befehlen und Ergebnissen enthalten. Kann ein für Scope/Request verpflichtender Check nicht laufen, ist GREEN_LIGHT verboten; Ergebnis ist NEEDS_MORE_EVIDENCE mit Begründung; nachgewiesene Codefehler erhalten REVISION_REQUIRED.
4. Merge nur bei grüner CI und GREEN_LIGHT auf genau diesem SHA. Neuer Commit = altes GREEN_LIGHT ungültig.
5. Trivial (Text, Tests, CI-Fix ohne Research-Logik) kann ohne Cross-Model-Review bleiben. Datenvertrag, Source Receipt, Split/Stage-Lock, Accounting, Strategy-PnL, Stage-Übergänge sowie Agenten-Spielregeln/Workflow-Berechtigungen sind nie trivial und reviewpflichtig.
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
- Verbindliche Mailbox ist `MERIDIAN_LIVE_CHECKPOINT.json.mailboxIssue`; Ziel dieses Kandidaten **#639**, vor dessen freigegebenem Merge weiterhin **#571**.
- Mailbox-Inhalt: nur `CROSS_MODEL_REQUEST`, `CROSS_MODEL_RESPONSE`, `CROSS_MODEL_STATUS NEEDS_USER_DECISION` und finale Merge-Status. INTENT/Fortschritt lebt pro aktivem PR in genau einem editierten Statuskommentar.
- Rollover bei >200 Kommentaren: Nachfolger anlegen, Workflow-Trigger + `mailboxIssue` gemeinsam per reviewed Infra-PR umstellen, Smoke im Nachfolger, dann Vorgänger schließen.
- Claude bleibt reviewer-only: `contents/pull-requests/actions: read`; `issues: write` nur für die angeforderte Review-Antwort und das Update des exakt im Checkpoint gepinnten Watchdog-Statuskommentars. Edit/Write, Commit/Push/PR/Merge, Locks/Stages und Workflow-Dispatch bleiben verboten.
- Erlaubte read-only Prüfung: `gh api` zur Prüfung nur GET; einzige Watchdog-Ausnahme ist PATCH des zuvor validierten, im Checkpoint gepinnten Statuskommentars, `gh pr view/diff`, `gh run view`, Git-Inspektion, `node --test`, Continuity Audit, Frozen Guard und Orchestration Validator.
- `CLAUDE_CODE_OAUTH_TOKEN` muss vorhanden sein; ohne Secret fail-closed. ChatGPT bleibt Lead/Merge-Owner.

## 8. Automatischer Mailbox-Loop
1. Lead liest `mailboxIssue` aus dem Live Checkpoint und postet dort `@claude CROSS_MODEL_REQUEST <id>`.
2. Workflow startet nur für diese Mailbox, `Achi1984` und `CROSS_MODEL_REQUEST`.
3. Claude prüft exakten SHA/Base, CI und relevante lokale read-only Tests/Audits und postet `CROSS_MODEL_RESPONSE <id>` in derselben Mailbox.
4. Jeder neue Commit invalidiert ein früheres GREEN_LIGHT.
5. User-Eingriff bleibt nur für explizite Hard-Gate-Entscheidungen nötig.



## Housekeeping contract

The owner housekeeping contract in `MERIDIAN_GO.md` is binding: canonical verdicts, full-scope and exact-head-CI review gates, in-place decision resolution, real read-only credential preflight, separate recovery/retry approvals, and merge-block handoff refresh. The proposed mailbox639 route activates only after concrete owner-approved merge;571 remains binding until then. Watchdog status uses the checkpoint-pinned single comment, separate from requested review responses. WIP maximum3active work packages is approved by owner2026-10-15T20:16:49+02:00, decision6199107184.
