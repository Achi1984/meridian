# Owner execution request — proposal only

**Status: PROPOSAL ONLY — NOT APPROVED / NOT AN EXECUTION GRANT.** R3 independent review is pending. This request is for a later, separate owner decision after synthetic source review, exact-head CI, and independent full source review. Do not run the engine on captured market data while this request is pending.

The R2 `GREEN_LIGHT` (response comment `6249482850`) is historical and applies only to R2 source-and-synthetic preparation. It does not review R3 or approve this real-run proposal, its 44-path budget, costs, screen thresholds, or no-stop exception.

## Admission states — separate, non-transitive gates

| Gate | Current state |
| --- | --- |
| `SOURCE_ACCEPTED` | `PENDING`: #890 and #894 are integrated on `main` at `bfaf17cd5d96db6abe248ce9c4a1fcf83f190ca4`, with their named CI/postchecks successful. This integrated #892 candidate still requires exact-head CI and full independent review before source acceptance. |
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

The current candidate includes #890 at merge `fd07a8df49cbe24c73e9819170cd36e6b9645157` and #894 at merge `bfaf17cd5d96db6abe248ce9c4a1fcf83f190ca4`. For #890, corrected head `4333259f11992042d39e1b4c6ec7472f56c74921` passed Release Safety run `39150912974`, attempt 2; the earlier failed run remains historical and is not relabeled. Its post-merge Release Safety failure (`39155412745`, 2662 pass/1 fail) also remains historical and was corrected by #894. For #894, Release Safety `39157878217`, Runtime Smoke `39157878067`, Release Coordinator `39157878080`, and Pages `39157877431` all succeeded on `bfaf17cd5d96db6abe248ce9c4a1fcf83f190ca4`. These are dependency receipts, not CI or review of this integrated candidate.

## Immutable identities

| Identity | Proposed value | Status |
| --- | --- | --- |
| Protocol | `MERIDIAN-B1-7-PROTOCOL-R3-20261018`; raw `protocol.json` SHA-256: `a78e1ae8c71c8f85baee5b51f5691643fc29136f636f19465c61f553afe09185` | Frozen file identity |
| Implementation | `MERIDIAN-B1-7-ENGINE-R3`; loader/engine/validator bundle SHA-256 `14c96aa599498b89dfa5a068e674db94d0080441885af43b962c502dc251be5d` | Source-only checkpoint identity; source acceptance remains pending exact-head CI and full independent review |
| Generated bridge manifest | SHA-256 `c91086aef46bf0aeeec3865774e6c6ead1eeaac364bb1094542a575ff38e40f3`; computation order SHA-256 `18a297fb3cbc1e95b3d52d79df45b89c7b1215dee0c3f6675f9386f48464cafc` | Mechanically refreshed from the unchanged generated fixture and implementation; fixture identity, descriptors, and computation order unchanged |
| Historical run profile | `MERIDIAN-B1-7-HISTORICAL-ONE-SHOT-R1`; canonical run-profile SHA-256 `7ec0c8050aef94e514953e85955dcd94108f7b171b6e4393a816abfd05d797d7`; source-identity SHA-256 `810313eb87548b0cccf6be61bafb502dc4a1a3750b4fafeff47cdf64bd78bd98` | Inert profile identity; status `NOT_FROZEN`, no input manifest or D2 receipt |
| Source basis | Git commit `1c7b6dccd886f57e866c7d359c091b1e72a193ea` | Pinned source/input-provenance commit |
| Input manifest | Selected-series manifest SHA-256: `NOT_FROZEN`; engine input identity: `NOT_FROZEN` | No captured series loaded or hashed in this task; production loader remains blocked |
| Offline provenance record | `research/acquisitions/kraken-usd-daily-20261018/offline-verification.json` | Hash provenance only; source authenticity is not established |

The historical run-profile identity canonically binds the protocol and
implementation, pinned source-file hashes, source-basis commit, D1 input-manifest
state, the exact 44 path IDs/descriptors and computation order, and the fixed
scope and limits. The source-identity digest is SHA-256 over the profile's
canonical source-hash map. The D1 manifest and D2 approval receipt remain null;
the profile is not an approved manifest or authority flag.

