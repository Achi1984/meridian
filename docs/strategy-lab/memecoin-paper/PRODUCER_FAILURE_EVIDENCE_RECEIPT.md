# Producer failure-evidence reconciliation receipt

**Implementation head:** `fbe2d962d31ccbcd14b12d58b8de7319c231d276`  
**Base:** `4d2195e4d4bb8ab467430358d6e5567dc795db4b` (main, including #1136)  
**Scope:** source/tests only; no launch, provider/network calls, credentials, orders, deployment, activation, dependencies, workflows, or frozen-export repairs.

## Consistency matrix

| Outcome | `terminal.json` | Terminal observation | Operator report | Audit |
| --- | --- | --- | --- | --- |
| Clean completion | `FINISHED`, failure `null` | `null` | `null` | terminal, failure `null` |
| Controller failure | `UNKNOWN`, actual code retained | same code | same code | terminal, same code |
| Late deadline/time failure | `UNKNOWN`, `DEADLINE_FINALIZATION_TIME_UNKNOWN` | same | same | terminal, same |
| Late checkpoint-ack failure | `UNKNOWN`, `CONTROLLER_CHECKPOINT_ACK_UNBOUND` | same | same | terminal, same |
| Unsettled callbacks | No terminal marker | No persisted terminal observation | No terminal report; reads remain `AUDIT_ONLY` | remains `RUNNING`, terminal `null`; start result identifies `CALLBACK_WORK_UNSETTLED` |

Unavailable failure evidence is `UNKNOWN`, not `null`. Conflicting persisted report/audit evidence is rejected as `UNKNOWN`. The unsettled-callback row deliberately preserves the existing no-terminal-output guard and durable lock.

## Validation and next-run impact

- `node --test test/memecoin-paper-pilot-online.test.js` — passed, 23 tests.
- `node --test --test-name-pattern='deadline beyond bounded|unbound terminal checkpoint|unsettled checkpoint work' test/memecoin-paper-pilot-assembly.test.js` — passed, 3 real-module tests with generated inputs, fake time, and temporary storage.
- `git diff --check` — passed.
- Secret scan — no secrets detected.
- CodeQL checker — 0 alerts; JavaScript analysis was skipped because the database exceeded its size limit.
- Next run remains observation-only and one-shot. No launch or network behavior changes; terminal evidence now reconciles or fails closed, and unsettled work still prevents terminal output and restart.

Hosted Actions full-suite execution and independent GitHub review remain pending; merge only after both complete successfully.
