# Explicit-net modeled-quote continuation receipt

**Issue routing:** closes #1245; parent #1207; follow-on to merged #1244.  
**Base:** `c23aaf5327650256a645d33fffb7d5ee4c816b2a`.  
**History:** #1244 established `EXPLICIT_NET_V1` as a projection-only stage (receipt #1244/comment6706445075). This additive continuation binds that existing projection through the fixture adapter, execution step, and ledger; it does not replace the earlier projection or its review boundary.

## Scope and evidence boundary

Only the existing modeled-quote fixture chain is extended. `QUOTED_NET_V1`
retains its V1 facts and strict policy schema; explicit-net uses a separate V2
policy/facts discriminator. Stable methodology is bound independently from each
quote's full scenario digest, causal FX receipt, supplied budgets, quote,
quantity, expiry, response-byte digest, and modeled output. Current ledger
reservations and commit-time risk checks remain authoritative.

Issuance still requires the same adapter's original unmodified result and its
module-owned fixture authority. Ordinary enabled adapters, the disabled default,
and production/runtime paths gain no issuance authority. All fixtures and
transports are synthetic; no provider data, credentials, source-policy
admission, live execution, deployment, or pilot is involved. Modeled provenance
remains `MODELED`, actual-cost coverage remains `UNKNOWN`, and execution
realism remains false.

## Focused validation

- `node --test test/memecoin-paper-market-quote-adapter.test.js` — passed, 42 tests.
- `node --test test/memecoin-paper-execution-step.test.js` — passed, 58 tests.
- Full-suite regression remains with hosted CI.

One draft PR is the delivery target; freeze after delivery for independent Lead
review. Do not merge or deploy.
