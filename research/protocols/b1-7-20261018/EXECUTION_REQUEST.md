# Owner execution request — proposal only

**Status: PROPOSAL ONLY — NOT APPROVED / NOT AN EXECUTION GRANT.** R3 independent review is pending. This request is for a later, separate owner decision after synthetic source review, exact-head CI, and independent full source review. Do not run the engine on captured market data while this request is pending.

The R2 `GREEN_LIGHT` (response comment `6249482850`) is historical and applies only to R2 source-and-synthetic preparation. It does not review R3 or approve this real-run proposal, its 44-path budget, costs, screen thresholds, or no-stop exception.

## Admission states — separate, non-transitive gates

| Gate | Current state |
| --- | --- |
| `SOURCE_ACCEPTED` | `PENDING`: #890 merge/postchecks and subsequent exact-head source CI/full independent review remain outstanding. This candidate's hashes are provisional, not accepted source pins. |
| `DATA_ADMISSION_READY` | `NOT_READY`: the selected-input manifest is `NOT_FROZEN`; no data-read approval has been granted. |
| `EXECUTION_AUTHORIZED` | `FALSE`: no captured-data engine run is authorized. |
| `SCREEN_RESULT` | `NOT_RUN`: no strategy screen or return computation was performed. |
| `PAPER_ELIGIBILITY` | `NOT_ELIGIBLE`: a historical diagnostic cannot establish forward-Paper eligibility. |

Each state requires its own evidence and decision. Passing one gate does not imply
or authorize any later gate.

## Separate selected-manifest read decision — draft only

**Decision requested: D1, permission to read the allowlisted files solely to build
and verify a selected-series manifest. Status: PENDING; NOT APPROVED and NOT
PERFORMED.** The independently frozen selected-input manifest remains
`NOT_FROZEN` unless this specific data-read approval is granted.

The proposed read is limited to the seven normalized paths already listed in this
request, in this order: XBTUSD, ETHUSD, SOLUSD, XRPUSD, LINKUSD, AVAXUSD, SUIUSD.
For each, read only its allowlisted file under
`research/acquisitions/kraken-usd-daily-20261018/normalized/`; require exactly 955
daily rows from 2024-02-19 through 2026-09-30 and the existing seven-column
`timestamp_utc,open,high,low,close,volume,trades` schema. Compare each raw
whole-file SHA-256 with the value already recorded below, validate the generated
selected rows with the existing B1 verifier, and calculate their selected-series
SHA-256. A future manifest would contain only the pinned source-commit assertion,
the seven raw whole-file hashes, and the seven selected-series hashes; it is not
created or frozen by this proposal.

No other paths or assets are in scope. No acquisition/network access, signals,
features, returns, PnL, engine execution, sorting, repair, filling, substitution,
or partial acceptance is allowed. Any path, byte, schema, calendar, count, or hash
mismatch stops the read without repair. Hashes prove byte identity only: source
authenticity is `NOT_ESTABLISHED`; the offline provenance record is not exchange
authentication. The existing loader's Linux `/proc/self/fd` descriptor check is
an environment constraint, not an authenticity claim.

A separate later D2 decision would be required to freeze/admit the resulting
manifest and authorize any fixed historical batch. D1 alone grants neither
admission nor execution; D2 would bind exact final identities and the unchanged
protocol, costs, screen, budget, and research-only no-stop scope.

## Immutable identities

| Identity | Proposed value | Status |
| --- | --- | --- |
| Protocol | `MERIDIAN-B1-7-PROTOCOL-R3-20261018`; raw `protocol.json` SHA-256: `a78e1ae8c71c8f85baee5b51f5691643fc29136f636f19465c61f553afe09185` | Frozen file identity |
| Implementation | `MERIDIAN-B1-7-ENGINE-R3`; candidate bundle SHA-256 `42a0f62acded9f8a0e76b858382940c1c35a747ae1e6eb972936e036902620ae` | Provisional three-file identity at this preparation base only; final accepted identity must be recomputed after #890 integration and review |
| Source basis | Git commit `1c7b6dccd886f57e866c7d359c091b1e72a193ea` | Pinned source/input-provenance commit |
| Input manifest | Independently frozen selected-series manifest: `NOT_FROZEN` | No captured series loaded or hashed in this task; production loader remains blocked |
| Offline provenance record | `research/acquisitions/kraken-usd-daily-20261018/offline-verification.json` | Hash provenance only; source authenticity is not established |

The exact seven proposed assets and copied normalized-file SHA-256 values are:

The current provisional bundle digest is SHA-256 of canonical JSON with keys `capturedInputSha256`, `engineSha256`, and `validatorSha256` containing these raw-file SHA-256 values: `captured-input.mjs` = `dca0103f11dace0263e975d7744ebb8e4c52fb83955b3f2a33f472466c220597`; `engine.mjs` = `64be9258b32c0724923f1f3f72c5d13ca438da3a56e2c58b8b43b706f4446f6a`; `validate.mjs` = `2052c0fae0082622f48a18abb4a6dacc0ffa679fb5da01df5779b398f5a578fc`. It is deliberately provisional: do not treat it as an accepted final source hash or as a future #890-integrated pin. The engine accepts the bundle hash as caller-supplied identity and does not inspect its own source. The captured-input module remains inactive: the independently frozen selected-input manifest and production admission are absent, so no market CSV is read.

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
