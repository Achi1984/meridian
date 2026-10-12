# Manual native review observation: prepared, not executed

This packet adds a manual entrypoint to the merged observer and exact-pin GET
transport. It does not install a workflow or activate event-driven operation.
Import is inert. The explicit command flag permits one bounded observation comprising up to nine GitHub GET requests;
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

## Inactive Actions execution proposal

`native-observe-once.yml` is a reviewable template under docs, not an installed
workflow. Its five Python modules are pinned to immutable source commit
`b42966ab3ba05964bca4d9fcfb2bb00cea85922d` (bytecode fix included).
The proposal performs at most 18 explicit GitHub GETs: five source downloads,
four main/pilot-head guard reads, and up to nine observer reads. No intentional
retry, schedule, checkout, repository mutation or new credential is included.
The existing ephemeral `github.token` receives read-only contents/actions/PR
permissions. Temporary runner files hold source, pins and the redacted receipt.
The launcher's no-file-write statement above applies to the Python observation,
not this workflow's preparation of temporary files.

After review, separately authorize installing the exact template as
`.github/workflows/native-observe-once.yml` on the fixed pilot branch. Prepare
its Draft PR, independently review the final pilot head, then obtain concrete
owner approval for one ready-for-review transition after live pin reconciliation.
Do not merge PR736 or change main first. Different sender, base or target pins
block rather than silently repin. The workflow cannot embed its own commit hash;
root verifies the approved exact head before triggering and the workflow verifies
its event head against the live PR before and after observation.

`run_attempt == 1` blocks reruns, not repeated ready events. This is a single
procedurally authorized invocation, not durable exactly-once delivery. No second
ready transition or retry is authorized. Event delivery and sender identity must
be verified from the actual run. A matching receipt remains incomplete and grants
no dispatch or merge authority. No workflow has been installed or run.
