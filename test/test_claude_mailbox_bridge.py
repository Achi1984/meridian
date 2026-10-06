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
    '--allowedTools "Bash(gh api:*),Bash(gh pr view:*),Bash(gh pr diff:*),'
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

agent_workflow = Path("MERIDIAN_AGENT_WORKFLOW.md").read_text(encoding="utf-8")
stream_safe = agent_workflow.split("## STREAM-SAFE-V6", 1)[1]
first_rule = stream_safe.split("\n", 3)[3]
assert "mailboxIssue" in first_rule
assert not re.search(r"Issue #\d+", first_rule)

handoff = Path("docs/MERIDIAN_CHAT_HANDOFF.md").read_text(encoding="utf-8")
bootstrap_line = next(x for x in handoff.splitlines() if "Before every Meridian step" in x)
assert "mailboxIssue" in bootstrap_line
assert not re.search(r"Issue #\d+", bootstrap_line)

print("MERIDIAN Claude mailbox bridge static safety: PASS")
