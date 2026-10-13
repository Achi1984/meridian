# Manual native review observation: historical consumed pilot

This packet adds a manual entrypoint to the merged observer and exact-pin GET
transport. The separate PR738 pilot installed and ran its workflow; this document
records that consumed invocation, not a new execution proposal.
Import is inert. The explicit command flag permits one bounded observation comprising up to nine GitHub GET requests;
it is not owner approval, complete review evidence or dispatch authority.

## Historical pins — non-runnable

Control source: main `03f5c78068b74fdeb0e3c02450a0b5a389b0612b`, including merged
transport PR735. The entrypoint required its own exact-head
review and a concrete one-shot execution decision at preparation time. That decision
was given at `2026-10-12T23:54:22+02:00` and has been consumed by PR738 run
`38313572179` (SUCCESS). Target PR736 was open during that observation; it is now
merged as `e1b82a366d8787c4f24bffa725d1d6ad08a9147d`. Main at this documentation
reconciliation is `78c694256a2b0da8f79c02733bcd9e18568aca02`.
The original pins below are preserved as historical evidence only. They are no
longer a runnable configuration. No repinning, rerun or second ready transition
is authorized.

Historical config contents (no credentials; do not execute):

```json
{"scope":{"prNumber":736,"headSha":"2b4bce3ff1ece837b19e8acdf655db6d922390b8","baseSha":"03f5c78068b74fdeb0e3c02450a0b5a389b0612b","ci":{"runId":38306411836,"runAttempt":1,"workflowId":347821227,"headSha":"2b4bce3ff1ece837b19e8acdf655db6d922390b8"}},"review":{"id":5495805683,"submittedAt":"2026-10-12T20:48:50Z","bodySha256":"e94a2027902dc9d215e1dd740beddd15a9bc61365c148e5a1b8ec1609b9c12df"}}
```

Historical invocation syntax only — not an instruction or authorization to run:

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
The completed pilot emitted `OBSERVED_APPROVAL_INCOMPLETE` with reason
`FULL_REVIEW_EVIDENCE_MISSING`. Its authentication, provenance, authorization,
dispatch, merge, durability and full-review-evidence flags remained false;
`plannerResponse` remained null. Successful execution is not complete review
validation or permission to continue automatically.

Tests use mocked HTTP responses and a synthetic token only. Run the collector,
observer, transport and entrypoint suites together; stage the existing sibling
event adapter for its collector integration test.

## Consumed Actions execution record

The copy of `native-observe-once.yml` under docs is still a template. Separately,
PR738 installed `.github/workflows/native-observe-once.yml` on its pilot branch
and ran the owner-authorized observation as run `38313572179` (SUCCESS).
Its five Python modules were pinned to immutable source commit
`b42966ab3ba05964bca4d9fcfb2bb00cea85922d` (bytecode fix included).
The executed design permits at most 18 explicit GitHub GETs: five source downloads,
four main/pilot-head guard reads, and up to nine observer reads. No intentional
retry, schedule, checkout, repository mutation or new credential is included.
The existing ephemeral `github.token` receives read-only contents/actions/PR
permissions. Temporary runner files hold source, pins and the redacted receipt.
The launcher's no-file-write statement above applies to the Python observation,
not this workflow's preparation of temporary files.

The concrete owner approval at `2026-10-12T23:54:22+02:00` covered one
ready-for-review transition after review and live pin reconciliation. That grant
is consumed. The workflow cannot embed its own commit hash; the execution design
requires root to verify the approved exact head before triggering and checks the
event head against the live PR before and after observation. Changed main and the
merged target now invalidate the historical launch conditions. Never silently
repin, reset a claim or repeat the pilot.

`run_attempt == 1` blocks reruns, not repeated ready events. This is a single
procedurally authorized invocation, not durable exactly-once delivery. No second
ready transition or retry is authorized. The completed run supplies the delivery observation for that invocation only.
Its receipt remains incomplete and grants no dispatch or merge authority. No
new installation, activation or execution is proposed by this historical record.
