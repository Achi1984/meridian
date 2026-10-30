# Receipt capacity probe

`scripts/autonomy/m11-coordinator-receipt-capacity-probe.mjs` is an isolated,
default-disabled library. Nothing imports it into a runtime or workflow. There
is no CLI or live execution in this packet.

`createM11CoordinatorReceiptCapacityProbe(options).probe({signal})` accepts injected
`fetchImpl`, synchronous `credentials.getAuthorizationHeader()`, and `now` clock.
Disabled calls perform zero transport, auth, or clock I/O. Enabling is explicit;
this library does not provision credentials or authorize publication. Enabled
calls use GET only, fixed named repository mailbox #942, no redirects, no retries,
no cache, and no caller-selected destination. Credentials are local to the call
and request headers, never returned or logged. A changed header before a later
request stops the scan.

## Bounds and diagnostics

Defaults match the supporting receipt adapter at
`eb0515d9a5d427f80380df240d7e4ab54b950dc2`: 131072 bytes/page, 1048576 bytes/scan,
10 pages and 4500 ms. Configuration cannot exceed the existing ceilings of
1048576 bytes/page, 4194304 bytes/scan, 20 pages and 10000 ms. No caps are raised.
Both an injected-clock check and a real timer enforce the deadline. Caller abort,
deadline, and budget failures abort fetch and request stream cancellation without
waiting indefinitely for acknowledgement. An ignored abort cannot start a later
request. `cancellation: REQUESTED` is not proof of transport cleanup; cancellation
can fail or remain unacknowledged.

Only delivered `Uint8Array.byteLength` values are counted. There is no decoding,
JSON serialization/parsing, body concatenation, comment text retention or logging.
Content-Length is not evidence and is not used to invent a measurement. A chunk
that crosses a budget is counted numerically, then consumption stops immediately:
no overbudget body accumulation occurs. The transport controls allocation of its
own chunks, so this is not a bound on upstream allocation or buffering. Zero-length
chunks remain subject to the deadline; the read loop periodically yields to let
real timers and caller cancellation run even with an always-ready stream.
As with any in-process JavaScript library, a blocking synchronous injected
dependency cannot be preempted by a timer.

Results contain fixed enums and numbers (including a bounded numeric `pageBytes`
array). `COMPLETE/SCAN_COMPLETE` means only that one bounded pagination scan reached
EOF. `EXACT_STREAM_BYTES` describes delivered response body bytes, not HTTP headers,
TLS/framing, or necessarily compressed on-wire bytes: fetch may decompress.
All disabled, aborted, malformed, or ambiguous results carry `LOWER_BOUND`.
An oversized chunk may make the observed lower bound exceed the configured budget.
Late chunks after cancellation are excluded. Pages started includes an attempted
fetch; pages completed counts body EOF, even if pagination is subsequently rejected.
`UNKNOWN` covers invalid response/pagination/stream/auth/clock or transport outcomes;
exception strings and response content are never included. No cleanup success,
receipt validity, deduplication, or operational readiness is inferred.

## Pagination and evidence boundary

Every Link relation must match the pinned named or numeric
`https://api.github.com/repositories/1342084551/issues/942/comments`
resource with exact `?per_page=100&page=N` spelling. All relations are validated,
including prev/first/last; duplicate relations, inconsistent last pages, foreign
destinations, alternate queries and nonsequential next pages fail closed.
Links are never followed directly: subsequent URLs are built from the named
constant. This mirrors #1028's private validation without importing that unmerged
adapter or modifying its implementation.

This probe does **not** parse comments, validate inventory row counts, detect
duplicates, compare inventories, verify receipt authors, or obtain actual-send
evidence. Connector JSON sizes are not wire evidence. Smaller pages, `since`
filters and direct-ID reads cannot substitute for the adapter's full
double-inventory deduplication. One complete scan neither proves a second scan
fits the shared aggregate/time budget nor that the mailbox remains unchanged.
No live probe was run. #1028 capacity and operational readiness remain unresolved.
Full CI and final independent review remain Lead gates.

## Synthetic acceptance

Run `node --test test/m11-coordinator-receipt-capacity-probe.test.js`.
Tests inject only synthetic transports/auth/clocks, including UTF-8 chunks,
budget exhaustion, ignored abort, cancellation failures, deadlines, hostile
pagination and unknown transport outcomes. No network or credentials are needed.
