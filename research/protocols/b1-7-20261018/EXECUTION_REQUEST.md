# Owner execution request — proposal only

**Status: PROPOSAL ONLY — NOT APPROVED / NOT AN EXECUTION GRANT.** R3 independent review is pending. This request is for a later, separate owner decision after synthetic source review, exact-head CI, and independent full source review. Do not run the engine on captured market data while this request is pending.

The R2 `GREEN_LIGHT` (response comment `6249482850`) is historical and applies only to R2 source-and-synthetic preparation. It does not review R3 or approve this real-run proposal, its 44-path budget, costs, screen thresholds, or no-stop exception.

## Immutable identities

| Identity | Proposed value | Status |
| --- | --- | --- |
| Protocol | `MERIDIAN-B1-7-PROTOCOL-R3-20261018`; raw `protocol.json` SHA-256: `a78e1ae8c71c8f85baee5b51f5691643fc29136f636f19465c61f553afe09185` | Frozen file identity |
| Implementation | `MERIDIAN-B1-7-ENGINE-R3`; bundle SHA-256 `3e70c988d63a139bfe3f4fbd469a737970068ecb3a5caaa95c8c983ed1a90285` | Exact two-file bundle identity |
| Source basis | Git commit `1c7b6dccd886f57e866c7d359c091b1e72a193ea` | Pinned source/input-provenance commit |
| Input manifest | Canonical SHA-256 of seven caller-supplied exact Kraken candle arrays: `PENDING_NOT_COMPUTED` | No series loaded or hashed in this task |
| Offline provenance record | `research/acquisitions/kraken-usd-daily-20261018/offline-verification.json` | Hash provenance only; source authenticity is not established |

The exact seven proposed assets and copied normalized-file SHA-256 values are:

The bundle digest is SHA-256 of canonical JSON with keys `engineSha256` and `validatorSha256` containing these exact raw-file SHA-256 values: `engine.mjs` = `bab7cd5171440ae4cb4d5f386cdbe9fa4f3f06170122ce3d6de22b68300eff4c`; `validate.mjs` = `2052c0fae0082622f48a18abb4a6dacc0ffa679fb5da01df5779b398f5a578fc`. The engine accepts the bundle hash as caller-supplied identity and does not inspect its own source.

| Order | Asset | Normalized file SHA-256 |
| ---: | --- | --- |
| 1 | XBTUSD | `f2e94a03fbe61f37295b2249d5c3a4d324d13fcfb5d5b41f2ed4d7dfe2183bb9` |
| 2 | ETHUSD | `fbb7915af33d3c32db1cf368a171ed633090406c39da38aae90ac0d3876754bb` |
| 3 | SOLUSD | `caff8ea08d3548b2d8c704cc17a940754a70e23f60e44716324c464929bc18ca` |
| 4 | XRPUSD | `bd006dfcbf052fb516e2d5e5a97d0570cf093e577c3c83752f2f3b7310fc52a7` |
| 5 | LINKUSD | `82682634f645ab5ca1dac4065cc0d490d343ea24b61463bcc2b6406894785518` |
| 6 | AVAXUSD | `a4350bf73b44a45770bb173541133e4a04e847a07d74231ad6b5bbd7d6d06887` |
| 7 | SUIUSD | `0b35eb5598a336d8d4485b15adc2a4b4a716c967ff700eff3802386c31beda79` |

Input must be exactly 955 synchronized daily rows for each asset, 2024-02-19 through 2026-09-30. Missing, duplicate, malformed, out-of-order, nonsynchronous, or hash/identity-mismatched data aborts the entire batch. No network retrieval, data repair, substitutions, or additional asset/variant is proposed.

## Proposed bounded run

- One offline process; exactly 44 paths: five fixed variants × three scenarios × two segments (30), full basket × three scenarios × two segments (6), two development-frozen controls × three scenarios × diagnostic segment (6), and cash × two segments (2).
- Requested hard limits: 30 minutes total, 60 seconds per path, and 1 MiB serialized output. The in-memory engine checks cooperatively throughout validation, features, path loops, and result assembly; synchronous code cannot be hard-preempted. An external supervised runner must enforce hard wall-clock limits before any real run. No retries or adaptive trials. Any failure stops the batch; prior paths become incomplete and remaining paths stay unstarted; no partial ranking.
- Costs: 15 bp per side baseline = 10 bp spot taker reference + 5 bp assumed friction; 30 bp per side stress; and 30 bp plus one-day delayed fill. Owner accepted preparation of this OKX-inspired model, not execution. Costs are assumptions, not owner-specific fee entitlement, historical fee reconstruction, or measured spread/impact. Inputs remain pinned Kraken spot USD candles; the result is a Kraken-price historical diagnostic with OKX-inspired assumed costs, **not OKX execution evidence**. No maker-fill, futures, or funding inference.
- Screen: diagnostic primary net return positive; sampled daily-close drawdown at most 25%; return no worse than either frozen control; drawdown no worse than either control; at least 20% relative drawdown reduction versus full basket; primary positive at 30 bp without delay and at 30 bp plus one-day delay; at least 3/4 neighbors positive at 15 bp and separately at 30 bp without delay. Delayed neighbors are report-only, not screened. Primary/control comparisons are diagnostic-only. Zero/invalid risk denominators produce `INSUFFICIENT_EVIDENCE`. PASS would mean historical candidate only, never a holdout or significance claim.
- Output includes daily target-versus-realized exposure mismatch summaries for each path and each frozen-control diagnostic scenario. Report the frozen target, mean realized exposure, mean and maximum absolute mismatch; do not rescale a control to diagnostic behavior.
- Segments start independently at USD 10,000. Development freezes the two static controls; diagnostic data are historical and conditioned, not a fresh holdout. The existing unknown trial-ledger completeness remains `UNKNOWN`.

## No-stop exception and unchanged gates

This proposal asks for only a research-stage portfolio-level no-stop analysis. There is no finite per-trade stop, so CRV remains `UNDEFINED_NO_FINITE_STOP`, null, and not applicable for this research-only screen. No stop is invented, and no trade CRV or promotion eligibility is claimed. The 15 bp baseline control mean uses the primary path's held target over all 180 development days; the initial fill is on day one, so the baseline has no pre-fill rows. The zero-before-fill rule matters for delayed paths.

R3 independent review is pending; the historical R2 review is not approval of this proposal. The 10 bp spot taker reference plus 5 bp assumed friction and 30 bp stress must be explicitly included in the separate owner decision. Neither is account-specific entitlement or a claim about OKX fills.

This request does **not** authorize a real-data run, strategy-PnL promotion, discovery, validation, holdout, Paper, Live, trading, runtime changes, or any authorization-flag change. `canonicalExecutionAuthorized`, `strategyPnlAuthorized`, `discoveryAuthorized`, `validationAuthorized`, `holdoutAuthorized`, `paperAuthorized`, and `liveAuthorized` remain false. A later explicit owner decision must approve the exact protocol/source/input identities, costs, screen, budget, and no-stop exception before any real series is supplied.
