# Manual native review observation: prepared, not executed

This packet adds a manual entrypoint to the merged observer and exact-pin GET
transport. It does not install a workflow or activate event-driven operation.
Import is inert. The explicit command flag permits one bounded read-only call;
it is not owner approval, complete review evidence or dispatch authority.

## Concrete candidate

Control source: main `03f5c78068b74fdeb0e3c02450a0b5a389b0612b`, including merged
transport PR735. The entrypoint itself must first receive its own exact-head
review and concrete one-shot execution decision. Use that exact reviewed immutable
Draft head before any merge; merging first changes main and invalidates these pins.
Target PR736 was observed open at the pins
below. Reconcile those pins again immediately before any separately authorized
invocation. Drift must block; do not silently update pins or select another review.

Expected config file contents (no credentials):

```json
{"scope":{"prNumber":736,"headSha":"2b4bce3ff1ece837b19e8acdf655db6d922390b8","baseSha":"03f5c78068b74fdeb0e3c02450a0b5a389b0612b","ci":{"runId":38306411836,"runAttempt":1,"workflowId":347821227,"headSha":"2b4bce3ff1ece837b19e8acdf655db6d922390b8"}},"review":{"id":5495805683,"submittedAt":"2026-10-12T20:48:50Z","bodySha256":"e94a2027902dc9d215e1dd740beddd15a9bc61365c148e5a1b8ec1609b9c12df"}}
```

From the reviewed source directory, with an already provisioned `GH_TOKEN` in
the environment and the independently reviewed config in `pins.json`:

```sh
python3 -I -B native_review_observe.py --allow-read-only-network pins.json
```

Direct startup requires isolated Python (`-I`); it loads reviewed sibling modules
from the script directory, excluding current-directory and PYTHONPATH imports.
Never paste, discover or provision a token as part of this packet. No token is
accepted in arguments or the config. The launcher performs no repository writes,
file writes, polling, new assignment or claim reset. It prints only a bounded
redacted JSON observation. Config bytes are capped at 16384; all pins validate
before reading the token or constructing transport. Existing GET bounds apply.

A matching observation exits **2**, deliberately never a successful approval
gate, and reports `OBSERVED_APPROVAL_INCOMPLETE`; blocked cases exit **1**.
Review bodies, credentials and exception strings are not printed. Every existing
authority flag remains false. This observes one selected approval; it proves
neither complete/latest reviews, resolved threads nor executed-check evidence.
No authenticated invocation has been performed in preparation of this packet.

Tests use mocked HTTP responses and a synthetic token only. Run the collector,
observer, transport and entrypoint suites together; stage the existing sibling
event adapter for its collector integration test.
