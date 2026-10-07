import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const WORKFLOW = ".github/workflows/claude-watchdog-15m.yml";

function extractUnresolvedRequestFilter() {
  const source = readFileSync(WORKFLOW, "utf8");
  const match = source.match(
    /unresolved_request=\$\(jq -r \\\n[\s\S]*?--argjson mature_cutoff "\$mature_cutoff" '\n([\s\S]*?)\n\s*' <<<"\$mailbox"\)/
  );
  assert.ok(match, "watchdog unresolved-request jq filter must remain extractable");
  return match[1];
}

function runFilter(comments, nowEpoch) {
  const jq = spawnSync(
    "jq",
    [
      "-r",
      "--argjson",
      "request_cutoff",
      String(nowEpoch - 86400),
      "--argjson",
      "mature_cutoff",
      String(nowEpoch - 600),
      extractUnresolvedRequestFilter(),
    ],
    {
      input: JSON.stringify(comments),
      encoding: "utf8",
    }
  );

  assert.equal(
    jq.status,
    0,
    `watchdog jq filter must execute successfully: ${jq.stderr || jq.stdout}`
  );
  return jq.stdout.trim();
}

function request(id, head, createdAt) {
  const exactHead = head ? `\nexact_head_sha: ${head}` : "";
  return {
    created_at: createdAt,
    body: `@claude\n\nCROSS_MODEL_REQUEST ${id}${exactHead}`,
  };
}

function response(id, head, createdAt) {
  return {
    created_at: createdAt,
    body: `CROSS_MODEL_RESPONSE ${id}\nreviewed_head: ${head}`,
  };
}

test("watchdog mailbox filter handles answered, unanswered, exact-head, ignores missing-head, and filters young requests", () => {
  const now = Math.floor(Date.parse("2026-10-07T06:00:00Z") / 1000);

  const headA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const headB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const headC = "cccccccccccccccccccccccccccccccccccccccc";
  const headD = "dddddddddddddddddddddddddddddddddddddddd";
  const headE = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

  const comments = [
    request("R-ANSWERED", headA, "2026-10-07T04:00:00Z"),
    response("R-ANSWERED", headA, "2026-10-07T04:02:00Z"),

    request("R-OPEN", headB, "2026-10-07T04:10:00Z"),

    request("R-SAME-ID", headC, "2026-10-07T04:20:00Z"),
    response("R-SAME-ID", headD, "2026-10-07T04:22:00Z"),

    request("R-NO-HEAD", null, "2026-10-07T04:30:00Z"),

    request("R-YOUNG", headE, "2026-10-07T05:55:00Z"),

    request("R-TOO-OLD", headE, "2026-10-05T04:00:00Z"),
  ];

  assert.equal(
    runFilter(comments, now),
    [
      `R-OPEN@${headB}`,
      `R-SAME-ID@${headC}`,
    ].join("|")
  );
});


test("R129 watchdog delivery resilience keeps a narrow successful Release Safety fallback", () => {
  const source = readFileSync(WORKFLOW, "utf8");

  assert.match(source, /schedule:\n\s+- cron: '57 \* \* \* \*'/);
  assert.match(source, /workflow_dispatch:/);

  const trigger = source.slice(
    source.indexOf("on:"),
    source.indexOf("\npermissions:")
  );
  assert.match(trigger, /workflow_run:\n\s+workflows:\n\s+- MERIDIAN Release Safety\n\s+types:\n\s+- completed/);
  assert.doesNotMatch(trigger, /MERIDIAN Visual QA|MERIDIAN Runtime Smoke|MERIDIAN Agent Orchestration Safety/);

  const jobGate = source.slice(
    source.indexOf("jobs:"),
    source.indexOf("\n    runs-on:")
  );
  assert.match(jobGate, /github\.event_name != 'workflow_run'/);
  assert.match(jobGate, /github\.event\.workflow_run\.name == 'MERIDIAN Release Safety'/);
  assert.match(jobGate, /github\.event\.workflow_run\.conclusion == 'success'/);
});

test("R129 preserves state-change and duplicate-suppression gates before Claude invocation", () => {
  const source = readFileSync(WORKFLOW, "utf8");
  const decision = source.slice(
    source.indexOf("- name: Decide whether Claude is needed"),
    source.indexOf("- name: Require Claude credential")
  );

  assert.match(decision, /steps\.seen\.outputs\.cache-hit/);
  assert.match(decision, /reason=UNCHANGED/);
  assert.match(decision, /steps\.state\.outputs\.ci_pending/);
  assert.match(decision, /reason=CI_PENDING/);
  assert.match(decision, /steps\.state\.outputs\.mailbox_review_pending/);
  assert.match(decision, /reason=MAILBOX_REVIEW_PENDING/);
  assert.match(decision, /fingerprint: \$\{STATE_FINGERPRINT\}/);
  assert.match(decision, /reason=FINGERPRINT_ALREADY_COMMENTED/);
  assert.match(decision, /run_claude=true/);
  assert.match(decision, /reason=STATE_CHANGED/);
});

test("R129 keeps the Claude step behind the decision gate", () => {
  const source = readFileSync(WORKFLOW, "utf8");
  const claude = source.slice(
    source.indexOf("- name: Claude development copilot"),
    source.indexOf("- name: Save successful Claude fingerprint")
  );
  assert.match(claude, /if: steps\.decision\.outputs\.run_claude == 'true'/);
  assert.match(source, /MERIDIAN DEVELOPMENT COPILOT — STATE-CHANGE WATCHDOG/);
});
