# Offline long-spot lifecycle

`initialState()` and `transition(state, event)` model one hypothetical long spot
position: FLAT → PENDING_ENTRY → LONG → PENDING_EXIT → FLAT. There is no network,
scheduler, persistence, position sizing, costs, PnL, ledger wiring or actual order.
Every result/fill carries `executionAuthorized:false` and `researchOnly:true`.
`valid:true` means accepted arithmetic/state transition, never trading readiness.

Events have unique `id`, `type`, and integer milliseconds `at`. `at` is receipt
and hypothetical fill time and must strictly increase across accepted events.
ENTRY_SIGNAL also requires `signalId`, `availableAt`, `expiresAt`, `initialStop`;
EXIT_SIGNAL requires the same except initialStop is forbidden. Signal availability
must be no later than receipt; expiry must be strictly later than receipt.
QUOTE requires `quoteAt`, `bid`, `ask`. Its timestamp must strictly increase across
all accepted quotes, be no later than receipt, and be at most 1,000 ms old.
All schemas reject extra fields. Prices must be finite positive, bid <= ask.
Times are nonnegative safe integers. No configurable knobs or instrument routing.
The caller must isolate one instrument per state and dispatch only its signals
and quotes; instrument identity is not represented or checked by this prototype.
The 1,000 ms age bound is a fixed technical assumption, not empirically calibrated.

An entry uses a fresh quote strictly after signal availability and buys at ask.
If bid is already at/below initialStop it cancels, without inventing a round trip.
A pending exit sells at bid on a quote strictly after exit signal availability.
The unchanged initial stop remains active in LONG and PENDING_EXIT, even when an
exit signal expires. A quote at/below stop sells at its actual hypothetical bid,
including gaps below stop; it does not assume a fill at the stop price.
A stop quote must be generated strictly after entry fill time; late delivery of
a quote generated before the position existed cannot trigger a retrospective stop.
Expiry is processed on the next accepted event; no timer runs between events.
Expired entry establishes a new-entry barrier at that processing time. An entry
event that itself discovers expiry cannot re-arm immediately; it rejects without
mutation. A subsequent accepted quote or exit must first process the expiry.

Exit signals cancel pending entry. When flat they establish a new-entry barrier.
Entries require signal availability strictly newer than the last exit/cancellation
receipt. Busy entry signals reject; an exit signal may replace a pending exit.
An exit signal predating the held position rejects. At most one fill occurs per
quote. Stops take precedence over discretionary exits. Equal quote timestamps,
equal event receipt timestamps, reused IDs and event/signal ID collisions reject.
No same-bar exclusion is claimed: there is no barId; only the timestamp and ID
barriers above apply.
There is no assertion that real fills occur at these quotes or for any quantity.

The reducer does not mutate inputs. Rejections return the supplied state unchanged.
Accepted state is JSON-serializable and stores consumed IDs in a shared namespace.
The normal budget is 10,000 IDs with three additional close-only slots. Above the
normal budget, only a SELL quote for an already held position or an EXIT_SIGNAL
with at least one slot remaining after it is accepted. Non-closing quotes reject
without consuming reserve or changing state. New entries cannot use the reserve.
One exit signal consumes two IDs and its sell quote one; repeated exit replacements
are not unbounded. Example: LONG at 10,000 → exit at 10,002 → TTL expires. An
above-stop quote then rejects unchanged, and a new two-ID exit signal cannot fit;
a later stop-triggering quote can still sell using the final slot. TTL is never
extended to rescue an exit. A completed FLAT state retains up to all 10,003 IDs,
rejects replay, and cannot restart entry trading beyond the normal budget.
This is a bounded stop-close reserve, not continuous operation or guaranteed fills.
No ID is discarded, and an open-position state must retain at least one close slot.
Reaching the normal 10,000-ID cap does not block an otherwise valid stop: the
close-only reserve remains available. An open-position input with all 10,003 IDs
already consumed is structurally invalid and rejects. Other validation failures
can still block a stop. Before paper/runtime use, continuous operation requires
a persistent replay design without history loss; that design is not implemented here. Caller
must retain and reload the returned state across restarts. No actual persistence,
authentication or proof against a caller forging a coherent history is provided;
state validation checks structural consistency only. Restoring initialState loses
history and is not a safe restart. Rolling back saved state also loses protection.

Signal-before-quote availability is causal, but a quote can have been generated
before signal receipt: this is explicitly a receipt-time, fresh-quote indicative
model, not an executable exchange simulation. Fill metadata exposes quoteAt,
receivedAt, fillAt and signalAvailableAt. Bid/ask already include spread: a future
ledger integration must not add a MIDQUOTE spread assumption again. Costs and
liquidity would require independent modelling. This prototype has no strategy
evaluation, profitability evidence, or promotion authority.
