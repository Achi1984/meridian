import json
import re
from pathlib import Path

WORKFLOW = Path(".github/workflows/claude-mailbox-review.yml")
CHECKPOINT = Path("MERIDIAN_LIVE_CHECKPOINT.json")
# Mailbox routing is intentionally derived from the durable live checkpoint.
text = WORKFLOW.read_text(encoding="utf-8")
checkpoint = json.loads(CHECKPOINT.read_text(encoding="utf-8"))
mailbox_issue = int(checkpoint["mailboxIssue"])

allowed_tools = (
    '--allowedTools "Bash(gh api:*),Bash(gh issue view:*),Bash(gh pr view:*),Bash(gh pr diff:*),'
    'Bash(gh run view:*),Bash(git:*),Bash(node --test:*),'
    'Bash(node scripts/continuity-audit.mjs),'
    'Bash(node scripts/frozen-research-guard.mjs),'
    'Bash(python3 scripts/validate-agent-orchestration.py)"'
)

required = [
    "issue_comment:", "types: [created]",
    f"github.event.issue.number == {mailbox_issue}",
    "github.event.comment.user.login == 'Achi1984'",
    "contains(github.event.comment.body, '@claude')",
    "contains(github.event.comment.body, 'CROSS_MODEL_REQUEST')",
    "contents: read", "issues: write", "pull-requests: read", "actions: read",
    "anthropics/claude-code-action@v1", "CLAUDE_CODE_OAUTH_TOKEN",
    "Missing repository secret CLAUDE_CODE_OAUTH_TOKEN", "timeout-minutes: 35",
    "include_fix_links: false", "--disallowedTools Edit,Write", allowed_tools,
    "MERIDIAN REVIEWER-ONLY MODE", f"Issue #{mailbox_issue} is the binding mailbox",
    "gh api must not use POST/PATCH/PUT/DELETE",
    "git must not checkout/switch/reset/clean/add/commit/rebase/merge/push/tag",
    "CHATGPT is Lead and sole merge owner", "no canonical Source Read/Run",
    "no PnL", "no Discovery/Validation/Holdout/Paper/Live stage advance",
]
for needle in required:
    assert needle in text, f"missing mailbox bridge invariant: {needle}"

for forbidden in [
    "contents: write", "pull-requests: write", "actions: write",
    "packages: write", "deployments: write", "workflow_dispatch:",
    "\n  push:", "\n  pull_request:",
]:
    assert forbidden not in text, f"unsafe mailbox bridge surface present: {forbidden}"

assert text.count("issue_comment:") == 1
assert text.count("anthropics/claude-code-action@v1") == 1

resume = json.loads(Path("MERIDIAN_RESUME.json").read_text(encoding="utf-8"))
for label, value in [
    ("resume.nextAction", resume["nextAction"]),
    ("resume.chatHandoff.quickResume", resume["chatHandoff"]["quickResume"]),
]:
    assert "mailboxIssue" in value, f"{label} must resolve mailboxIssue dynamically"
    assert not re.search(r"Issue #\d+", value), f"{label} hardcodes mailbox issue"

agent_state = json.loads(Path("MERIDIAN_AGENT_STATE.json").read_text(encoding="utf-8"))
agent_bootstrap = agent_state["nextChatBootstrap"][0]
assert "mailboxIssue" in agent_bootstrap
assert not re.search(r"Issue #\d+", agent_bootstrap)

agent_workflow = Path("MERIDIAN_AGENT_WORKFLOW.md").read_text(encoding="utf-8")
stream_safe = agent_workflow.split("## STREAM-SAFE-V8", 1)[1]
first_rule = next(
    line for line in stream_safe.splitlines()
    if re.match(r"^1\.\s+", line.strip())
)
assert "mailboxIssue" in first_rule
assert not re.search(r"Issue #\d+", first_rule)

handoff = Path("docs/MERIDIAN_CHAT_HANDOFF.md").read_text(encoding="utf-8")
bootstrap_line = next(x for x in handoff.splitlines() if "Before every Meridian step" in x)
assert "mailboxIssue" in bootstrap_line
assert not re.search(r"Issue #\d+", bootstrap_line)