The historical profile's exact source-file SHA-256 pins are:

| Source file | SHA-256 |
| --- | --- |
| `scripts/research/b1-7/engine.mjs` | `64df8c6fe5a587397b312447d310cb285f552da5b686a11b3a1d0f9441b9bb8f` |
| `scripts/research/b1-7/validate.mjs` | `2052c0fae0082622f48a18abb4a6dacc0ffa679fb5da01df5779b398f5a578fc` |
| `scripts/research/b1-7/captured-input.mjs` | `6690db7b0564254f9e36730ca72f51050d1ff6b5f3ca13eeea2f82ec428999e8` |
| `research/protocols/b1-7-20261018/protocol.json` | `a78e1ae8c71c8f85baee5b51f5691643fc29136f636f19465c61f553afe09185` |
| `scripts/research-supervisor/b1_bridge_manifest.json` | `6dece00d84fc8e34d6dc15b50b969ddbd9f38f3aec630746dffdbb3144e7cf25` |
| `scripts/research/b1-7/historical-admission.mjs` | `e89aae1d9cdfa6d2658b1ba729626402adae918a365f25aaedf375b261be56e1` |
| `scripts/research/b1-7/historical-profile.mjs` | `5109725c172322525184054a8767d722b6d6176721d8be752320586fcc3d6e6d` |
| `scripts/research-supervisor/historical_adapter.mjs` | `79bef665862be2a1751d201c6303c571344c42cdc7fe76897c66ff74561c5c5f` |
| `scripts/research-supervisor/b1_adapter.mjs` | `1b9e03a2a31cc9816d686b937d126a6ae2c0f7acad0350138a0ef46ad85e529c` |
| `scripts/research-supervisor/supervisor.py` | `6eb664e328bb105063d9a3eabf06b0b5c54140620141d3ee9db00744f246385c` |
| `scripts/research-supervisor/journal.py` | `4cb81ff2e77bd3da99613789b64dbcf5c4f39b30f0afdca19f88e6b2c4e72d83` |

The exact seven proposed assets and copied normalized-file SHA-256 values are:

The implementation bundle digest is SHA-256 of canonical JSON with keys
`capturedInputSha256`, `engineSha256`, and `validatorSha256` containing the raw
file hashes above. This binds the current source bytes but is not accepted until
exact-head CI and full independent review. The engine accepts the bundle hash as
caller-supplied identity and does not inspect its own source. The captured-input
module remains inactive: the independently frozen selected-input manifest and
production admission are absent, so no market CSV is read.

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

## Current D2 decision text — defer, not approval

> **D2 DECISION: DEFER / NOT APPROVED.** Do not read captured market files or
> execute the engine. The selected-input manifest and its SHA-256 remain
> `NOT_FROZEN`; no D2 receipt exists. Reconsider only after a separate D1
> decision produces the exact selected-series manifest, the final source and
> run-profile identities pass exact-head CI and full independent review, and an
> owner decision explicitly binds that manifest, the R3 protocol, one trial,
> all 44 ordered paths, costs, screen, budget, and no-finite-stop exception.
> Any future historical result remains non-holdout research evidence and grants
> no execution, promotion, Paper, or Live authority.

This is a proposed deferral record for the current source-only packet, not an
owner approval or an execution grant. The minimal later activation diff is a
Lead-controlled, independently reviewed change to
`scripts/research-supervisor/historical_run_profile.json`: set
`status` to `FROZEN_FOR_D2`, populate the exact D1 manifest, manifest/input
hashes, and a schema-valid D2 receipt bound to `sourceIdentitySha256`,
protocol/implementation, run-profile, manifest/order digests, fixed trial key,
and the ordered path IDs. The receipt is excluded from the run-profile digest to
avoid self-reference; the profile identity includes all other frozen fields.
No source code, fixture identity, descriptor, computation order, or
authorization flag should change as part of that later activation. Any source
change requires renewed identities, CI, and review before activation.
