# Delayed terminal accounting

The eight-hour boundary closes entry, quote, and risk-operation eligibility. It
does not make the bookkeeping callback happen on time. `finishRun` is the sole
operation allowed after that boundary, and it records the caller's actual,
monotonic integer timestamp. It does not backdate the receipt, admit a candidate,
accept an expired quote, synthesize an exit, or extend an authorization window.

The step keeps its existing event, command, byte, and pending-authorization
bounds. Checkpoint publication still requires the existing exact durable
readback. A missing acknowledgement or any ambiguous persistence outcome is
`UNKNOWN`; there is no retry, automatic reconciliation, or restart path. The
step coalesces an exact duplicate finish and rejects other work after finishing.
The ledger records only one `RUN_FINISHED` accounting event, including when a
checkpoint is replayed.

The lower-level checkpoint session also has a deadline guard: a nonterminal
command invoked after its fixed deadline is reduced to terminal `finishRun`
bookkeeping rather than invoking its requested ledger operation. The execution
step itself rejects nonterminal operations outside the window before dispatch.

At finish, only complete identity-bound marks that pass the existing freshness
checks may contribute valuation. With no valid causal mark, the terminal result
reports unavailable equity and leaves each open position open and unvalued.
`finishRun` never creates a `PAPER_EXIT` or estimates a liquidation fill.

## Runner integration proposal (not applied)

The #1146 runner remains untouched. Its `finish(reason, now)` currently rejects
`finishAt > metadata.deadlineAt` and may use a timestamp sampled before a
delayed callback. For a future integration, keep all current stop/deadline
checks, operation-budget checks, the explicit `marks: []`, and receipt/readback
validation. Replace only the timestamp-selection block with a fresh injected
clock sample at terminal dispatch:

```js
let finishAt;
try {
  finishAt = readTime();
  if (now !== null && finishAt < now) {
    return report("STOPPED", "clock regressed during terminal finalization");
  }
} catch {
  return report("STOPPED", "clock unavailable; no finish command issued");
}
```

In that block, remove the `finishAt > metadata.deadlineAt` rejection and the
manual `latestTime` update; `readTime()` already verifies nondecreasing observed
time and updates the fence. Continue issuing exactly one `executionStep.finishRun`
with that `finishAt`, empty marks unless valid terminal marks are explicitly
available, and accept a terminal receipt only after the runner's existing
identity/sequence/hash checks. A failed clock check remains stopped; an
uncertain write remains `UNKNOWN`. No runner implementation change, activation,
provider access, live run, or deployment is included here.

The proposed integration target is the reviewed #1146 runner head
`089728145d65324d835af62cb58b2f0a4eda9421`; it must be revalidated against the
exact runner revision accepted for integration.

## Offline validation

The focused tests use generated fixtures and real temporary checkpoint
directories. They cover deadline rejection for entries, a stop at the boundary
followed by delayed finish, actual terminal timestamp/readback, replayed and
duplicate finishes, unvalued open positions, and ambiguous persistence. They do
not validate host clock authenticity, cross-host durability, market data, or
operational readiness.
