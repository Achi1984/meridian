import json
from pathlib import Path

WORKFLOW = Path(".github/workflows/claude-mailbox-review.yml")
CHECKPOINT = Path("MERIDIAN_LIVE_CHECKPOINT.json")
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
    "issue_comment:",
    "types: [created]",
    f"github.event.issue.number == {mailbox_issue}",
    "github.event.comment.user.login == 'Achi1984'",
    "contains(github.event.comment.body, '@claude')",
    "contains(github.event.comment.body, 'CROSS_MODEL_REQUEST')",
    "contents: read",
    "issues: write",
    "pull-requests: read",
    "actions: read",
    "anthropics/claude-code-action@v1",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "Missing repository secret CLAUDE_CODE_OAUTH_TOKEN",
    "timeout-minutes: 35",
    "include_fix_links: false",
    "--disallowedTools Edit,Write",
    allowed_tools,
    "MERIDIAN REVIEWER-ONLY MODE",
    f"Issue #{mailbox_issue} is the binding mailbox",
    "gh api must not use POST/PATCH/PUT/DELETE",
    "git must not checkout/switch/reset/clean/add/commit/rebase/merge/push/tag",
    "CHATGPT is Lead and sole merge owner",
    "no canonical Source Read/Run",
    "no PnL",
    "no Discovery/Validation/Holdout/Paper/Live stage advance",
]

for needle in required:
    assert needle in text, f"missing mailbox bridge invariant: {needle}"

for forbidden in [
    "contents: write",
    "pull-requests: write",
    "actions: write",
    "packages: write",
    "deployments: write",
    "workflow_dispatch:",
    "\n  push:",
    "\n  pull_request:",
]:
    assert forbidden not in text, f"unsafe mailbox bridge surface present: {forbidden}"

assert text.count("issue_comment:") == 1
assert text.count("anthropics/claude-code-action@v1") == 1

print("MERIDIAN Claude mailbox bridge static safety: PASS")
