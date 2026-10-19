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

## Existing D1 manifest draft — identity only

The existing verified metadata at
`docs/research/d1-20261019/verification.json` contains a `manifestDraft` with
canonical SHA-256
`37fecaa0d003c9ec862fb57b3b312c0289c1dd370607ade99bac584d357f81a9`. This is
identity metadata only: it is not a frozen/admitted production manifest and
grants no D2 or execution authority. The current source-only task did not read
the captured CSVs. Reusing the verified draft identity does not require
rereading those files; any additional data read would require its own decision.

Hashes establish byte identity, not exchange authentication; source authenticity
remains `NOT_ESTABLISHED`. No acquisition/network access, signals, features,
returns, PnL, engine execution on captured data, repair, filling, substitution,
or partial acceptance is authorized by this proposal. The existing loader's
Linux `/proc/self/fd` descriptor check is an environment constraint, not an
authenticity claim.

The current candidate includes #890 at merge `fd07a8df49cbe24c73e9819170cd36e6b9645157` and #894 at merge `bfaf17cd5d96db6abe248ce9c4a1fcf83f190ca4`. For #890, corrected head `4333259f11992042d39e1b4c6ec7472f56c74921` passed Release Safety run `39150912974`, attempt 2; the earlier failed run remains historical and is not relabeled. Its post-merge Release Safety failure (`39155412745`, 2662 pass/1 fail) also remains historical and was corrected by #894. For #894, Release Safety `39157878217`, Runtime Smoke `39157878067`, Release Coordinator `39157878080`, and Pages `39157877431` all succeeded on `bfaf17cd5d96db6abe248ce9c4a1fcf83f190ca4`. These are dependency receipts, not CI or review of this integrated candidate.

## Immutable identities

| Identity | Proposed value | Status |
| --- | --- | --- |
| Protocol | `MERIDIAN-B1-7-PROTOCOL-R3-20261018`; raw `protocol.json` SHA-256: `a78e1ae8c71c8f85baee5b51f5691643fc29136f636f19465c61f553afe09185` | Frozen file identity |
| Implementation | `MERIDIAN-B1-7-ENGINE-R3`; candidate bundle SHA-256 `ab73261f01b27b8655ffea7979fec03eb1a9bea667b6fc4cda8d77b75c4f3e06` | Source-only checkpoint identity; source acceptance remains pending exact-head CI and full independent review |
| Generated bridge manifest | SHA-256 `98a9c4442a140c1e78d60251d312ad489975f58f8f5c48a87a8916b141c1c361`; computation order SHA-256 `223220ee0d8b4569ca02b99399bac71364203478e3720cab5e93ad957e6ec6d0` | Mechanically refreshed from the unchanged generated fixture and implementation; fixture identity, descriptors, and computation order unchanged |
| Historical run profile | `MERIDIAN-B1-7-HISTORICAL-ONE-SHOT-R1`; canonical run-profile SHA-256 `abb487c2adc40ac0b5bd58e13ae3bf46b1f26afdf4767880f0b5095fcbdf8795`; source-identity SHA-256 `0a6719238e9451d14cefb01a82f5c7fa2864e6acae6328ec4913d7545dd2f2da` | Inert profile identity; status `NOT_FROZEN`, no input manifest or D2 receipt, and no historical path IDs until input metadata is frozen |
| Source basis | Git commit `1c7b6dccd886f57e866c7d359c091b1e72a193ea` | Pinned source/input-provenance commit |
| Existing D1 manifest draft | Canonical SHA-256 `37fecaa0d003c9ec862fb57b3b312c0289c1dd370607ade99bac584d357f81a9` | Verified identity metadata only; not frozen, admitted, or execution authority; no reread is required solely to adopt this identity |
| Input admission | Selected-series manifest SHA-256: `NOT_FROZEN`; engine input identity: `NOT_FROZEN` | No captured series loaded or hashed in this task; production loader remains blocked |
| Offline provenance record | `research/acquisitions/kraken-usd-daily-20261018/offline-verification.json` | Hash provenance only; source authenticity is not established |

The historical run-profile identity canonically binds the protocol and
implementation, pinned source-file hashes, source-basis commit, D1 input-manifest
state, the exact 44 descriptors and computation order, and the fixed scope and
limits. Historical path IDs, manifest digest, and computation-order digest are
derived from the selected-series hashes in an input manifest using the engine's
input-bound identity formula; they are null while the production manifest is
null and are never copied from the synthetic profile. The source-identity
digest is SHA-256 over the profile's canonical source-hash map. The D1 manifest
and D2 approval receipt remain null; the profile is not an approved manifest
or authority flag.

The historical profile's exact source-file SHA-256 pins are:

| Source file | SHA-256 |
| --- | --- |
| `scripts/research/b1-7/engine.mjs` | `64df8c6fe5a587397b312447d310cb285f552da5b686a11b3a1d0f9441b9bb8f` |
| `scripts/research/b1-7/validate.mjs` | `2052c0fae0082622f48a18abb4a6dacc0ffa679fb5da01df5779b398f5a578fc` |
| `scripts/research/b1-7/captured-input.mjs` | `93d05a81625fed4e7f56f889a1b3b2950ac98191f183dff99f5c7f44a276f02d` |
| `research/protocols/b1-7-20261018/protocol.json` | `a78e1ae8c71c8f85baee5b51f5691643fc29136f636f19465c61f553afe09185` |
| `scripts/research-supervisor/b1_bridge_manifest.json` | `959f45204b81ce5ec4c679f336236eb78c90f94deb81b4e199aac2e45cecc7a6` |
| `scripts/research/b1-7/historical-admission.mjs` | `eb3bef19553a299c27023bc4558157b75267fa99adf23661e5efb5730b905f04` |
| `scripts/research/b1-7/historical-profile.mjs` | `1df24e3372acb900ead091aef55f6f6fc2288a81bcf769e7587fb36e12aaad17` |
| `scripts/research-supervisor/historical_adapter.mjs` | `79bef665862be2a1751d201c6303c571344c42cdc7fe76897c66ff74561c5c5f` |
| `scripts/research-supervisor/b1_adapter.mjs` | `2838b8bcce3a5483b9a404ddd64237c74c4528b46cefb66ccfccb72c8bf548cf` |
| `scripts/research-supervisor/supervisor.py` | `6eb664e328bb105063d9a3eabf06b0b5c54140620141d3ee9db00744f246385c` |
| `scripts/research-supervisor/journal.py` | `923670817e2d467218d17e4e0e6b2e3bec8ed7ad99e798069480f35ba521e14b` |

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
> `NOT_FROZEN`; no D2 receipt exists. Reconsider only after the owner has
> authorized any data read that remains necessary; reuse the already verified D1
> `manifestDraft` identity without rereading files solely to adopt that identity.
> The D1 metadata is not admission or execution authority. The final source and
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
and the ordered path IDs derived from that manifest. The receipt schema validates
identity fields but is not an authentication mechanism: owner strings and hashes
do not prove consent. Activation requires an actual separate owner decision; the
Lead-controlled change records that decision after review. The verified existing
D1 `manifestDraft` may supply identity metadata without another market-file read.
The receipt is excluded from the run-profile digest to avoid self-reference; the
profile identity includes all other frozen fields.
No source code, fixture identity, descriptor, computation order, or
authorization flag should change as part of that later activation. Any source
change requires renewed identities, CI, and review before activation.
