# Offline PAPER execution runner

This source-only runner connects the bounded execution-step interface from
`Achi1984/meridian#1144` to injected candidate, quote, clock, and stop sources.
It is not runtime activation, real-data eligibility, or a relabeling of the
existing `READ_ONLY_PAPER` observer. All runnable fixture evidence is explicitly
`SYNTHETIC_FIXTURE_ONLY`; the paper ledger remains simulated.

The runner accepts only a fresh checkpoint session, `SIMULATED_ONLY` mode,
synthetic fixture provenance, and the synthetic smart-wallet allowlist. It
serializes operations, bounds ticks, candidate and quote admissions, operation
count, and aggregate input bytes, and verifies the execution-step receipt
sequence. Each tick performs exit/risk work before polling for a candidate, so
open positions continue to be evaluated when the candidate source is empty or
exhausted. Stop and deadline handling call `finishRun` explicitly. A missing
quote never creates a valuation or fill; an uncertain checkpoint outcome
latches `UNKNOWN` and the runner does not retry, reconcile, or restart.

Candidate `poll({now, tick})` must return promptly with `{candidate}`, `{done:
true}`, `null`, or `undefined`; it does not wait for a future candidate. The
injected quote source returns a complete identity-bound hypothetical quote or
`null`, and must itself be bounded. The clock returns explicit integer UTC
milliseconds and the stop source returns a boolean. Inputs are detached and
bounded before evidence inspection or dispatch. A successful report includes
the terminal receipt and ledger summary. Real-data source coverage is always
reported as `NOT_ASSESSED`.

## Offline demonstration

After the final accepted head of #1144 is integrated, run from the repository
root:

```sh
node scripts/memecoin-paper/execution-runner.mjs --offline-demo
```

The command uses a temporary exclusive checkpoint directory and deterministic
synthetic candidate and quote fixtures. It demonstrates authorization, an entry
quote later than the candidate and authorization, a simulated fill with
nonzero costs, then a later risk-only stop exit after the candidate source is
exhausted, followed by a durable terminal receipt. The output includes the
checkpoint directory, reportable receipt, and `durableReadback`. Before
returning success, the demo reopens the checkpoint through the store read API
and checks canonical bytes, checkpoint hash and sequence, final `finishRun`
record, command ID, and result digest against the terminal result. The
integration test independently reopens that on-disk checkpoint and checks entry
and exit costs as well. The checkpoint uses the existing local fsync/readback
contract; this does not establish cross-host or power-loss durability.

Focused tests:

```sh
node --test test/memecoin-paper-execution-runner.test.js
```

## Integration checklist

- [ ] Integrate only the final accepted #1144 head after independent GitHub
  review and exact integration CI; keep `execution-step`, ledger, session,
  provider, controller, cockpit, and report files owned by their existing work.
- [ ] Preserve the runtime distinction: this runner requires
  `SIMULATED_ONLY` plus `SYNTHETIC_FIXTURE_ONLY`; do not change or relabel the
  `READ_ONLY_PAPER` observer, and do not infer real-data eligibility from a
  successful synthetic receipt.
- [ ] Before any separate real-data proposal, close and independently verify
  the external candidate-evidence/allowlist, quote semantics and complete-cost,
  identity/chronology, and authenticated-clock/source-coverage gaps. Current
  source wiring is synthetic-only; real-data coverage is outstanding.
- [ ] Keep provider network access, credentials, paid services, runtime
  activation, deployment, and actual orders out of this package. Deployment
  status remains outstanding and unassessed.