# Both operational routes must move with the checkpoint in the same candidate.
watchdog = Path(".github/workflows/claude-watchdog-15m.yml").read_text(encoding="utf-8")
assert set(re.findall(r"/issues/(\d+)(?:/comments|[\"'])", watchdog)) == {str(mailbox_issue)}
assert set(re.findall(r"[Ii]ssue #(\d+)", watchdog)) == {str(mailbox_issue)}
assert set(re.findall(r"[Ii]ssue #(\d+)", text)) == {str(mailbox_issue)}
assert checkpoint["mailboxPolicy"]["previousMailboxIssue"] != mailbox_issue
assert type(checkpoint["mailboxPolicy"]["watchdogStatusCommentId"]) is int
assert checkpoint["mailboxPolicy"]["watchdogStatusCommentId"] > 0
for workflow in (text, watchdog):
    assert "GREEN_LIGHT" in workflow and "REVISION_REQUIRED" in workflow
    assert "NEEDS_MORE_EVIDENCE" in workflow
    assert "GREEN LIGHT" not in workflow and "REVISION REQUIRED" not in workflow
    assert "Bash(gh issue view:*)" in workflow
    assert "full scope" in workflow.lower() or "full requested scope" in workflow.lower()
    assert "exact-head CI" in workflow or "CI on the exact reviewed head" in workflow
for invariant in (
    "Validate fixed watchdog status destination", ".mailboxIssue == 639",
    ".mailboxPolicy.watchdogStatusCommentId", '.id == $id and .issue_url == $issue',
    '.user.login == "Achi1984" and .user.id == 319562141',
    'startswith("CROSS_MODEL_STATUS CLAUDE-DEVELOPMENT-WATCHDOG',
    "steps.destination.outputs.comment_id", "never create another watchdog status comment",
    "one request-specific CROSS_MODEL_RESPONSE", "Stop on mismatch or unknown write outcome",
):
    assert invariant in watchdog, invariant
assert "cron: '57 * * * *'" in watchdog
assert "Post exactly one concise comment" not in watchdog
for forbidden in ("contents: write", "pull-requests: write", "actions: write", "packages: write", "deployments: write"):
    assert forbidden not in watchdog

print("MERIDIAN Claude mailbox bridge static safety: PASS")

# Execute the real fail-closed destination gate against offline API responses.
import subprocess
import tempfile
import textwrap
segment = watchdog.split('      - name: Validate fixed watchdog status destination\n', 1)[1].split('      - name:', 1)[0]
gate = textwrap.dedent(segment.split('        run: |\n', 1)[1])
seed_id = checkpoint['mailboxPolicy']['watchdogStatusCommentId']
valid_comment = {'id': seed_id, 'issue_url': f'https://api.github.com/repos/Achi1984/meridian/issues/{mailbox_issue}',
                 'user': {'login': 'Achi1984', 'id': 319562141},
                 'body': 'CROSS_MODEL_STATUS CLAUDE-DEVELOPMENT-WATCHDOG\nstatus: STAGED_NOT_ACTIVE'}

def check_destination(candidate, comment, *, passed=False, api_failure=False, no_api=False):
    with tempfile.TemporaryDirectory() as directory:
        base = Path(directory)
        (base / 'bin').mkdir()
        (base / 'MERIDIAN_LIVE_CHECKPOINT.json').write_text(json.dumps(candidate))
        (base / 'response.json').write_text(json.dumps(comment))
        shim = base / 'bin/gh'
        shim.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALLS"\n'
                        'test "$API_FAILURE" != true || exit 17\ncat "$RESPONSE"\n')
        shim.chmod(0o755)
        result = subprocess.run(['bash', '-c', gate], cwd=base, capture_output=True, text=True,
            env={'PATH': str(base / 'bin') + ':/usr/bin:/bin', 'GITHUB_REPOSITORY': 'Achi1984/meridian',
                 'GITHUB_OUTPUT': str(base / 'output'), 'CALLS': str(base / 'calls'),
                 'RESPONSE': str(base / 'response.json'), 'API_FAILURE': str(api_failure).lower()})
        output = (base / 'output').read_text() if (base / 'output').exists() else ''
        assert (result.returncode == 0) == passed, result.stderr
        assert output == (f'comment_id={seed_id}\n' if passed else '')
        if no_api:
            assert not (base / 'calls').exists()
        elif (base / 'calls').exists():
            assert (base / 'calls').read_text() == f'api --method GET repos/Achi1984/meridian/issues/comments/{seed_id}\n'

check_destination(checkpoint, valid_comment, passed=True)
for bad_id in (None, 0, -1, str(seed_id), 1.5):
    check_destination({**checkpoint, 'mailboxPolicy': {**checkpoint['mailboxPolicy'], 'watchdogStatusCommentId': bad_id}}, valid_comment, no_api=True)
check_destination({**checkpoint, 'mailboxIssue': 571}, valid_comment, no_api=True)
for update in ({'id': seed_id + 1}, {'issue_url': 'https://api.github.com/repos/Achi1984/meridian/issues/571'},
               {'user': {'login': 'someone', 'id': 319562141}}, {'user': {'login': 'Achi1984', 'id': 1}},
               {'body': 'unrelated comment'}, {'body': None}):
    check_destination(checkpoint, {**valid_comment, **update})
check_destination(checkpoint, valid_comment, api_failure=True)
print('MERIDIAN fixed watchdog destination adversarial checks: PASS')
