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
- Claude hat aktuell nur Lesezugriff (Push und PR-Kommentare: HTTP 403). Claude liefert Reviews im Chat; der User leitet sie an den Lead weiter, der sie wörtlich als PR-Kommentar mit Quelle `Claude review` übernimmt.
- Für einen Lead-Wechsel zu Claude ist die Claude GitHub App mit Schreibrechten zwingend.
