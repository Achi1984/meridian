# Owner execution request — proposal only

**Status: SOURCE ACCEPTED; D1 AUTHORIZED AND TECHNICALLY VERIFIED; D2 DEFERRED — NOT AN EXECUTION GRANT.** The R3 implementation source and the dormant #905 admission/profile source are accepted. The proposed historical run remains unapproved: source acceptance is not approval to admit data or execute the engine. Do not run the engine on captured market data.

The R2 `GREEN_LIGHT` (response comment `6249482850`) is historical and applies only to R2 source-and-synthetic preparation. Neither that review nor the later R3 source acceptances approve this real-run proposal, its 44-path budget, costs, screen thresholds, or no-stop exception.

## Admission states — separate, non-transitive gates

| Gate | Current state |
| --- | --- |
| `SOURCE_ACCEPTED` | `ACCEPTED`: PR #892 R3 source acceptance is recorded at mailbox #639 comment `6255139258`; dormant admission/profile source PR #905 was independently accepted and merged at `6bcaa74b35a7c093e67f144a03f82a6d77cdf9be` (mailbox #639 comments `6275925635`, `6275930095`). |
| `D1_TECHNICAL_VERIFICATION` | `AUTHORIZED_AND_VERIFIED` for the bounded D1 task only; it does not admit data or authorize D2. |
| `DATA_ADMISSION_READY` | `NOT_READY`: the selected-input manifest is `NOT_FROZEN`; the verified D1 draft is not an admitted manifest and no D2 admission receipt exists. |
| `EXECUTION_AUTHORIZED` | `FALSE`: no captured-data engine run is authorized. |
| `SCREEN_RESULT` | `NOT_RUN`: no strategy screen or return computation was performed. |
| `PAPER_ELIGIBILITY` | `NOT_ELIGIBLE`: a historical diagnostic cannot establish forward-Paper eligibility. |

Each state requires its own evidence and decision. Passing one gate does not imply
or authorize any later gate.

## Existing D1 manifest draft — identity only

The existing D1 verification metadata at
`docs/research/d1-20261019/verification.json` contains a `manifestDraft` with
canonical SHA-256
`37fecaa0d003c9ec862fb57b3b312c0289c1dd370607ade99bac584d357f81a9`. This is
identity metadata only: it is not a frozen/admitted production manifest and
grants no D2 or execution authority. The current source-only task did not read
the captured files. The D1 read-only verification was separately owner-authorized
and technically completed under issue #895; that authorization did not admit the
data or authorize D2. Reusing the verified draft identity does not require
rereading those files; any additional data read would require its own decision.

Hashes establish byte identity, not exchange authentication; source authenticity
remains `NOT_ESTABLISHED`. No acquisition/network access, signals, features,
returns, PnL, engine execution on captured data, repair, filling, substitution,
or partial acceptance is authorized by this proposal. The existing loader's
Linux `/proc/self/fd` descriptor check is an environment constraint, not an
authenticity claim.

Source acceptance is distinct from execution approval. PR #892 merged at
`6f720373af5439af70c54e6cb2f1c17abaf8b877` after exact-head CI and independent
source acceptance; mailbox #639 comment `6255139258` records that source
acceptance and explicitly leaves the selected manifest unfrozen and all runtime
gates closed. PR #905's dormant historical admission/profile source received an
independent `GREEN_LIGHT` at mailbox #639 comment `6275925635` and merged at
`6bcaa74b35a7c093e67f144a03f82a6d77cdf9be` with successful postchecks, recorded
at comment `6275930095`. That is accepted source, not an approval of the proposed
historical execution. PR #905's merge at
`6bcaa74b35a7c093e67f144a03f82a6d77cdf9be` is a historical admission/profile
source checkpoint, not current `main`. The latest observed
`main` is `2c3e3798b3296406a88988250ff54f272ae4bb91`, which includes merged PR
#923's bounded diagnostic instrumentation. PR #923's source CI and source-only
review passed before merge (2698 passed, 0 failed, 0 skipped); all four postchecks
succeeded (Release Safety 39657036131, Runtime Smoke 39657036159, Coordinator
39657036338, Pages 39657032229). Issue #922 remains open and the original startup
cause remains unknown.

