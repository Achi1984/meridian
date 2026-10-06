from pathlib import Path

p=Path("MERIDIAN_CROSS_MODEL_PROTOCOL.md")
s=p.read_text()
m="## 7. Technische Voraussetzungen\n"
assert s.count(m)==1
tail="""## 7. Technische Voraussetzungen
- Verbindliche Mailbox ist `MERIDIAN_LIVE_CHECKPOINT.json.mailboxIssue`; aktuell **#571**. #539 ist Vorgänger und wird erst nach erfolgreichem R5-Smoke archiviert.
- Mailbox-Inhalt: nur `CROSS_MODEL_REQUEST`, `CROSS_MODEL_RESPONSE`, `CROSS_MODEL_STATUS NEEDS_USER_DECISION` und finale Merge-Status. INTENT/Fortschritt lebt pro aktivem PR in genau einem editierten Statuskommentar.
- Rollover bei >200 Kommentaren: Nachfolger anlegen, Workflow-Trigger + `mailboxIssue` gemeinsam per reviewed Infra-PR umstellen, Smoke im Nachfolger, dann Vorgänger schließen.
- Claude bleibt reviewer-only: `contents/pull-requests/actions: read`; `issues: write` nur für die Review-Antwort. Edit/Write, Commit/Push/PR/Merge, Locks/Stages und Workflow-Dispatch bleiben verboten.
- Erlaubte read-only Prüfung: `gh api` nur GET, `gh pr view/diff`, `gh run view`, Git-Inspektion, `node --test`, Continuity Audit, Frozen Guard und Orchestration Validator.
- `CLAUDE_CODE_OAUTH_TOKEN` muss vorhanden sein; ohne Secret fail-closed. ChatGPT bleibt Lead/Merge-Owner.

## 8. Automatischer Mailbox-Loop
1. Lead liest `mailboxIssue` aus dem Live Checkpoint und postet dort `@claude CROSS_MODEL_REQUEST <id>`.
2. Workflow startet nur für diese Mailbox, `Achi1984` und `CROSS_MODEL_REQUEST`.
3. Claude prüft exakten SHA/Base, CI und relevante lokale read-only Tests/Audits und postet `CROSS_MODEL_RESPONSE <id>` in derselben Mailbox.
4. Jeder neue Commit invalidiert ein früheres GREEN LIGHT.
5. User-Eingriff bleibt nur für explizite Hard-Gate-Entscheidungen nötig.
"""
p.write_text(s.split(m)[0]+tail)

p=Path("MERIDIAN_AGENT_STATE.json"); s=p.read_text()
a='"recoveryMode": "READ_539_THEN_COMPACT_CHECKPOINT_THEN_LIVE_MAIN_PRS_CI"'
b='"recoveryMode": "READ_CHECKPOINT_MAILBOX_THEN_COMPACT_CHECKPOINT_THEN_LIVE_MAIN_PRS_CI"'
assert s.count(a)==1; s=s.replace(a,b)
a='Read Issue #539 comments since the last checkpoint and all open CROSS_MODEL_REQUEST / REVISION_REQUIRED items'
b='Read mailboxIssue from MERIDIAN_LIVE_CHECKPOINT.json, then read that mailbox since the last checkpoint and all open CROSS_MODEL_REQUEST / REVISION_REQUIRED items'
assert s.count(a)==1; p.write_text(s.replace(a,b))

p=Path("docs/MERIDIAN_CHAT_HANDOFF.md"); s=p.read_text()
a='Claude mailbox bridge: **merged via #550; reviewer-only Issue #539 loop active**'
b='Claude mailbox bridge: **merged via #550; active mailbox resolves from MERIDIAN_LIVE_CHECKPOINT.mailboxIssue (R5 #571)**'
assert s.count(a)==1; s=s.replace(a,b)
a='Before every Meridian step, read Issue #539 first; then reconcile latest merged `main`, CI, `MERIDIAN_RESUME.json`, `MERIDIAN_AGENT_STATE.json`, and related PRs before any mutation.'
b='Before every Meridian step, resolve `mailboxIssue` from `MERIDIAN_LIVE_CHECKPOINT.json`, read that mailbox first, then reconcile latest merged `main`, CI, `MERIDIAN_RESUME.json`, `MERIDIAN_AGENT_STATE.json`, and related PRs before any mutation.'
assert s.count(a)==1; p.write_text(s.replace(a,b))
