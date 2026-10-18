# Owner execution request — proposal only

**Status: NOT APPROVED / NOT AN EXECUTION GRANT.** This request is for a later, separate owner decision after synthetic source review, exact-head CI, and independent full source review. Do not run the engine on captured market data while this request is pending.

## Immutable identities

| Identity | Proposed value | Status |
| --- | --- | --- |
| Protocol | `MERIDIAN-B1-7-PROTOCOL-R2-20261018`; raw `protocol.json` SHA-256: `7fda5993dffa298183e3c4b757e4cdaace4754f8a7ff11b4538e1d39dd9e1aed` | Frozen file identity |
| Implementation | `MERIDIAN-B1-7-ENGINE-R2`; bundle SHA-256 `94785763b90b92abcd5c8bc9ec58034d932116a77a8afda7b3be7f08ea9c0193` | Exact two-file bundle identity |
| Source basis | Git commit `1c7b6dccd886f57e866c7d359c091b1e72a193ea` | Exact proposed source commit |
| Input manifest | Canonical SHA-256 of the seven exact caller-supplied series: `PENDING_NOT_COMPUTED` | No series loaded or hashed by this implementation task |
| Offline provenance record | `research/acquisitions/kraken-usd-daily-20261018/offline-verification.json` | Hash provenance only; source authenticity is not established |

The exact seven proposed assets and copied normalized-file SHA-256 values are:

The implementation bundle digest is SHA-256 of canonical JSON with keys `engineSha256` and `validatorSha256` containing the exact raw-file SHA-256 values: `engine.mjs` = `66cee5232ab886bb242e7cf04c68b9324b333eb5725d5cc2c733bb227eccb7c5`; `validate.mjs` = `41a476464ef65c0cbacd367762b00de21e54a85a384d608e0a5108c2f13eec33`. The engine takes this bundle hash as caller-supplied identity and does not inspect its own source.

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
- Hard limits: 30 minutes total, 60 seconds per path, 1 MiB serialized output. No retries or adaptive trials. Any failure stops the batch; incomplete outcomes are never ranked.
- Costs: 85 bp per side baseline (80 bp published Kraken Spot Crypto Tier 1 taker reference plus assumed 5 bp friction), 160 bp per side stress, and 160 bp plus one-day delayed fill. These are proposals, not owner-specific fee entitlement, historical fee reconstruction, or measured spread/impact. The official fee schedule referenced in issue #878 was retrieved 2026-10-18 and states Tier 1 taker 0.80%, subject to geography/VPN caveats. Owner approval of this revised cost grid is required.
- Screen: diagnostic primary net return positive; sampled daily-close drawdown at most 25%; return no worse than either frozen control; drawdown no worse than either control; at least 20% relative drawdown reduction versus full basket; primary positive under both stress scenarios; at least 3/4 neighbors positive at each of 85 bp and 160 bp. Zero/invalid risk denominators produce `INSUFFICIENT_EVIDENCE`. PASS would mean historical candidate only, never a holdout or significance claim.
- Segments start independently at USD 10,000. Development freezes the two static controls; diagnostic data are historical and conditioned, not a fresh holdout. The existing unknown trial-ledger completeness remains `UNKNOWN`.

## No-stop exception and unchanged gates

This proposal permits only a research-stage portfolio-level no-stop analysis. There is no finite per-trade stop, so CRV remains `UNDEFINED_NO_FINITE_STOP`, null, and not applicable for this research-only screen. No stop is invented, and no trade CRV or promotion eligibility is claimed.

This request does **not** authorize a real-data run, strategy-PnL promotion, discovery, validation, holdout, Paper, Live, trading, runtime changes, or any authorization-flag change. `canonicalExecutionAuthorized`, `strategyPnlAuthorized`, `discoveryAuthorized`, `validationAuthorized`, `holdoutAuthorized`, `paperAuthorized`, and `liveAuthorized` remain false. A later explicit owner decision must approve the exact protocol/source/input identities, costs, screen, budget, and no-stop exception before any real series is supplied.