Issue #924 / draft PR #925 has published a deterministic metadata-only candidate
artifact with proposed ordered path identities on its unmerged branch.
Independent source-only acceptance covers
`fc0fd0db4653630cae6c3f5a73607e02a9c9d24e` only
([PR comment 6324017218](https://github.com/Achi1984/meridian/pull/925#issuecomment-6324017218));
the candidate is not a final accepted admission artifact and creates no receipt
or execution authority. The author-reported focused test command
`node --test test/b1-7-d2-candidate.test.js` at that commit reported 6 passed,
0 failed, 0 skipped and metadata-only I/O-boundary checks
([PR comment 6324009932](https://github.com/Achi1984/meridian/pull/925#issuecomment-6324009932)).
The reviewer did not claim independent test execution, and exact-head/current-base
CI remains pending.

## Immutable identities

| Identity | Proposed value | Status |
| --- | --- | --- |
| Protocol | `MERIDIAN-B1-7-PROTOCOL-R3-20261018`; raw `protocol.json` SHA-256: `a78e1ae8c71c8f85baee5b51f5691643fc29136f636f19465c61f553afe09185` | Frozen file identity |
| Implementation | `MERIDIAN-B1-7-ENGINE-R3`; candidate bundle SHA-256 `ab73261f01b27b8655ffea7979fec03eb1a9bea667b6fc4cda8d77b75c4f3e06` | Accepted source identity; no data admission or execution authority |
| Generated bridge manifest | SHA-256 `98a9c4442a140c1e78d60251d312ad489975f58f8f5c48a87a8916b141c1c361`; computation order SHA-256 `223220ee0d8b4569ca02b99399bac71364203478e3720cab5e93ad957e6ec6d0` | Mechanically refreshed from the unchanged generated fixture and implementation; fixture identity, descriptors, and computation order unchanged |
| Inactive historical run profile | `MERIDIAN-B1-7-HISTORICAL-ONE-SHOT-R1`; existing canonical inactive-profile SHA-256 `160b73ff9c380b1231d0a1e4a88566493408f978857a3b13d71826852a413fc8`; source-identity SHA-256 `3e3973847b2b37cffa11b2df1be0b832d3227692857ff4bb2631ca5ff48ad773` | `NOT_FROZEN`, with null input manifest and D2 receipt. This inactive-profile digest is not a final activated-profile digest. |
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
| `scripts/research-supervisor/b1_bridge_manifest.json` | `0a90728308f65fdcc387c3c7130c0792eaa18e921d193ac8ba61a3f428577921` |
| `scripts/research/b1-7/historical-admission.mjs` | `eb3bef19553a299c27023bc4558157b75267fa99adf23661e5efb5730b905f04` |
| `scripts/research/b1-7/historical-profile.mjs` | `1df24e3372acb900ead091aef55f6f6fc2288a81bcf769e7587fb36e12aaad17` |
| `scripts/research-supervisor/historical_adapter.mjs` | `79bef665862be2a1751d201c6303c571344c42cdc7fe76897c66ff74561c5c5f` |
| `scripts/research-supervisor/b1_adapter.mjs` | `2d912e011e441abee4c884236a8a4c09791b502151f470e7388cd2333b1ee165` |
| `scripts/research-supervisor/supervisor.py` | `6eb664e328bb105063d9a3eabf06b0b5c54140620141d3ee9db00744f246385c` |
| `scripts/research-supervisor/journal.py` | `83c1d37557afff72adfc08dbd2a0036db3fb7c45a895a679b7015c3f23cc055e` |

The exact seven proposed assets and copied normalized-file SHA-256 values are:

The implementation bundle digest is SHA-256 of canonical JSON with keys
`capturedInputSha256`, `engineSha256`, and `validatorSha256` containing the raw
file hashes above. This binds the accepted source bytes; it does not establish a
frozen input manifest, authorize execution, or approve the proposed run. The
engine accepts the bundle hash as caller-supplied identity and does not inspect
its own source. The captured-input module remains inactive: the selected-input
manifest is not frozen and production admission is absent.

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

R3 source review is accepted; neither it nor the historical R2 review approves
this proposal. The 10 bp spot taker reference plus 5 bp assumed friction and
30 bp stress must be explicitly included in a separate genuine owner decision.
Neither is account-specific entitlement or a claim about OKX fills.

This request does **not** authorize a real-data run, strategy-PnL promotion, discovery, validation, holdout, Paper, Live, trading, runtime changes, or any authorization-flag change. `canonicalExecutionAuthorized`, `strategyPnlAuthorized`, `discoveryAuthorized`, `validationAuthorized`, `holdoutAuthorized`, `paperAuthorized`, and `liveAuthorized` remain false. A later explicit owner decision must approve the exact protocol/source/input identities, costs, screen, budget, and research-only no-stop exception before any real series is supplied.

## Current D2 decision text — defer, not approval

> **D2 DECISION: DEFER / NOT APPROVED.** Do not read captured market files or
> execute the engine. The selected-input manifest remains `NOT_FROZEN`; no D2
> receipt exists. D1 was separately authorized and technically verified, but its
> draft metadata is not admission or execution authority. Reuse that verified
> identity without rereading files solely to adopt it; any additional data read
> needs its own decision. Accepted source identities do not approve the proposed
> run. Before any future execution, a separate genuine owner decision must bind
> the final protocol, implementation, input, profile, and ordered-path identities,
> one trial, all 44 paths, costs, screen, limits, and research-only no-stop
> exception. Any future result remains non-holdout research evidence and grants
> no execution, promotion, Paper, or Live authority.

The remaining gates are separate and conjunctive:

1. Review and align the #925 proposal to current main, then independently verify
   any final admission artifact carrying the final protocol, implementation,
   input-manifest, input, ordered-path, and run-profile identities. The candidate
   artifact on the open PR branch is not an admission receipt, and its candidate
   identities are not final accepted identities. Do not freeze or activate a
   profile in this reconciliation.
2. Record a separate genuine owner decision for the fixed one-trial/44-path
   proposal, 30-minute batch, 60-second path, 1 MiB output limit, 15/30 bp
   scenarios including the one-day delay, the exact screen, and the research-only
   no-finite-stop exception. Current source acceptance and the D1 approval are
   not that decision.
3. Verify the actual execution context and journal status before any later
   execution proposal; no execution context or journal check is represented as
   complete here.

Until those gates are satisfied, the profile remains inactive, `NOT_FROZEN`, and
without a D2 receipt. No real-data execution, Paper, or Live permission exists.
