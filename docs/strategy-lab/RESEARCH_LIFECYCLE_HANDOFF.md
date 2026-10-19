# Supplied observation history and lifecycle boundary

This source/synthetic package builds on PR898 inspection reports. It validates
supplied observations, not the underlying database, process, operator, source,
or execution. Even a report's `integrity` string is an unauthenticated input claim.
No new research, Paper, Live, recovery or scheduling authority is established.

## Pure interface

`inspection_history.summarize(observations, previous=None)` accepts ordinary parsed
JSON data. Each envelope has exactly `observationId`, `sequence`, `previousSha256`
and `report`. Report schema is `MERIDIAN_B1_INSPECTION_REPORT_V1` from PR898.
Sequence starts at1; first predecessor is null. Later predecessor is SHA256 of the
previous unique envelope encoded by `inspection_history.wire`: sorted keys,
compact separators, ASCII-escaped UTF-8, no appended newline. `digest` exposes that
encoding/hash contract for callers. A digest is a byte identity, not a signature.

Identical repeated observation IDs deduplicate. Changed content under the same ID
fails. Distinct IDs remain observations of one trial, never additional strategy
attempts. An optional previous sequence must be an unchanged canonical prefix;
this checks supplied append-only consistency, **not durable append-only storage**.
No file, database, subprocess, network, clock, random, scheduler or engine call is
made by the module. There is no CLI or automatic receiver.

Limits:256 envelopes per sequence (duplicates included),16 KiB per encoded
envelope,4 MiB combined supplied current/previous envelopes,16 KiB summary output.
Exact canonical encoding size is charged before full JSON serialization, including
keys, separators, quoting, escaped controls and Unicode surrogate pairs.
Input graph traversal also caps depth16,20,000 nodes per envelope and text lengths;
cycles/shared nested containers, custom types, floats and boolean counters reject.
The caller owns bounded parsing of untrusted raw JSON; this API accepts parsed data.
Malformed or conflicting input raises `HistoryError` with a fixed code; no partial
summary is returned. Callers must display a conflict stop, never the last good
summary as current evidence.

## Interruption decisions

| Supplied observation | Summary guidance | Meaning |
| --- | --- | --- |
| Empty or queued | `INSPECT_ONLY` | No attempt inferred or launched |
| Unknown and unresolved | `EXPLICIT_RECONCILIATION_REQUIRED` | Unresolved fence is retained, even at44 recorded paths |
| Failed, timed-out, partial, rejected, completed | `TERMINAL_NO_RETRY` | Recorded terminal observation; no new attempt permitted |
| Unknown subsequently observed resolved | `TERMINAL_NO_RETRY` | Observation of resolution only; no operator authority, successful recovery or resumability proved |
| Identity, sequence, prefix or state conflict | Exception; conflict stop | No fabricated reconciliation or alternate weaker path |

Timestamps accept the generated UTC subset only: full ISO date/time, Z or +00:00,
optional fractional seconds of1–6digits. The journal emits millisecond +00:00
timestamps; other timezone offsets are outside this interface. Valid calendar
dates and creation/start/finish
chronology. Created time is mandatory. Queued work has no start/finish; rejected
work requires finish without start. Claimed unknown work may omit start but
unresolved work has no finish; resolved unknown requires finish. Other terminal
states require finish; failed/timed-out/partial claims may lack start only with
zero recorded paths (settlement before RUNNING). Completed requires start.
Result and summary hashes must be both absent or
both present. These are consistency checks on supplied claims, not clock evidence.

Counts cannot regress; one consumed attempt retains its fence. Terminal reports
cannot change contents or return to active state. A completed report requires44
completed paths and result/summary identities, but still remains synthetic and
unauthenticated. A valid digest chain cannot establish actual journal continuity.

## Reuse and future gates

The existing `validate-trial-ledger.mjs` continues to own historical attempt/result
inventory validation. Its incomplete historical inventory, missing attempt numbers,
discarded/manual coverage and remaining budget stay unknown. This module does not
rewrite it or invent workflow receipts to represent local observations. Registering
actual experiments and binding authentic source/authorization receipts is future
work; a snapshot is neither an empirical run nor a new experiment attempt.

True durable observation storage would require its own reviewed concurrency,
compare-and-swap, retention and provenance design. Operational reconciliation must
remain explicit; session resumability, retries, new executions and recurrence have
separate design and authorization gates. D1 does not grant D2; historical results
never grant forward Paper or Live. No pinned engine/journal/adapter bytes change.

Focused tests: `node --test test/research-supervisor-inspection-history.test.js`.
The integration test invokes the real PR898 report projector against supplied
mock inspection metadata; it opens no database and runs no strategy.
