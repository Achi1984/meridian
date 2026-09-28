# MERIDIAN Orchestration — streaming-safe continuation protocol

## Why this exists

Long MERIDIAN changes combine repository reads, CI logs, research, code edits and validation. A chat/UI response can be interrupted even when repository work already succeeded. The transport interruption itself is outside the repository and cannot be made transactional by application code.

The durable solution is to make **chat state disposable**: the repository, PR and CI become the source of truth.

## Mandatory workflow

1. **Read actual repo state first**
   - default branch HEAD
   - active work branch HEAD
   - PR state and merge SHA
   - latest workflow conclusions
   - `MERIDIAN_RESUME.json`

2. **Never infer completion from the previous chat stream**
   - a visible assistant message may have stopped before the last tool mutation;
   - compare commit SHAs before repeating any edit.

3. **Small atomic checkpoints**
   - one logical change per commit;
   - update the resume cursor after each verified phase;
   - never keep the only copy of a decision in an unfinished chat response.

4. **Bound tool output**
   - request workflow/job summaries first;
   - fetch full logs only for a failed job;
   - emit only the failing test name and a narrow surrounding excerpt;
   - never dump entire source files when a targeted function slice is enough.

5. **CI is the verifier**
   - syntax/regression/privacy/paper-only gates must be green before merge;
   - if a UI refactor breaks semantic regression tests, restore the invariant or update the test only when the invariant intentionally changed.

6. **Resume after interruption**
   - read `MERIDIAN_RESUME.json`;
   - inspect current branch/PR/CI;
   - continue from `nextAction`;
   - do not repeat commits whose SHAs are already reachable.

7. **Research isolation**
   - paper-bot research stays execution-neutral;
   - frozen protocol is committed before result inspection;
   - discovery, holdout and paper-shadow are distinct stages.

## Output discipline

User-facing progress messages are summaries, not live build logs. Long diagnostic evidence belongs in GitHub commits, PRs, issues and research files. This reduces response-stream size without reducing auditability.
