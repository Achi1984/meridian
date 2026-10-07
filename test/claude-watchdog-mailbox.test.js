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
