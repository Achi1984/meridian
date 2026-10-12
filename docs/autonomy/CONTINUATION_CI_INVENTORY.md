# Continuation CI inventory — frozen design evidence

Status: proposal input, not policy adoption or activation. Repository `Achi1984/meridian`; examined commit `0e28cd177a3af0423092789647b439f60fed809f`; workflow tree `8968c2b066c8751de6658ef1428ff5984188f0da`. All 75 YAML files in that tree were fetched by exact commit on 2026-10-10. This is not a claim about workflow enabled/disabled state or the current main after that commit.

## Method and limits

Automated extraction: YAML parsed using Python PyYAML BaseLoader (keeps `on` as a string), static workflow/job permissions, declared events and filters, action inputs, checkout settings, lexical secret-reference names, Git blob SHA-1 and content SHA-256. Every fetched body is checked against its Git blob hash. The per-file rows below are source facts.

Manual semantic analysis: event revision meanings, trust boundaries and risk observations. No workflow, model, repository code, dependency install or Actions run was executed. Scripts called by workflows, action internals and runtime branch choices are not exhaustively analyzed; missing runtime revisions are UNKNOWN. This is an inventory, not an automated security certification. `none found` means no direct YAML declaration/reference, not proof a called script or action cannot access it. Secret values were never requested. `github.token` is separately noted.

Permissions shown are declarations, not effective token evidence: job declarations override workflow declarations; unspecified categories in an explicit map are none. Missing declarations inherit repository/organization defaults (UNKNOWN here). Fork downgrades and account policies can reduce permissions. Checkout default persistence is true for actions/checkout v4; lack of env token does not imply lack of token access. Action tags and downloaded dependencies may move.

Revision legend: default checkout uses the triggering ref/SHA (PR normally synthetic merge; push pushed commit; schedule/issue_comment/workflow_run normally default branch; dispatch selected ref). An explicit ref overrides that. Exact runtime SHA is UNKNOWN absent run evidence. Main in this inventory is the source snapshot, not necessarily the checkout revision of any future run.

## Source table (complete)

| Workflow | Events | Workflow token permissions | Secret names directly referenced | Git blob SHA-1 | Content SHA-256 |
|---|---|---|---|---|---|
| adaptive-cross-venue-funding-spread-v3-data-v1.yml | push, workflow_dispatch | {"contents":"read"} | none found | 994917b370c20a717002da250a83129ee18a29c0 | da49a3ecc4133e3a702a3aa24e306351c74187a1bffff7232dcc3cff08c7e8d0 |
| adaptive-cross-venue-funding-spread-v3.yml | push, workflow_dispatch | {"contents":"read"} | none found | e6faa92fdbd54f05d5894623d7c09fbfeb0e8d94 | 5dd514d28ad7313008b55f60f73661e4c97e89aebc15e2db5cd7fb18d2ecc94c |
| adaptive-trend-sharpe-proxy-v1.yml | push, workflow_dispatch | {"contents":"read"} | none found | f3053684712cc0513b8c181e1196d20f005b52f8 | d03bf939eb87aebc9a8e686cf23b1a10900a68c51cf36d57ddadb56100cd3ca4 |
| agent-orchestration-safety.yml | pull_request, push, workflow_dispatch | {"contents":"read"} | none found | ba5f3672cd04493b1705221fa0853b92a9c665be | 49764b1f52a1c4febd86617a8825bf015cfbf1462a658faacacc1964a20671ae |
| asset-watch-mirror-watchdog.yml | schedule, workflow_dispatch | {"actions":"write","contents":"read"} | none found | 3a4fb31c592347646a21f8fc5ca1a8ae37ee28ce | 61dba56ca18fb85b0a1f1c1c3b4d7a223171e678173001dc594ea289b0d0a8de |
| asset-watch-mirror.yml | schedule, workflow_dispatch, push | {"contents":"read","id-token":"write"} | none found | 3355761833cd6b271a4bccda739443a320a9e785 | e87932d0225b0d82bf865f8fdbb69d84bea6c599c47ffcabcc6e2b704453395b |
| backend-safety.yml | pull_request, push | {"contents":"read","pull-requests":"read"} | none found | b3fc5e121b030baa21779661f3560bdd048c7888 | 8fe201168fa3ac828a7d8ad70b23af0b988e52ce1d4fd95025ce5f49f293a691 |
| claude-mailbox-review.yml | issue_comment | {"contents":"read","issues":"write","pull-requests":"read","actions":"read","id-token":"write"} | CLAUDE_CODE_OAUTH_TOKEN | 62eebded2865221d78cd1446efeaafb5685feb8d | 896ed15c25f03cb569cb8607c9c670c0ba1e427274b856afb04cd0df4d160bcd |
| claude-watchdog-15m.yml | schedule, workflow_dispatch | {"contents":"read","issues":"write","pull-requests":"read","actions":"read","id-token":"write"} | CLAUDE_CODE_OAUTH_TOKEN | 588cae9ecc01c1a82247bda94bc3b28e964dd2ef | 227375e95dc2a0998cc011a2c143b7266b0411c1b4350af5e1b8c25f9777d335 |
| copilot-ci-event-pilot.yml | workflow_run | {} | none found | b08750271f2f6988c7854be98a3fb2a0e4019f7a | 69dec1edad23252613c31ff3297c92eae222d4b36cb8cdf004279e51adef6a8c |
| copilot-coding-pilot.yml | workflow_run | {} | none found | 42890c6cb3d43abdeede468021528917391d3286 | 9f726d0eb11a01ebe0eb5196674eb8ea6d490a285bf06cc7f46c91afff189bf8 |
| copilot-readonly-pilot.yml | workflow_dispatch | {} | none found | eb227dd293ae0f96700998d7410f252dc48f87c8 | 358e6d16f3d22cc5be48869f032bf707b995f4611f5aed631b7d4341613f9652 |
| cross-sectional-funding-carry-risk-budget-v2.yml | push, workflow_dispatch | {"contents":"read"} | none found | e562ff4800c36efd19f1718652d87e4aa52dbbe5 | 63922ec94a5f0abaeb92ca31a60a7932ae38528c56153696ea9f0eef82cb7e0d |
| cross-sectional-funding-carry-v1.yml | push, workflow_dispatch | {"contents":"read"} | none found | 5a716061f035d93fd846e7f91c3b56b3ab597ab8 | 4955e351e4e5eebc58c57fb5dc82b5fa1841dee02f1a70fbd9537df4b44cff4e |
| cross-sectional-low-volatility-v1.yml | pull_request, push | {"contents":"read"} | none found | 43c72ee5dbfaf5e8002fc87f2cb95ca3e672a92f | c782f8264dae83767389836e6dfd139d3170de1e02d24b0cb2cd778b0061416d |
| cross-sectional-perpetual-factor-v1.yml | push, workflow_dispatch | {"contents":"read"} | none found | 38cd4874e125035f67bab0e7e06da9502e2ccad2 | 72bed41a3e3e3d33fda9ce5d56093f8feb2c6959695a94495db53e638e866709 |
| cross-sectional-reversal-v1.yml | pull_request, workflow_dispatch | DEFAULT UNKNOWN | none found | 8e0aae2b099c20c92d5681dbe9397e37e89da2bd | 806ff5e6675ec85967f3df6739ab208af8734a546aab47bac53141c241a605b8 |
| cross-venue-funding-edge-v1-source.yml | pull_request, push | {"contents":"read"} | none found | 300456256384a25fec892feb4dbe0fc3331ca71e | 10a21ab2d2ab6ce22848d16613b7ad517ec05379891af20bba66ba0094348968 |
| cross-venue-funding-edge-v2-source.yml | pull_request, push | {"contents":"read"} | none found | d9e427183a4a93980c01c5d44ac75b91ca4208e2 | 51f379f7281eb6fb41d6e29161f11d32d5542a2a629063b8f0dbf90c2fc21a05 |
| cross-venue-funding-spread-v1-transfer-holdout.yml | push, workflow_dispatch | {"contents":"read"} | none found | 1cce5152b2eec3d55bd1b198cfaa87a04efcffd0 | cdc44da71d1072926288b19f833c40057596aab994a2b7b5061355e8df72464a |
| cross-venue-funding-spread-v1.yml | push, workflow_dispatch | {"contents":"read"} | none found | 55cd0b483fe687f21caf162887ba744d0bd83348 | df81711b84eb11a0bae5189263b7bb5fab10c0cb3ec9734896f394816ab37546 |
| cross-venue-funding-spread-v2-data-v1.yml | push, workflow_dispatch | {"contents":"read"} | none found | b68f31bcdf0327c641c785a71499dc741ea62742 | 2213d408c24bcea4fc3085ab05587046b98ec4df46ef26c026ac4305558f2b53 |
| cross-venue-funding-spread-v2.yml | push, workflow_dispatch | {"contents":"read"} | none found | a205a71291ce3aa839db88cee299a947c01bb4ff | 3026ae8740afe26dde22926668151a8254d8a157dc59407e93728001fd353b8c |
| dynamic-grid-proxy-v1.yml | push, workflow_dispatch | {"contents":"read"} | none found | 2580b06ec3b20c2cd24287b199c94175cc835350 | 554a2635d4e0f0739e1687c8736183810b4cc2947d23179d0096fe3bfaaa45c4 |
| eth-funding-holdout.yml | pull_request, workflow_dispatch | {"contents":"read"} | none found | 8df93309e1fd62fec457bdbbd7d7631b61e8fb2a | 0d97176c67b6bd14e14ca906a35dbe848724cec9e9d1a4c40d4ebf5e555e1fd3 |
| funding-carry-risk-budget-v2-data-v1.yml | push, workflow_dispatch | {"contents":"read"} | none found | b4c6a18ebcf33fdda98d8a02e3afa5a9623de462 | 81c739dbe3a1da340c6b4c8cdee7967a0358c9e6717220aa66cd3921c2ccd418 |
| high-volatility-perpetual-cross-sectional-reversal-v2.yml | push, workflow_dispatch | {"contents":"read"} | none found | 5e4e1a9964b9dd15876047b644d964d60b177c3f | 7dba75ee04bf1e737bd5bd68b484faba3cea895a8b51b10bb4d3231dc6f80ddc |
| low-volatility-rank-weighted-v2-holdout.yml | pull_request, push | {"contents":"read"} | none found | a481844c1209609448eadc66b1690aceae1ed52f | 35f0b54aea1c31ad4e4c517986cacbfe4dbf83881c024a052a91e2d983fc81ee |
| low-volatility-rank-weighted-v2-prospective.yml | pull_request, push, workflow_dispatch, schedule | {"contents":"write"} | none found | d4935ee0b01917a84d46a9ea6919c467a8aaec03 | 6a15a52679d02200eb20960259bda16c9b768801e7c29e54b8cdc72f4927a34a |
| low-volatility-rank-weighted-v2.yml | pull_request, push | {"contents":"read"} | none found | 52bc76b5572b74cf4e7808e4f707e15bddda6769 | 7b355bc5427e058a3f59e76dbeb947de1cf107cabdaf9d6e7fed51092f9d1cb0 |
| meridian-snapshot.yml | workflow_dispatch, schedule | {"contents":"write"} | none found | b8afc976776eb040537ad54e150cca46ab4240c2 | 22140d4ef5c5fe46a719926187a96489b8626596fd7fd7a367ddde7ed67470ba |
| paper-edge-v1-discovery.yml | pull_request | {"contents":"read"} | none found | a21b5b2eff900581b4e7fc2cefed742ca0bb2bcc | ddb9a8f3bdb4cae7535d884d53912ecfd62b2ba31fc34f88a16730cd457e31b0 |
| paper-edge-v1-source.yml | workflow_dispatch, push | {"contents":"read"} | none found | 11017484a739d5dae5019a32cb7fbe47fe92c9b6 | 38ef5b25406ae564db0c007e30982f9744b175e01bef6fc49302ebe76809e911 |
| paper-profit-observer-stage-a.yml | pull_request, workflow_dispatch | {"contents":"read"} | none found | bc7b50b93cb46ff6f67e4ad810448cf5de714b72 | 6fe1758dedcb483bc9cff7713ed982820f4d37ea6575f136c17d52e37579fa94 |
| paper-profit-regime-trend-breakout-v1-holdout.yml | pull_request, push | {"contents":"read","actions":"read"} | none found | 4e6a502db972d4d2c0cd4a0b56e914d946432acc | be9027ba9d86d349d7a776625c9895d9176ffbc963d1d8ec8117e0af20cedf6d |
| paper-profit-regime-trend-breakout-v1.yml | pull_request, push | {"contents":"read"} | none found | 5158e7777631a658d68fab8e9342ba27a2ff538f | 38ec7565214018b438879f8ae3c1305eb3606f3bd81c0030eaf9629a8c1c3c68 |
| paper-profit-tsmom-v2.yml | pull_request, workflow_dispatch | {"contents":"read"} | none found | f8a000a0a6d286bf52469e87b4e3ba19d3062d9f | b3c5743ab1954f1a4b76fdcd7e4fd6ce40c449bf6dc0a7be26f4b79d686148cc |
| perpetual-cross-sectional-reversal-v1-data-v1.yml | push, workflow_dispatch | {"contents":"read"} | none found | 3198056497c361cc5a860685f7371007c2bfaf4b | fc667ad112c8bfdfcd8e3f298be77e88c70b96394fbfc88db4e04e20241fda80 |
| perpetual-cross-sectional-reversal-v1.yml | push, workflow_dispatch | {"contents":"read"} | none found | 0589d203381accb4a1f8188003673bd948b858f5 | 73e91f7a149259ba590e517e032cf1eea4bc7aca954ecf388a2f5b73d8bb0339 |
| perpetual-factor-data-v1.yml | push, workflow_dispatch | {"contents":"read"} | none found | 68374ec012804d76e18723154dacfd164f821d40 | e15bf19153f164c9925df9cca6e3a808c95a70a0c296179ab2c89992f3099364 |
| perpetual-factor-row-continuity-v1.yml | push, workflow_dispatch | {"contents":"read"} | none found | fb896be5c026375ab0ba6d365fd3e088f27acbbc | 547c35200f7f72dd1d0133340c4a3dc27e6bdcc07de8b7e710d3ce3fcddfa15c |
| perpetual-relative-value-reversal-v3-data-v1.yml | push, workflow_dispatch | {"contents":"read"} | none found | 9b54cbcb8451a1e423ce8a59d64e1e18d9d991e1 | 6b23e9d33615fe5791f7d9667539e5d6f81186695052f56a4a3d8bd97f5f3188 |
| perpetual-relative-value-reversal-v3-data-v2-broad-market.yml | push, workflow_dispatch | {"contents":"read"} | none found | 8f55a628938e8ac5b3fde8e6c6719d747eebcc0e | f96c7a454fe02676a845c7eae1cb4c3dbaa5c11cc2d78fd3959cba6e9c7310ca |
| perpetual-relative-value-reversal-v3-primary.yml | push, workflow_dispatch | {"contents":"read"} | none found | 0b3df24bb4858fa68d8fe87379a67aede61cabb5 | b35dfc774aa1cc3ac010a625bccbef52499e2d3fd9107199cf121508b47b8704 |
| perpetual-relative-value-reversal-v3-protocol.yml | push, pull_request, workflow_dispatch | {"contents":"read"} | none found | 873f24a359da14570f68f5899e727db276f405e8 | 08e0cf6bce6898ada611529be5855ddd0cf45f144851f3148e893b880d3717e3 |
| perpetual-taker-order-flow-relative-strength-v2.yml | pull_request, push | {"contents":"read"} | none found | 5efd8fdfc7efcb61010b4390bfe81c20155effb3 | 95c542535be0976903eb8b6c67b34630280b9718bc25af1005c55d69190a95ff |
| perpetual-taker-order-flow-v1-data.yml | push, workflow_dispatch | {"contents":"read"} | none found | f7cd62ebb5f5b7c3d14f16d091f4af185d88a39c | 8700be42e8252933428a77c87b9a3b04d4db908781d0c0620dfe3d2cc6d61fd7 |
| perpetual-taker-order-flow-v1-development.yml | push, workflow_dispatch | {"contents":"read"} | none found | d723da858d12c4ac09438e09bc9d6c401f36b20b | 5d1764c154dd0910d77cd991fc01ef76794da73371b0e8bd1d0de1ca43b9d43d |
| perpetual-taker-order-flow-v1-invariants.yml | push, pull_request, workflow_dispatch | {"contents":"read"} | none found | f98a0881be1fe7f672cdf7154d3fd7794ea30fbf | d2e3b90b0806842dfe5a090554f5361778a53bf380de25a808479ddbb8aec4bc |
| perpetual-taker-order-flow-v1-provenance.yml | pull_request, push, workflow_dispatch | {"contents":"read"} | none found | a49a5ed4bed225611b8cb6af4e8323f6e66773ca | 48f3aa46b0e3d9042f4d56782aee1bea6b388204689f1e43ff6106f6ec4e0199 |
| portfolio-contract-v763.yml | push, pull_request, workflow_dispatch | {"contents":"read"} | none found | 0933e20f3e4784060f47ff945eb921366401372c | 25a4db336a302e32f25778830576f3d5d1267dfe3817823d55161c9fc5f0b863 |
| portfolio-history-v764.yml | push, workflow_dispatch | {"contents":"read"} | none found | da8a7e6382e4443529363c28af7816cfbd120e85 | 6663ddcdcb1be063ce0747600a4209a13a40da1ccaed481955f07ad4e3b90f64 |
| qh-boundary-strategy-v1.yml | pull_request, push | {"contents":"read","actions":"read"} | none found | 4dd3338b12df7f1f53153ffd2cb2c24c529a2a4b | 4e11e95b821f79644237937ef60084f03f9ed909ea41a1689b782c95b5dc00a2 |
| qh-boundary-strategy-v2.yml | pull_request, push | {"contents":"read","actions":"read"} | none found | da9eb28f506104bc04f3308a2703a4cbd97ed62d | 790b334bf7524333031605214ce1d2c251c7509131a3c0bc0208aab17191cd32 |
| qh-individual-trades-data-v1-1.yml | pull_request, push, workflow_dispatch | {"contents":"read"} | none found | 891f43c413e5322378ad38654b07834d36ea1435 | 8e04cd8b754420729b8b382f04cf0d85ecc95f4b21fc98a9a58c8403368f2ee9 |
| qh-individual-trades-data-v1-3.yml | pull_request, push | {"contents":"read"} | none found | 8da391c305c0428eb15d99442748a0d754ad3f8a | 4a535448989f24f21c923909ee07f328409837597cf5eb310a944b7d5d925322 |
| qh-individual-trades-source-v0-1.yml | push, workflow_dispatch | {"contents":"read"} | none found | 72945f724aaefd64a2962632502b2363a9023f88 | 0ef3e47de5911f2fe6735797dbca23b6495ab90ec5fdbcb982c98ea05f01f488 |
| quarter-hour-boundary-imbalance-v1-data-v0.yml | pull_request, workflow_dispatch | {"contents":"read"} | none found | 2ede8e5865892256b8e68f4e1628c8aa69192c6d | 0b9fb5d92e603c66ab2337fe7ad339c1a49e6e6d9c1b0b8ba083cf2008e0dc9f |
| quarter-hour-boundary-imbalance-v1-data-v1.yml | pull_request, push, workflow_dispatch | {"contents":"read"} | none found | 45dd2341a5d69cbe2561aabf5a28ee9bfd594f6b | ff2c373c35938c13eb6b1faea99d3fc135f176a0c2a27b8c33cb5533284e4f83 |
| regime-gated-grid-v2.yml | push, workflow_dispatch | {"contents":"read"} | none found | c253915ae8eb7f28a0b9db0d9858ff9144262182 | f41d2fb79d8b9dcd139444f1b835c0a07834f9b16d8426530225a4282de69935 |
| release-coordinator.yml | push, workflow_dispatch | {"contents":"read","pull-requests":"write"} | none found | 828e266544c2ca88a1f56c83c66a880f44aa81b3 | ae092a24d8915796bf63a7d71ae3b9ed8951774094c19f5a15a7238426e9ebc5 |
| research-profit-discovery-v1.yml | push, workflow_dispatch | {"contents":"read"} | none found | 33209e0efbf7e1011561cf0f9103b15788f6168d | a0b48921307bb054db11b685f3e7d32853a884a95467e70708a9e6956a928002 |
| research-profit-v2-upup.yml | push, workflow_dispatch | {"contents":"read"} | none found | 2673da0f4f9839fdec151cfa15b431ce40924039 | 28e4698fea101d85276919f3f3a9cc59e16272d0cbd1f5879c3a317efc641cd3 |
| runtime-smoke.yml | push, schedule, workflow_dispatch | {"contents":"read","statuses":"write"} | none found | 2aa121cdbeb73ea5ce802ea51370e25994247fcf | 64f45e598bbf28dc8f2a004f458802d5730cf7f116dba2ab8289c924f9096809 |
| selective-static-cross-venue-funding-v4.yml | push, workflow_dispatch | {"contents":"read"} | none found | 8fc4856e58730e3539df12986c3922766df4e254 | d0524f45fd7c23c9f0d610e28f53a78da7262b249a6d50aee2888b3e1c621b79 |
| self-history-perp-factor-v2.yml | push, workflow_dispatch | {"contents":"read"} | none found | 0d2f623d7065696b8ae1d07844d549228331c52f | c77dc90fb8e9721bba2daf5249732af2cd8f8481ecd066aae901e99b1b59d209 |
| self-history-perp-factor-v3.yml | push, workflow_dispatch | {"contents":"read"} | none found | c655ea2060306275fc5c561f2977dc55a6c4321d | 10618ba12fe6e1242b6bb66e769c5c6d63801172736b5c775fdec9d61d40a9d1 |
| spot-perp-basis-dislocation-v1-data-v1.yml | push, workflow_dispatch | {"contents":"read"} | none found | 45b7ca9bf7e57f425a7fed4572aa62aa0fc4200d | 3b2c4cb404b4c2011276fb52e31f7474dfe5835060191d4cf94db86fa83b50b2 |
| spot-perp-basis-dislocation-v1.yml | push, workflow_dispatch | {"contents":"read"} | none found | 02da099efc881a5fe41ed8d95c5e199db7ed43e0 | f2e75b6f0ecc397a329a95a7071c459ef3c902a2adf2723a2ad87ddf18470ac1 |
| spot-perp-basis-volatility-regime-v1.yml | push, workflow_dispatch | {"contents":"read"} | none found | 3d2de5f91aaed8aac67486cbe0a281a2dccb9713 | 17b76cf3fc829f6833913bdfc4efc8a7a9db32ac8ba75fef62c2d2a7ed318098 |
| spot-perp-funding-harvest-v1-data-v1.yml | push, workflow_dispatch | {"contents":"read"} | none found | fe099aa11bb883bb44c0dab653c3d3ca7e048472 | e7ec95584d2a4cb5206b9c2b9d8d48879e18b42a82e6857a753597861dd3dd52 |
| spot-perp-funding-harvest-v1-data-v2.yml | push, workflow_dispatch | {"contents":"read"} | none found | fc30423ab21346b2e6f6ff4f9082df3202750a2a | d332438bb1a7dc4baaf0a2b9c1ad5d49f28c66a4465144b600fb907bb24daf2d |
| spot-perp-funding-harvest-v1.yml | push, workflow_dispatch | {"contents":"read"} | none found | 67595b2b3a10a8fedab5ffd0404a5a24af3321bf | 596400032cc66c9500731886c9ebb0252ed33369cf865a57b29bd2ee0ea27a7a |
| spot-perp-funding-persistence-v2.yml | push, workflow_dispatch | {"contents":"read"} | none found | f1441beea6c44bfc7972dcf9fe7b5ac750e4f79d | e210ff4f3037aeccf67bf2d6456cfd94467bf3c7ed45bce0783bb8df4258411e |
| v10-visual-qa.yml | pull_request, push, workflow_dispatch | {"contents":"read"} | none found | 6138d9bb496d5b94257387d61dd2005cdade2d77 | 5b4726f862bcafa0bbc74b4cb895795e074455069199f84deb02813bb0edbf96 |

## Per-workflow execution surfaces

All files are detailed, including every PR/push/workflow_run workflow. Conditions below describe potential execution; this document does not decide whether a specific event satisfies them. Artifact/cache declarations include names, paths and keys; files fetched via custom scripts require additional semantic tracing.

### adaptive-cross-venue-funding-spread-v3-data-v1.yml

Triggers/filters: `{"push":{"branches":["research/adaptive-cross-venue-funding-spread-v3-data-v1"],"paths":["research/ADAPTIVE-CROSS-VENUE-FUNDING-SPREAD-V3-DATA-V1-FROZEN.md","scripts/audit-adaptive-cross-venue-funding-spread-v3-data-v1.py",".github/workflows/adaptive-cross-venue-funding-spread-v3-data-v1.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| coverage-audit | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"adaptive-cross-venue-funding-spread-v3-data-v1","path":"research/results/adaptive-cross-venue-funding-spread-v3-data-v1.json","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; Run frozen full-history public-data coverage audit; Upload untouched coverage evidence.

### adaptive-cross-venue-funding-spread-v3.yml

Triggers/filters: `{"push":{"branches":["research/adaptive-cross-venue-funding-spread-v3"],"paths":["research/ADAPTIVE-CROSS-VENUE-FUNDING-SPREAD-V3-FROZEN.md","research/adaptive-cross-venue-funding-spread-v3.js","research/run-adaptive-cross-venue-funding-spread-v3.mjs","scripts/collect-adaptive-cross-venue-binance-v3.py","test/adaptive-cross-venue-funding-spread-v3.test.js",".github/workflows/adaptive-cross-venue-funding-spread-v3.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| discovery | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"adaptive-cross-venue-funding-spread-v3","path":"research/results/adaptive-cross-venue-funding-spread-v3-summary.json\nresearch/results/adaptive-cross-venue-funding-spread-v3-full.json\nresearch/results/adaptive-cross-venue-funding-spread-v3.md\n","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-node@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; actions/setup-node@v4; Verify frozen Adaptive V3 invariants; Collect official Binance Vision V3 archives; Run first frozen Adaptive V3 discovery; Upload untouched Adaptive V3 evidence.

### adaptive-trend-sharpe-proxy-v1.yml

Triggers/filters: `{"push":{"branches":["research/adaptive-trend-sharpe-proxy-v1"],"paths":["research/ADAPTIVE-TREND-SHARPE-PROXY-V1-FROZEN.md","research/adaptive-trend-sharpe-proxy-v1.js","research/run-adaptive-trend-sharpe-proxy-v1.mjs","scripts/collect-adaptive-trend-sharpe-proxy-v1.py","test/adaptive-trend-sharpe-proxy-v1.test.js",".github/workflows/adaptive-trend-sharpe-proxy-v1.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| discovery | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"adaptive-trend-sharpe-proxy-v1","path":"research/results/adaptive-trend-sharpe-proxy-v1-summary.json\nresearch/results/adaptive-trend-sharpe-proxy-v1-full.json\nresearch/results/adaptive-trend-sharpe-proxy-v1.md\n","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-node@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; actions/setup-node@v4; Verify frozen engine syntax and invariants; Collect official Binance Vision 6h and funding archives; Run first frozen discovery; Upload untouched discovery evidence.

### agent-orchestration-safety.yml

Triggers/filters: `{"pull_request":{"paths":["docs/AGENT_ORCHESTRATION.md","MERIDIAN_AGENT_STATE.json","MERIDIAN_RESUME.json","MERIDIAN_LEAD_LEASE.json","MERIDIAN_AGENT_WORKFLOW.md","MERIDIAN_DECISIONS.md","scripts/validate-agent-orchestration.py","scripts/lead_lease_validation.py","test/test_lead_lease_validation.py",".github/workflows/agent-orchestration-safety.yml",".github/workflows/claude-mailbox-review.yml","test/test_claude_mailbox_bridge.py"]},"push":{"branches":["main"],"paths":["docs/AGENT_ORCHESTRATION.md","MERIDIAN_AGENT_STATE.json","MERIDIAN_RESUME.json","MERIDIAN_LEAD_LEASE.json","MERIDIAN_AGENT_WORKFLOW.md","MERIDIAN_DECISIONS.md","scripts/validate-agent-orchestration.py","scripts/lead_lease_validation.py","test/test_lead_lease_validation.py",".github/workflows/agent-orchestration-safety.yml",".github/workflows/claude-mailbox-review.yml","test/test_claude_mailbox_bridge.py"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| validate | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | none declared |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4`.

Step inventory: actions/checkout@v4; Test lead lease protocol states; Validate orchestration contract and durable state; Validate Claude mailbox bridge safety.

### asset-watch-mirror-watchdog.yml

Triggers/filters: `{"schedule":[{"cron":"1,6,11,16,21,26,31,36,41,46,51,56 * * * *"}],"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| dispatch | inherits workflow {"actions":"write","contents":"read"} | no job condition | none declared | none declared |

Executed code revision: inline workflow/action code; external or script-loaded code revision UNKNOWN. Actions: `none`.

Step inventory: Dispatch primary Asset Watch mirror.

Built-in token referenced explicitly through `github.token`.

### asset-watch-mirror.yml

Triggers/filters: `{"schedule":[{"cron":"3,8,13,18,23,28,33,38,43,48,53,58 * * * *"}],"workflow_dispatch":"","push":{"branches":["main"],"paths":[".github/workflows/asset-watch-mirror.yml","github-actions-oidc.js","asset-watch-mirror-crypto.js","asset-watch-bridge.js","server-gateway.js"]}}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| mirror | inherits workflow {"contents":"read","id-token":"write"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"meridian-asset-watch-${{ github.run_id }}","path":"asset-watch-mirror.json","retention-days":"2","if-no-files-found":"error"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/upload-artifact@v4`.

Step inventory: Checkout strict-live validator; Request GitHub OIDC token; Fetch and validate encrypted Asset Watch snapshot; Upload encrypted Asset Watch artifact.

### backend-safety.yml

Triggers/filters: `{"pull_request":"","push":{"branches":["main","codex/**"]}}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| syntax | inherits workflow {"contents":"read","pull-requests":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/setup-node@v4","inputs":{"node-version":"20","cache":"npm"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-node@v4`.

Step inventory: actions/checkout@v4; actions/setup-node@v4; Deterministic install; Release coordination guard [if: ${{ github.event_name == 'pull_request' }}]; Backend syntax; Frontend module syntax; Frozen research lineage; Research and auth regression tests; Release authority consistency; Meridian continuity audit; V10 UI regression gate; Public privacy regression; High-confidence secret scan; Assert paper-only invariant.

Built-in token referenced explicitly through `github.token`.

### claude-mailbox-review.yml

Triggers/filters: `{"issue_comment":{"types":["created"]}}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| review | inherits workflow {"contents":"read","issues":"write","pull-requests":"read","actions":"read","id-token":"write"} | github.event.issue.number == 571 && github.event.comment.user.login == 'Achi1984' && contains(github.event.comment.body, '@claude') && contains(github.event.comment.body, 'CROSS_MODEL_REQUEST') | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | none declared |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, anthropics/claude-code-action@v1`.

Step inventory: Checkout repository; Require Claude credential; Run Claude mailbox reviewer.

### claude-watchdog-15m.yml

Triggers/filters: `{"schedule":[{"cron":"57 * * * *"}],"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| watchdog | inherits workflow {"contents":"read","issues":"write","pull-requests":"read","actions":"read","id-token":"write"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/cache/restore@v4","inputs":{"path":".watchdog","key":"meridian-claude-watchdog-${{ steps.state.outputs.fingerprint }}","lookup-only":"true"}},{"action":"actions/cache/save@v4","inputs":{"path":".watchdog","key":"meridian-claude-watchdog-${{ steps.state.outputs.fingerprint }}"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-node@v4, actions/cache/restore@v4, anthropics/claude-code-action@v1, actions/cache/save@v4`.

Step inventory: actions/checkout@v4; actions/setup-node@v4; Compute cheap development fingerprint; Restore seen fingerprint; Decide whether Claude is needed; Require Claude credential [if: steps.decision.outputs.run_claude == 'true']; Claude development copilot [if: steps.decision.outputs.run_claude == 'true']; Save successful Claude fingerprint [if: steps.decision.outputs.run_claude == 'true' && success()].

Built-in token referenced explicitly through `github.token`.

### copilot-ci-event-pilot.yml

Triggers/filters: `{"workflow_run":{"workflows":["MERIDIAN Release Safety"],"types":["completed"],"branches":["feat/v11-version-history-20261010"]}}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| analyze | {"contents":"read","actions":"read","pull-requests":"read","copilot-requests":"write"} | github.repository == 'Achi1984/meridian' && github.event_name == 'workflow_run' && github.event.action == 'completed' && github.run_number <= 3 && github.run_attempt == 1 | none declared | none declared |

Executed code revision: inline workflow/action code; external or script-loaded code revision UNKNOWN. Actions: `none`.

Step inventory: Prepare and validate bounded event; Install exact CLI without token or checkout; Revalidate all evidence and deadline then observe once.

Built-in token referenced explicitly through `github.token`.

### copilot-coding-pilot.yml

Triggers/filters: `{"workflow_run":{"workflows":["MERIDIAN Release Safety"],"types":["completed"]}}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| claim | {"contents":"write","actions":"read","pull-requests":"read"} | github.repository == 'Achi1984/meridian' && github.event.workflow_run.head_sha == '2b267ecc0f94565fe005156bf45e8f0ae139eb9b' && github.event.workflow_run.conclusion == 'success' && (github.run_attempt == 1 \|\| github.run_attempt == 2) && github.triggering_actor == 'Achi1984' | none declared | none declared |

Executed code revision: helper scripts/copilot-coding-pilot.py fetched at GITHUB_SHA (workflow_run control/default-branch commit); source/packet revisions inside helper not traced here. Actions: `none`.

Step inventory: Load only trusted control helper; Validate live scope and atomically claim fixed packet.

Built-in token referenced explicitly through `github.token`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| generate | {"contents":"read","actions":"read","pull-requests":"read","copilot-requests":"write"} | no job condition | none declared | [{"action":"actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02","inputs":{"name":"version-history-ledger-packet","path":"${{ runner.temp }}/coding-pilot/packet.json","if-no-files-found":"error","retention-days":"1","overwrite":"false"}}] |

Executed code revision: helper scripts/copilot-coding-pilot.py fetched at GITHUB_SHA (workflow_run control/default-branch commit); source/packet revisions inside helper not traced here. Actions: `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02`.

Step inventory: Load trusted helper; Install and verify pinned CLI bytes without token; Verify actual tool surface locally, then generate ledger JSON; Recheck expiry before artifact transport; Upload only generated packet.

Built-in token referenced explicitly through `github.token`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| publish | {"contents":"write","actions":"read","pull-requests":"write"} | no job condition | none declared | none declared |

Executed code revision: helper scripts/copilot-coding-pilot.py fetched at GITHUB_SHA (workflow_run control/default-branch commit); source/packet revisions inside helper not traced here. Actions: `none`.

Step inventory: Load trusted helper, never artifact code; Validate artifact and create one Draft PR.

Built-in token referenced explicitly through `github.token`.

### copilot-readonly-pilot.yml

Triggers/filters: `{"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| pilot | {"contents":"read","actions":"read","copilot-requests":"write"} | github.repository == 'Achi1984/meridian' && github.event.repository.owner.type == 'User' && github.repository_owner == 'Achi1984' && github.actor == 'Achi1984' && github.triggering_actor == 'Achi1984' && github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && github.run_number == 1 && github.run_attempt == 1 | none declared | none declared |

Executed code revision: inline workflow/action code; external or script-loaded code revision UNKNOWN. Actions: `none`.

Step inventory: Gate first run and prepare bounded evidence; Install pinned official CLI without repository credentials; One bounded tool-free Copilot invocation.

Built-in token referenced explicitly through `github.token`.

### cross-sectional-funding-carry-risk-budget-v2.yml

Triggers/filters: `{"push":{"branches":["research/cross-sectional-funding-carry-risk-budget-v2"],"paths":["research/CROSS-SECTIONAL-FUNDING-CARRY-RISK-BUDGET-V2-FROZEN.md","research/cross_sectional_funding_carry_risk_budget_v2.py","research/run-cross-sectional-funding-carry-risk-budget-v2.py","scripts/collect-cross-sectional-funding-carry-risk-budget-v2.py","test/test_cross_sectional_funding_carry_risk_budget_v2.py",".github/workflows/cross-sectional-funding-carry-risk-budget-v2.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| validation | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"cross-sectional-funding-carry-risk-budget-v2","path":"research/results/cross-sectional-funding-carry-risk-budget-v2-summary.json\nresearch/results/cross-sectional-funding-carry-risk-budget-v2-full.json\nresearch/results/cross-sectional-funding-carry-risk-budget-v2.md\n","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; Verify frozen V2 invariants; Collect official Binance Vision archives; Run first frozen V2 validation; Upload untouched V2 evidence.

### cross-sectional-funding-carry-v1.yml

Triggers/filters: `{"push":{"branches":["research/cross-sectional-funding-carry-v1"],"paths":["research/CROSS-SECTIONAL-FUNDING-CARRY-V1-FROZEN.md","research/cross_sectional_funding_carry_v1.py","research/run-cross-sectional-funding-carry-v1.py","research/self_history_perp_factor_v3.py","scripts/collect-cross-sectional-funding-carry-v1.py","test/test_cross_sectional_funding_carry_v1.py","test/test_self_history_perp_factor_v3.py",".github/workflows/cross-sectional-funding-carry-v1.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| transfer-validation | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"cross-sectional-funding-carry-v1","path":"research/results/cross-sectional-funding-carry-v1-summary.json\nresearch/results/cross-sectional-funding-carry-v1-full.json\nresearch/results/cross-sectional-funding-carry-v1.md\n","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; Verify inherited execution and frozen Funding Carry V1 invariants; Collect official transfer-universe archives; Run first independent Funding Carry transfer validation; Upload untouched transfer evidence.

### cross-sectional-low-volatility-v1.yml

Triggers/filters: `{"pull_request":{"paths":["research/CROSS-SECTIONAL-LOW-VOLATILITY-V1-PREREGISTRATION.md","research/cross_sectional_low_volatility_v1.py","scripts/collect-cross-sectional-low-volatility-v1-discovery.py","research/run-cross-sectional-low-volatility-v1-discovery.py","test/test_cross_sectional_low_volatility_v1.py","scripts/frozen-research-guard.mjs",".github/workflows/cross-sectional-low-volatility-v1.yml"]},"push":{"branches":["research/cross-sectional-low-volatility-v1-discovery-run"],"paths":["research/CROSS-SECTIONAL-LOW-VOLATILITY-V1-DISCOVERY-RUN-AUTHORIZATION.md"]}}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| invariants | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | none declared |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-python@v5`.

Step inventory: actions/checkout@v4; actions/setup-python@v5; Verify frozen research lineage; Compile frozen low-volatility validation implementation; Run frozen low-volatility V1 invariants only.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| source | inherits workflow {"contents":"read"} | github.event_name != 'pull_request' | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"cross-sectional-low-volatility-v1-discovery-source","path":"/tmp/meridian-lowvol-v1-discovery","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-python@v5, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; actions/setup-python@v5; Collect first authorized public discovery source; Upload exact discovery source package.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| evaluate | inherits workflow {"contents":"read"} | github.event_name != 'pull_request' | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/download-artifact@v4","inputs":{"name":"cross-sectional-low-volatility-v1-discovery-source","path":"/tmp/meridian-lowvol-v1-discovery"}},{"action":"actions/upload-artifact@v4","inputs":{"name":"cross-sectional-low-volatility-v1-discovery-result","path":"research/results/cross-sectional-low-volatility-v1-discovery-result.json\nresearch/results/cross-sectional-low-volatility-v1-discovery-result.md\n","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-python@v5, actions/download-artifact@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; actions/setup-python@v5; actions/download-artifact@v4; Run first frozen discovery gate; Upload untouched discovery result [if: always()].

### cross-sectional-perpetual-factor-v1.yml

Triggers/filters: `{"push":{"branches":["research/cross-sectional-perpetual-factor-v1"],"paths":["research/CROSS-SECTIONAL-PERPETUAL-FACTOR-V1-FROZEN.md","research/cross_sectional_perpetual_factor_v1.py","research/run-cross-sectional-perpetual-factor-v1.py","research/self_history_perp_factor_v3.py","scripts/collect-cross-sectional-perpetual-factor-v1.py","test/test_cross_sectional_perpetual_factor_v1.py","test/test_self_history_perp_factor_v3.py",".github/workflows/cross-sectional-perpetual-factor-v1.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| temporal-validation | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"cross-sectional-perpetual-factor-v1","path":"research/results/cross-sectional-perpetual-factor-v1-summary.json\nresearch/results/cross-sectional-perpetual-factor-v1-full.json\nresearch/results/cross-sectional-perpetual-factor-v1.md\n","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; Verify inherited execution and frozen V1 gates; Collect official unseen Binance Vision archives; Run first independent temporal validation; Upload untouched temporal-validation evidence.

### cross-sectional-reversal-v1.yml

Triggers/filters: `{"pull_request":{"paths":["research/cross-sectional-reversal-v1.js","test/cross-sectional-reversal-v1.test.js",".github/workflows/cross-sectional-reversal-v1.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| synthetic-invariants | inherits workflow DEFAULT UNKNOWN | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | none declared |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-node@v4`.

Step inventory: actions/checkout@v4; actions/setup-node@v4; Syntax; Synthetic invariants only.

### cross-venue-funding-edge-v1-source.yml

Triggers/filters: `{"pull_request":{"paths":["research/CROSS-VENUE-FUNDING-EDGE-V1-PREREGISTRATION.md","research/CROSS-VENUE-FUNDING-EDGE-V1-IMPLEMENTATION.md","research/CROSS-VENUE-FUNDING-EDGE-V1-SOURCE-DECISION.md","research/CROSS-VENUE-FUNDING-EDGE-V2-PREREGISTRATION.md","research/cross-venue-funding-edge-v2-stage-lock.js","test/cross-venue-funding-edge-v2-stage-lock.test.js","test/cross-venue-funding-edge-v2-preregistration.test.js","research/cross-venue-funding-edge-v1.js","research/cross-venue-funding-edge-v1-data-contract.js","research/cross-venue-funding-edge-v1-stage-lock.js","scripts/collect-cross-venue-funding-edge-v1-source.mjs","test/cross-venue-funding-edge-v1.test.js","test/cross-venue-funding-edge-v1-data-contract.test.js","test/cross-venue-funding-edge-v1-stage-lock.test.js",".github/workflows/cross-venue-funding-edge-v1-source.yml"]},"push":{"branches":["main"],"paths":["research/CROSS-VENUE-FUNDING-EDGE-V1-IMPLEMENTATION.md","research/CROSS-VENUE-FUNDING-EDGE-V1-SOURCE-DECISION.md","research/CROSS-VENUE-FUNDING-EDGE-V2-PREREGISTRATION.md","research/cross-venue-funding-edge-v2-stage-lock.js","test/cross-venue-funding-edge-v2-stage-lock.test.js","research/cross-venue-funding-edge-v1.js","research/cross-venue-funding-edge-v1-data-contract.js","research/cross-venue-funding-edge-v1-stage-lock.js","scripts/collect-cross-venue-funding-edge-v1-source.mjs","test/cross-venue-funding-edge-v1.test.js","test/cross-venue-funding-edge-v1-data-contract.test.js","test/cross-venue-funding-edge-v1-stage-lock.test.js",".github/workflows/cross-venue-funding-edge-v1-source.yml"]}}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| invariants | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | none declared |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-node@v4`.

Step inventory: actions/checkout@v4; actions/setup-node@v4; Verify source-only syntax; Verify frozen pre-result invariants; Read V1 source-audit lock; Assert collector cannot calculate strategy PnL.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| source | inherits workflow {"contents":"read"} | github.event_name == 'push' && github.ref == 'refs/heads/main' && needs.invariants.outputs.source_audit == 'true' | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"cross-venue-funding-edge-v1-source","path":"research/data/cross-venue-funding-edge-v1-source.json","if-no-files-found":"error","retention-days":"90"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-node@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; actions/setup-node@v4; Collect and validate frozen public source; Upload immutable source evidence.

### cross-venue-funding-edge-v2-source.yml

Triggers/filters: `{"pull_request":{"paths":["research/CROSS-VENUE-FUNDING-EDGE-V2-IMPLEMENTATION.md","research/CROSS-VENUE-FUNDING-EDGE-V2-COVERAGE-EVIDENCE.json","research/cross-venue-funding-edge-v2.js","research/cross-venue-funding-edge-v2-data-contract.js","research/cross-venue-funding-edge-v2-source-gate.js","research/cross-venue-funding-edge-v2-stage-lock.js","scripts/collect-cross-venue-funding-edge-v2-source.mjs","test/cross-venue-funding-edge-v2.test.js","test/cross-venue-funding-edge-v2-data-contract.test.js","test/cross-venue-funding-edge-v2-source-gate.test.js","test/cross-venue-funding-edge-v2-collector.test.js","test/cross-venue-funding-edge-v2-stage-lock.test.js",".github/workflows/cross-venue-funding-edge-v2-source.yml"]},"push":{"branches":["main"],"paths":["research/CROSS-VENUE-FUNDING-EDGE-V2-IMPLEMENTATION.md","research/CROSS-VENUE-FUNDING-EDGE-V2-COVERAGE-EVIDENCE.json","research/cross-venue-funding-edge-v2.js","research/cross-venue-funding-edge-v2-data-contract.js","research/cross-venue-funding-edge-v2-source-gate.js","research/cross-venue-funding-edge-v2-stage-lock.js","scripts/collect-cross-venue-funding-edge-v2-source.mjs","test/cross-venue-funding-edge-v2.test.js","test/cross-venue-funding-edge-v2-data-contract.test.js","test/cross-venue-funding-edge-v2-source-gate.test.js","test/cross-venue-funding-edge-v2-collector.test.js","test/cross-venue-funding-edge-v2-stage-lock.test.js",".github/workflows/cross-venue-funding-edge-v2-source.yml"]}}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| invariants | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | none declared |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-node@v4`.

Step inventory: actions/checkout@v4; actions/setup-node@v4; Verify V2 source-only syntax; Verify V2 pre-source behavior; Assert V2 does not reuse coercive V1 primitives; Assert collector is source-only; Frozen research lineage; Read V2 source-audit lock; Compute V2 source gate; Report source gate state.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| source | inherits workflow {"contents":"read"} | github.event_name == 'push' && github.ref == 'refs/heads/main' && needs.invariants.outputs.source_gate == 'COLLECT_CANONICAL_SOURCE' | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"cross-venue-funding-edge-v2-source","path":"research/data/cross-venue-funding-edge-v2-source.json","if-no-files-found":"error","retention-days":"90"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-node@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; actions/setup-node@v4; Collect and validate frozen V2 public source; Upload immutable V2 source evidence.

### cross-venue-funding-spread-v1-transfer-holdout.yml

Triggers/filters: `{"push":{"branches":["research/cross-venue-funding-spread-v1"],"paths":["research/CROSS-VENUE-FUNDING-SPREAD-V1-TRANSFER-HOLDOUT.md","research/cross-venue-funding-spread-v1.js","research/run-cross-venue-funding-spread-v1-transfer-holdout.mjs","scripts/collect-cross-venue-binance-transfer.py","test/cross-venue-funding-spread-v1-transfer-holdout.test.js",".github/workflows/cross-venue-funding-spread-v1-transfer-holdout.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| holdout | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"cross-venue-funding-spread-v1-transfer-holdout","path":"research/results/cross-venue-funding-spread-v1-transfer-holdout-summary.json\nresearch/results/cross-venue-funding-spread-v1-transfer-holdout-full.json\nresearch/results/cross-venue-funding-spread-v1-transfer-holdout.md\n","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-node@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; actions/setup-node@v4; Verify discovery and holdout invariants; Collect fixed transfer-asset Binance Vision archives; Run first frozen transfer holdout; Upload untouched holdout evidence.

### cross-venue-funding-spread-v1.yml

Triggers/filters: `{"push":{"branches":["research/cross-venue-funding-spread-v1"],"paths":["research/CROSS-VENUE-FUNDING-SPREAD-V1-FROZEN.md","research/cross-venue-funding-spread-v1.js","research/run-cross-venue-funding-spread-v1.mjs","scripts/collect-cross-venue-binance.py","test/cross-venue-funding-spread-v1.test.js",".github/workflows/cross-venue-funding-spread-v1.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| discovery | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"cross-venue-funding-spread-v1","path":"research/results/cross-venue-funding-spread-v1-summary.json\nresearch/results/cross-venue-funding-spread-v1-full.json\nresearch/results/cross-venue-funding-spread-v1.md\n","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-node@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; actions/setup-node@v4; Verify frozen invariants; Collect official Binance Vision archives; Run first frozen discovery; Upload untouched discovery evidence.

### cross-venue-funding-spread-v2-data-v1.yml

Triggers/filters: `{"push":{"branches":["research/cross-venue-funding-spread-v2-data-v1"],"paths":["research/CROSS-VENUE-FUNDING-SPREAD-V2-DATA-V1-FROZEN.md","scripts/audit-cross-venue-funding-spread-v2-data-v1.py",".github/workflows/cross-venue-funding-spread-v2-data-v1.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| coverage-audit | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"cross-venue-funding-spread-v2-data-v1","path":"research/results/cross-venue-funding-spread-v2-data-v1.json","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; Run frozen public-data coverage audit; Upload untouched coverage evidence.

### cross-venue-funding-spread-v2.yml

Triggers/filters: `{"push":{"branches":["research/cross-venue-funding-spread-v2"],"paths":["research/CROSS-VENUE-FUNDING-SPREAD-V2-FROZEN.md","research/cross-venue-funding-spread-v2.js","research/run-cross-venue-funding-spread-v2.mjs","scripts/collect-cross-venue-binance-v2.py","test/cross-venue-funding-spread-v2.test.js",".github/workflows/cross-venue-funding-spread-v2.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| validation | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"cross-venue-funding-spread-v2","path":"research/results/cross-venue-funding-spread-v2-summary.json\nresearch/results/cross-venue-funding-spread-v2-full.json\nresearch/results/cross-venue-funding-spread-v2.md\n","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-node@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; actions/setup-node@v4; Verify frozen V2 invariants; Collect official Binance Vision archives; Run first independent Cross-Venue V2 validation; Upload untouched V2 evidence.

### dynamic-grid-proxy-v1.yml

Triggers/filters: `{"push":{"branches":["research/dynamic-grid-proxy-v1"],"paths":["research/DYNAMIC-GRID-PROXY-V1-FROZEN.md","research/dynamic-grid-proxy-v1.js","research/run-dynamic-grid-proxy-v1.mjs","research/grid-path-simulator-v1.js","scripts/collect-dynamic-grid-minute.py","test/dynamic-grid-proxy-v1.test.js","test/grid-path-simulator-v1.test.js",".github/workflows/dynamic-grid-proxy-v1.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| discovery | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"dynamic-grid-proxy-v1","path":"research/results/dynamic-grid-proxy-v1-summary.json\nresearch/results/dynamic-grid-proxy-v1-full.json\nresearch/results/dynamic-grid-proxy-v1.md\n","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-node@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; actions/setup-node@v4; Verify Grid foundation and frozen strategy invariants; Collect official Binance Vision minute archives; Run first frozen Dynamic Grid discovery; Upload untouched discovery evidence.

### eth-funding-holdout.yml

Triggers/filters: `{"pull_request":{"paths":["funding-carry-eth-holdout.js","scripts/eth-funding-carry-holdout.mjs","scripts/collect-eth-funding-holdout.py","test/eth-funding-carry-holdout-v1.test.js",".github/workflows/eth-funding-holdout.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| holdout | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"eth-funding-carry-holdout-v1","path":"research/eth-funding-carry-holdout-v1.json\nresearch/eth-funding-carry-holdout-v1.md\n","if-no-files-found":"error"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-node@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; actions/setup-node@v4; Syntax; Unit tests; Run frozen ETH holdout; Upload evidence.

### funding-carry-risk-budget-v2-data-v1.yml

Triggers/filters: `{"push":{"branches":["research/funding-carry-risk-budget-v2-data-v1"],"paths":["research/FUNDING-CARRY-RISK-BUDGET-V2-DATA-V1-FROZEN.md","scripts/audit-funding-carry-risk-budget-v2-data-v1.py",".github/workflows/funding-carry-risk-budget-v2-data-v1.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| coverage | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"funding-carry-risk-budget-v2-data-v1","path":"research/results/funding-carry-risk-budget-v2-data-v1-coverage.json","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; Verify audit syntax; Run first frozen public-data coverage audit; Upload untouched coverage evidence.

### high-volatility-perpetual-cross-sectional-reversal-v2.yml

Triggers/filters: `{"push":{"branches":["research/perpetual-cross-sectional-reversal-v2-high-vol"],"paths":["research/high_volatility_perpetual_cross_sectional_reversal_v2.py","research/run-high-volatility-perpetual-cross-sectional-reversal-v2.py","scripts/collect-high-volatility-perpetual-cross-sectional-reversal-v2.py","test/test_high_volatility_perpetual_cross_sectional_reversal_v2.py","research/perpetual_cross_sectional_reversal_v1.py"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| validation | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"high-volatility-perpetual-cross-sectional-reversal-v2","path":"research/results/high-volatility-perpetual-cross-sectional-reversal-v2-summary.json\nresearch/results/high-volatility-perpetual-cross-sectional-reversal-v2-full.json\nresearch/results/high-volatility-perpetual-cross-sectional-reversal-v2.md\n","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; Verify V1 foundation invariants and frozen V2 invariants; Collect frozen V2 replay data; Replay frozen V2 validation; Upload V2 replay evidence.

### low-volatility-rank-weighted-v2-holdout.yml

Triggers/filters: `{"pull_request":{"paths":["research/LOW-VOLATILITY-RANK-WEIGHTED-V2-HOLDOUT-IMPLEMENTATION.md","research/low_volatility_rank_weighted_v2_holdout.py","scripts/collect-low-volatility-rank-weighted-v2-holdout.py","research/run-low-volatility-rank-weighted-v2-holdout.py","test/test_low_volatility_rank_weighted_v2_holdout.py","scripts/frozen-research-guard.mjs",".github/workflows/low-volatility-rank-weighted-v2-holdout.yml"]},"push":{"branches":["research/low-volatility-rank-weighted-v2-holdout-run"],"paths":["research/LOW-VOLATILITY-RANK-WEIGHTED-V2-HOLDOUT-RUN-AUTHORIZATION.md"]}}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| invariants | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | none declared |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-python@v5`.

Step inventory: actions/checkout@v4; actions/setup-python@v5; Verify frozen research lineage; Compile isolated Holdout implementation; Run Holdout synthetic and lineage invariants only.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| source | inherits workflow {"contents":"read"} | github.event_name != 'pull_request' | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"lowvol-rank-v2-holdout-source","path":"/tmp/meridian-lowvol-rank-v2-holdout","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-python@v5, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; actions/setup-python@v5; Collect first authorized untouched Holdout source; Upload exact untouched Holdout source package.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| evaluate | inherits workflow {"contents":"read"} | github.event_name != 'pull_request' | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/download-artifact@v4","inputs":{"name":"lowvol-rank-v2-holdout-source","path":"/tmp/meridian-lowvol-rank-v2-holdout"}},{"action":"actions/upload-artifact@v4","inputs":{"name":"lowvol-rank-v2-holdout-result","path":"research/results/low-volatility-rank-weighted-v2-holdout-result.json\nresearch/results/low-volatility-rank-weighted-v2-holdout-result.md\n","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-python@v5, actions/download-artifact@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; actions/setup-python@v5; actions/download-artifact@v4; Run first untouched Holdout gate; Upload untouched Holdout result [if: always()].

### low-volatility-rank-weighted-v2-prospective.yml

Triggers/filters: `{"pull_request":{"paths":["research/LOW-VOLATILITY-RANK-WEIGHTED-V2-PROSPECTIVE-REVIEW-PREREGISTRATION.md","research/LOW-VOLATILITY-RANK-WEIGHTED-V2-PROSPECTIVE-SHADOW-IMPLEMENTATION.md","research/low_volatility_rank_weighted_v2_prospective.py","scripts/collect-low-volatility-rank-weighted-v2-prospective.py","research/run-low-volatility-rank-weighted-v2-prospective.py","test/test_low_volatility_rank_weighted_v2_prospective.py","scripts/frozen-research-guard.mjs",".github/workflows/low-volatility-rank-weighted-v2-prospective.yml"]},"push":{"branches":["research/low-volatility-rank-weighted-v2-prospective-start"],"paths":["research/LOW-VOLATILITY-RANK-WEIGHTED-V2-PROSPECTIVE-START-AUTHORIZATION.md"]},"workflow_dispatch":"","schedule":[{"cron":"15 2 * * 0"},{"cron":"15 8 * * 0"},{"cron":"15 11 * * 0"}]}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| invariants | inherits workflow {"contents":"write"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | none declared |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-python@v5`.

Step inventory: actions/checkout@v4; actions/setup-python@v5; Verify frozen research lineage; Compile prospective shadow implementation; Run prospective synthetic and lineage invariants.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| snapshot | inherits workflow {"contents":"write"} | github.event_name != 'pull_request' | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"lowvol-v2-prospective-source-${{ github.run_id }}","path":"/tmp/meridian-lowvol-v2-prospective","if-no-files-found":"error","retention-days":"90"}},{"action":"actions/upload-artifact@v4","inputs":{"name":"lowvol-v2-prospective-snapshot-${{ github.run_id }}","path":"/tmp/meridian-lowvol-v2-prospective-output","if-no-files-found":"error","retention-days":"90"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-python@v5, actions/upload-artifact@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; actions/setup-python@v5; Collect public prospective source; Build immutable prospective snapshot; Upload exact prospective source; Upload prospective snapshot; Persist first canonical snapshot for cutoff.

### low-volatility-rank-weighted-v2.yml

Triggers/filters: `{"pull_request":{"paths":["research/LOW-VOLATILITY-RANK-WEIGHTED-V2-PREREGISTRATION.md","research/LOW-VOLATILITY-RANK-WEIGHTED-V2-IMPLEMENTATION.md","research/low_volatility_rank_weighted_v2.py","scripts/collect-low-volatility-rank-weighted-v2-development.py","research/run-low-volatility-rank-weighted-v2-development.py","test/test_low_volatility_rank_weighted_v2.py","scripts/frozen-research-guard.mjs",".github/workflows/low-volatility-rank-weighted-v2.yml"]},"push":{"branches":["research/low-volatility-rank-weighted-v2-development-run"],"paths":["research/LOW-VOLATILITY-RANK-WEIGHTED-V2-DEVELOPMENT-RUN-AUTHORIZATION.md"]}}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| invariants | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | none declared |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-python@v5`.

Step inventory: actions/checkout@v4; actions/setup-python@v5; Verify frozen research lineage; Compile frozen V2 implementation; Run V2 synthetic and structural invariants only.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| source | inherits workflow {"contents":"read"} | github.event_name != 'pull_request' | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"lowvol-rank-v2-development-source","path":"/tmp/meridian-lowvol-rank-v2-development","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-python@v5, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; actions/setup-python@v5; Collect first authorized V2 Development source; Upload exact V2 Development source package.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| evaluate | inherits workflow {"contents":"read"} | github.event_name != 'pull_request' | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/download-artifact@v4","inputs":{"name":"lowvol-rank-v2-development-source","path":"/tmp/meridian-lowvol-rank-v2-development"}},{"action":"actions/upload-artifact@v4","inputs":{"name":"lowvol-rank-v2-development-result","path":"research/results/low-volatility-rank-weighted-v2-development-result.json\nresearch/results/low-volatility-rank-weighted-v2-development-result.md\n","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-python@v5, actions/download-artifact@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; actions/setup-python@v5; actions/download-artifact@v4; Run first frozen V2 Development gate; Upload untouched V2 Development result [if: always()].

### meridian-snapshot.yml

Triggers/filters: `{"workflow_dispatch":"","schedule":[{"cron":"*/5 * * * *"}]}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| snapshot | inherits workflow {"contents":"write"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | none declared |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4`.

Step inventory: Checkout main; Fetch public MERIDIAN snapshot; Publish to telemetry branch.

### paper-edge-v1-discovery.yml

Triggers/filters: `{"pull_request":{"paths":["research/PAPER-EDGE-V1-PREREGISTRATION.md","research/PAPER-EDGE-V1-IMPLEMENTATION.md","research/PAPER-EDGE-V1-DISCOVERY-ACCOUNTING.md","research/PAPER-EDGE-V1-DISCOVERY-RUN-CONTRACT.md","research/PAPER-EDGE-V1-DISCOVERY-DECISION.md","research/paper-edge-v1-discovery-decision.json","research/paper-edge-v1-data-contract.js","research/paper-edge-v1-foundation.js","research/paper-edge-v1-state-machine.js","research/paper-edge-v1-discovery-engine.js","research/paper-edge-v1-discovery-runner.js","research/edge-v1-stage-lock.js","scripts/run-paper-edge-v1-discovery.mjs","test/paper-edge-v1-data-contract.test.js","test/paper-edge-v1-discovery-engine.test.js","test/paper-edge-v1-state-machine.test.js","test/edge-v1-stage-lock.test.js","test/paper-edge-v1-discovery-runner.test.js",".github/workflows/paper-edge-v1-discovery.yml"]}}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| invariants | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | none declared |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-node@v4`.

Step inventory: actions/checkout@v4; actions/setup-node@v4; Verify closed Discovery syntax; Verify frozen closed-state invariants.

### paper-edge-v1-source.yml

Triggers/filters: `{"workflow_dispatch":"","push":{"branches":["main"],"paths":["scripts/collect-paper-edge-v1-source.mjs","research/paper-edge-v1-data-contract.js",".github/workflows/paper-edge-v1-source.yml"]}}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| source | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"paper-edge-v1-source","path":"research/data/paper-edge-v1-source.json","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-node@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; actions/setup-node@v4; Collect validated frozen source; Upload source evidence.

### paper-profit-observer-stage-a.yml

Triggers/filters: `{"pull_request":{"paths":["scripts/capture-paper-bot-observer-r90.mjs",".github/workflows/paper-profit-observer-stage-a.yml","test/paper-profit-control-v2.test.js"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| snapshot | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"paper-profit-observer-stage-a","path":"research/results/paper-runtime-observer-r90.json","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-node@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; actions/setup-node@v4; Capture public read-only Paper observer; Upload observer snapshot.

### paper-profit-regime-trend-breakout-v1-holdout.yml

Triggers/filters: `{"pull_request":{"paths":["research/PAPERBOT-PROFIT-REGIME-TREND-BREAKOUT-V1-HOLDOUT-IMPLEMENTATION.md","research/paper-profit-regime-trend-breakout-v1-holdout.js","research/run-paper-profit-regime-trend-breakout-v1-holdout.mjs","test/paper-profit-regime-trend-breakout-v1-holdout.test.js",".github/workflows/paper-profit-regime-trend-breakout-v1-holdout.yml"]},"push":{"branches":["research/regime-trend-breakout-v1-holdout-run"],"paths":["research/PAPERBOT-PROFIT-REGIME-TREND-BREAKOUT-V1-HOLDOUT-RUN-AUTHORIZATION.md"]}}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| invariants | inherits workflow {"contents":"read","actions":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | none declared |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-node@v4`.

Step inventory: actions/checkout@v4; actions/setup-node@v4; Verify frozen research lineage; Compile Holdout implementation; Run Holdout synthetic invariants only.

Built-in token referenced explicitly through `github.token`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| source | inherits workflow {"contents":"read","actions":"read"} | github.event_name != 'pull_request' | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"regime-trend-breakout-v1-holdout-source","path":"research/results/regime-trend-breakout-v1-source.json","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; Download exact frozen Discovery source artifact; Upload exact Holdout source handoff.

Built-in token referenced explicitly through `github.token`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| evaluate | inherits workflow {"contents":"read","actions":"read"} | github.event_name != 'pull_request' | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/download-artifact@v4","inputs":{"name":"regime-trend-breakout-v1-holdout-source","path":"research/results"}},{"action":"actions/upload-artifact@v4","inputs":{"name":"regime-trend-breakout-v1-holdout-result","path":"research/results/regime-trend-breakout-v1-holdout-result.json\nresearch/results/regime-trend-breakout-v1-holdout-result.md\n","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-node@v4, actions/download-artifact@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; actions/setup-node@v4; actions/download-artifact@v4; Run frozen Holdout gate; Upload untouched Holdout result [if: always()].

Built-in token referenced explicitly through `github.token`.

### paper-profit-regime-trend-breakout-v1.yml

Triggers/filters: `{"pull_request":{"paths":["research/PAPERBOT-PROFIT-REGIME-TREND-BREAKOUT-V1-PREREGISTRATION.md","research/paper-profit-regime-trend-breakout-v1-preregistration.js","research/PAPERBOT-PROFIT-REGIME-TREND-BREAKOUT-V1-IMPLEMENTATION.md","research/paper-profit-regime-trend-breakout-v1-evaluator.js","scripts/collect-paper-profit-regime-trend-breakout-v1.mjs","research/run-paper-profit-regime-trend-breakout-v1.mjs","test/paper-profit-regime-trend-breakout-v1.test.js",".github/workflows/paper-profit-regime-trend-breakout-v1.yml"]},"push":{"branches":["research/regime-trend-breakout-v1-run"],"paths":["research/PAPERBOT-PROFIT-REGIME-TREND-BREAKOUT-V1-RUN-AUTHORIZATION.md"]}}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| invariants | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | none declared |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-node@v4`.

Step inventory: actions/checkout@v4; actions/setup-node@v4; Verify frozen research lineage; Compile deterministic implementation; Run synthetic invariants only.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| source | inherits workflow {"contents":"read"} | github.event_name != 'pull_request' | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"regime-trend-breakout-v1-source","path":"research/results/regime-trend-breakout-v1-source.json","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-node@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; actions/setup-node@v4; Collect exact frozen public source package; Upload exact source package.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| evaluate | inherits workflow {"contents":"read"} | github.event_name != 'pull_request' | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/download-artifact@v4","inputs":{"name":"regime-trend-breakout-v1-source","path":"research/results"}},{"action":"actions/upload-artifact@v4","inputs":{"name":"regime-trend-breakout-v1-result","path":"research/results/regime-trend-breakout-v1-result.json\nresearch/results/regime-trend-breakout-v1-result.md\n","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-node@v4, actions/download-artifact@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; actions/setup-node@v4; actions/download-artifact@v4; Run frozen Discovery gate; Upload untouched result [if: always()].

### paper-profit-tsmom-v2.yml

Triggers/filters: `{"pull_request":{"paths":["research/paper-profit-tsmom-v2-evaluator.js","research/run-paper-profit-tsmom-v2.mjs",".github/workflows/paper-profit-tsmom-v2.yml","test/paper-profit-tsmom-v2-evaluator.test.js"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| evaluate | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"paper-profit-tsmom-v2","path":"research/results/paper-profit-tsmom-v2-result.json\nresearch/results/paper-profit-tsmom-v2-result.md\n","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-node@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; actions/setup-node@v4; Run frozen TSMOM V2 evaluation; Upload untouched TSMOM V2 evidence.

### perpetual-cross-sectional-reversal-v1-data-v1.yml

Triggers/filters: `{"push":{"branches":["research/perpetual-cross-sectional-reversal-v1-data-v1"],"paths":["research/PERPETUAL-CROSS-SECTIONAL-REVERSAL-V1-DATA-V1-FROZEN.md","scripts/audit-perpetual-cross-sectional-reversal-v1-data-v1.py",".github/workflows/perpetual-cross-sectional-reversal-v1-data-v1.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| foundation | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"perpetual-cross-sectional-reversal-v1-data-v1","path":"research/results/perpetual-cross-sectional-reversal-v1-data-v1.json","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; Syntax check frozen data audit; Run frozen public-data foundation audit; Upload untouched foundation evidence.

### perpetual-cross-sectional-reversal-v1.yml

Triggers/filters: `{"push":{"branches":["research/perpetual-cross-sectional-reversal-v1"],"paths":["research/PERPETUAL-CROSS-SECTIONAL-REVERSAL-V1-FROZEN.md","research/perpetual_cross_sectional_reversal_v1.py","research/run-perpetual-cross-sectional-reversal-v1.py","scripts/collect-perpetual-cross-sectional-reversal-v1.py","test/test_perpetual_cross_sectional_reversal_v1.py",".github/workflows/perpetual-cross-sectional-reversal-v1.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| discovery | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"perpetual-cross-sectional-reversal-v1","path":"research/results/perpetual-cross-sectional-reversal-v1-summary.json\nresearch/results/perpetual-cross-sectional-reversal-v1-full.json\nresearch/results/perpetual-cross-sectional-reversal-v1.md\n","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; Verify frozen Reversal V1 invariants; Collect discovery-only official Binance Vision data; Run first frozen Reversal V1 discovery; Upload untouched discovery evidence.

### perpetual-factor-data-v1.yml

Triggers/filters: `{"push":{"branches":["research/perpetual-factor-data-v1"],"paths":["research/PERPETUAL-FACTOR-DATA-V1-FROZEN.md","scripts/audit-perpetual-factor-data-v1.py",".github/workflows/perpetual-factor-data-v1.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| coverage | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"perpetual-factor-data-v1","path":"research/results/perpetual-factor-data-v1-coverage.json","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; Syntax check coverage auditor; Audit frozen official archive coverage; Upload untouched coverage evidence.

### perpetual-factor-row-continuity-v1.yml

Triggers/filters: `{"push":{"branches":["research/perpetual-factor-row-continuity-v1"],"paths":["research/PERPETUAL-FACTOR-ROW-CONTINUITY-V1-FROZEN.md","scripts/audit-perpetual-factor-row-continuity-v1.py",".github/workflows/perpetual-factor-row-continuity-v1.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| audit | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"perpetual-factor-row-continuity-v1","path":"research/results/perpetual-factor-row-continuity-v1.json\nresearch/results/perpetual-factor-row-continuity-v1.md\n","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; Syntax check; Run frozen row-continuity audit; Upload untouched audit evidence.

### perpetual-relative-value-reversal-v3-data-v1.yml

Triggers/filters: `{"push":{"branches":["research/perpetual-relative-value-reversal-v3-data-v1"],"paths":["research/PERPETUAL-RELATIVE-VALUE-REVERSAL-V3-DATA-V1-FROZEN.md","scripts/audit-perpetual-relative-value-reversal-v3-data-v1.py",".github/workflows/perpetual-relative-value-reversal-v3-data-v1.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| data-foundation | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"perpetual-relative-value-reversal-v3-data-v1","path":"research/results/perpetual-relative-value-reversal-v3-data-v1.json","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; Run frozen public-data foundation audit; Upload untouched foundation evidence.

### perpetual-relative-value-reversal-v3-data-v2-broad-market.yml

Triggers/filters: `{"push":{"branches":["research/perpetual-relative-value-reversal-v3-data-v2-broad-market"],"paths":["research/PERPETUAL-RELATIVE-VALUE-REVERSAL-V3-DATA-V2-BROAD-MARKET-FROZEN.md","scripts/audit-perpetual-relative-value-reversal-v3-data-v2-broad-market.py",".github/workflows/perpetual-relative-value-reversal-v3-data-v2-broad-market.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| benchmark-foundation | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"perpetual-relative-value-reversal-v3-data-v2-broad-market","path":"research/results/perpetual-relative-value-reversal-v3-data-v2-broad-market.json","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; Verify audit syntax; Run frozen broad-market benchmark coverage audit; Assert strategy-neutral invariants; Upload untouched benchmark evidence.

### perpetual-relative-value-reversal-v3-primary.yml

Triggers/filters: `{"push":{"branches":["research/perpetual-relative-value-reversal-v3-primary-validation"],"paths":["research/PERPETUAL-RELATIVE-VALUE-REVERSAL-V3-FROZEN.md","research/perpetual-relative-value-reversal-v3-protocol.json","research/perpetual_relative_value_reversal_v3.py","research/run-perpetual-relative-value-reversal-v3-primary.py","scripts/collect-perpetual-relative-value-reversal-v3-primary.py","test/test_perpetual_relative_value_reversal_v3.py",".github/workflows/perpetual-relative-value-reversal-v3-primary.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| primary | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"perpetual-relative-value-reversal-v3-primary","path":"research/results/perpetual-relative-value-reversal-v3-primary-summary.json\nresearch/results/perpetual-relative-value-reversal-v3-primary-full.json\nresearch/results/perpetual-relative-value-reversal-v3-primary.md\n","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; Verify frozen V3 invariants; Collect PRIMARY_VALIDATION data only; Run frozen V3 PRIMARY_VALIDATION; Upload untouched V3 primary evidence.

### perpetual-relative-value-reversal-v3-protocol.yml

Triggers/filters: `{"push":{"branches":["research/perpetual-relative-value-reversal-v3-protocol"],"paths":["research/PERPETUAL-RELATIVE-VALUE-REVERSAL-V3-FROZEN.md","research/perpetual-relative-value-reversal-v3-protocol.json","research/perpetual_relative_value_reversal_v3.py","test/test_perpetual_relative_value_reversal_v3.py",".github/workflows/perpetual-relative-value-reversal-v3-protocol.yml"]},"pull_request":{"paths":["research/PERPETUAL-RELATIVE-VALUE-REVERSAL-V3-FROZEN.md","research/perpetual-relative-value-reversal-v3-protocol.json","research/perpetual_relative_value_reversal_v3.py","test/test_perpetual_relative_value_reversal_v3.py",".github/workflows/perpetual-relative-value-reversal-v3-protocol.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| invariants | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | none declared |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4`.

Step inventory: actions/checkout@v4; Verify engine syntax; Run frozen V1 foundation regression; Run V3 protocol invariants; Assert no V3 validation runner exists in protocol PR.

### perpetual-taker-order-flow-relative-strength-v2.yml

Triggers/filters: `{"pull_request":{"paths":["research/PERPETUAL-TAKER-ORDER-FLOW-RELATIVE-STRENGTH-V2-PREREGISTRATION.md","research/perpetual-taker-order-flow-relative-strength-v2-protocol.json","research/perpetual_taker_order_flow_relative_strength_v2.py","scripts/collect-perpetual-taker-order-flow-relative-strength-v2-validation.py","research/run-perpetual-taker-order-flow-relative-strength-v2-validation.py","test/test_perpetual_taker_order_flow_relative_strength_v2.py",".github/workflows/perpetual-taker-order-flow-relative-strength-v2.yml"]},"push":{"branches":["research/taker-order-flow-relative-strength-v2-validation-run"],"paths":["research/PERPETUAL-TAKER-ORDER-FLOW-RELATIVE-STRENGTH-V2-RUN-AUTHORIZATION.md"]}}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| invariants | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | none declared |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-python@v5`.

Step inventory: actions/checkout@v4; actions/setup-python@v5; Verify frozen research lineage; Compile feature-validation implementation; Run frozen V2 feature invariants only.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| source | inherits workflow {"contents":"read"} | github.event_name != 'pull_request' | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"taker-flow-relative-strength-v2-validation-source","path":"/tmp/meridian-taker-flow-rs-v2-validation","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-python@v5, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; actions/setup-python@v5; Collect first authorized independent public validation source; Upload exact validation source package.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| evaluate | inherits workflow {"contents":"read"} | github.event_name != 'pull_request' | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/download-artifact@v4","inputs":{"name":"taker-flow-relative-strength-v2-validation-source","path":"/tmp/meridian-taker-flow-rs-v2-validation"}},{"action":"actions/upload-artifact@v4","inputs":{"name":"taker-flow-relative-strength-v2-validation-result","path":"research/results/perpetual-taker-order-flow-relative-strength-v2-result.json\nresearch/results/perpetual-taker-order-flow-relative-strength-v2-result.md\n","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-python@v5, actions/download-artifact@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; actions/setup-python@v5; actions/download-artifact@v4; Run first frozen independent feature-validation gate; Upload untouched V2 feature result [if: always()].

### perpetual-taker-order-flow-v1-data.yml

Triggers/filters: `{"push":{"branches":["research/perpetual-taker-order-flow-v1-data"],"paths":["research/PERPETUAL-TAKER-ORDER-FLOW-V1-DATA-FROZEN.md","scripts/audit-perpetual-taker-order-flow-v1-data.py",".github/workflows/perpetual-taker-order-flow-v1-data.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| data-foundation | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"perpetual-taker-order-flow-v1-data","path":"research/results/perpetual-taker-order-flow-v1-data.json","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; Run frozen strategy-neutral Taker Order Flow data audit; Upload untouched foundation evidence.

### perpetual-taker-order-flow-v1-development.yml

Triggers/filters: `{"push":{"branches":["research/perpetual-taker-order-flow-v1-development"],"paths":["scripts/collect-perpetual-taker-order-flow-v1-development.py","research/run-perpetual-taker-order-flow-v1-development.py","test/test_perpetual_taker_order_flow_v1_development_harness.py",".github/workflows/perpetual-taker-order-flow-v1-development.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| development | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"perpetual-taker-order-flow-v1-development","path":"research/results/perpetual-taker-order-flow-v1-development-summary.json\nresearch/results/perpetual-taker-order-flow-v1-development-full.json\nresearch/results/perpetual-taker-order-flow-v1-development.md\n","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; Verify canonical Taker Order Flow V1 invariants; Verify development-only holdout exclusion; Collect development-only official Binance Vision data; Run first frozen Taker Order Flow V1 DEVELOPMENT; Upload untouched development evidence.

### perpetual-taker-order-flow-v1-invariants.yml

Triggers/filters: `{"push":{"branches":["research/perpetual-taker-order-flow-v1-protocol-r2"],"paths":["research/PERPETUAL-TAKER-ORDER-FLOW-V1-FROZEN.md","research/perpetual-taker-order-flow-v1-protocol.json","research/perpetual_taker_order_flow_v1.py","test/test_perpetual_taker_order_flow_v1.py",".github/workflows/perpetual-taker-order-flow-v1-invariants.yml"]},"pull_request":{"paths":["research/PERPETUAL-TAKER-ORDER-FLOW-V1-FROZEN.md","research/perpetual-taker-order-flow-v1-protocol.json","research/perpetual_taker_order_flow_v1.py","test/test_perpetual_taker_order_flow_v1.py",".github/workflows/perpetual-taker-order-flow-v1-invariants.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| invariants | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | none declared |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4`.

Step inventory: actions/checkout@v4; Verify frozen Taker Order Flow V1 invariants.

### perpetual-taker-order-flow-v1-provenance.yml

Triggers/filters: `{"pull_request":{"paths":["research/PERPETUAL-TAKER-ORDER-FLOW-V1-PROVENANCE-AUDIT.md","research/perpetual-taker-order-flow-v1-provenance-audit.json","research/perpetual-taker-order-flow-v1-development-result.json","research/perpetual_taker_order_flow_v1.py","research/run-perpetual-taker-order-flow-v1-development.py","scripts/collect-perpetual-taker-order-flow-v1-development.py","scripts/validate-perpetual-taker-order-flow-v1-provenance.py",".github/workflows/perpetual-taker-order-flow-v1-provenance.yml"]},"push":{"branches":["main"],"paths":["research/PERPETUAL-TAKER-ORDER-FLOW-V1-PROVENANCE-AUDIT.md","research/perpetual-taker-order-flow-v1-provenance-audit.json","research/perpetual-taker-order-flow-v1-development-result.json","research/perpetual_taker_order_flow_v1.py","research/run-perpetual-taker-order-flow-v1-development.py","scripts/collect-perpetual-taker-order-flow-v1-development.py","scripts/validate-perpetual-taker-order-flow-v1-provenance.py",".github/workflows/perpetual-taker-order-flow-v1-provenance.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| provenance | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | none declared |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4`.

Step inventory: actions/checkout@v4; Validate immutable V1 provenance and holdout isolation.

### portfolio-contract-v763.yml

Triggers/filters: `{"push":{"branches":["fix/portfolio-data-contract-v763"]},"pull_request":{"paths":["portfolio-data-contract.js","app-v7.61-depot-audit.js","test/portfolio-data-contract.test.js","version.json",".github/workflows/portfolio-contract-v763.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| consistency | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/setup-node@v4","inputs":{"node-version":"20","cache":"npm"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-node@v4`.

Step inventory: actions/checkout@v4; actions/setup-node@v4; Deterministic install; Portfolio contract regression tests; Syntax check Depot adapter; Release safety.

### portfolio-history-v764.yml

Triggers/filters: `{"push":{"branches":["fix/canonical-portfolio-history-v764"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| history | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/setup-node@v4","inputs":{"node-version":"20","cache":"npm"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-node@v4`.

Step inventory: actions/checkout@v4; actions/setup-node@v4; Deterministic install; Canonical history tests; Syntax checks; Release safety.

### qh-boundary-strategy-v1.yml

Triggers/filters: `{"pull_request":{"paths":["research/PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-STRATEGY-V1-IMPLEMENTATION.md","research/qh_boundary_strategy_v1_core.py","scripts/extract-qh-boundary-strategy-v1-shard.py","scripts/aggregate-qh-boundary-strategy-v1.py","scripts/build-qh-v13-source-lock.py","scripts/download-github-run-artifacts.sh","test/test_qh_boundary_strategy_v1.py","test/qh-strategy-v1-artifact-pagination.test.js",".github/workflows/qh-boundary-strategy-v1.yml"]},"push":{"branches":["research/qh-boundary-strategy-v1-run"],"paths":["research/PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-STRATEGY-V1-RUN-AUTHORIZATION.md"]}}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| invariants | inherits workflow {"contents":"read","actions":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | none declared |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4`.

Step inventory: actions/checkout@v4; Compile deterministic Strategy V1 implementation; Run Strategy V1 synthetic invariants.

Built-in token referenced explicitly through `github.token`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| source-lock | inherits workflow {"contents":"read","actions":"read"} | github.event_name != 'pull_request' | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"qh-v13-source-lock","path":"research/results/qh-v13-source-lock.json","if-no-files-found":"error"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; Download all exact Data V1.3 shard evidence with pagination; Build exact Data V1.3 source checksum lock; Upload exact source lock.

Built-in token referenced explicitly through `github.token`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| shard | inherits workflow {"contents":"read","actions":"read"} | github.event_name != 'pull_request' | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/download-artifact@v4","inputs":{"name":"qh-v13-source-lock","path":"research/results"}},{"action":"actions/upload-artifact@v4","inputs":{"name":"qh-strategy-v1-shard-${{ matrix.asset }}-${{ matrix.month }}","path":"research/results/qh-strategy-v1-shard/*.json","if-no-files-found":"error"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/download-artifact@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; Download exact Data V1.3 source lock; Extract frozen Strategy V1 compact source shard; Upload compact Strategy V1 source shard [if: always()].

Built-in token referenced explicitly through `github.token`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| aggregate | inherits workflow {"contents":"read","actions":"read"} | github.event_name != 'pull_request' && always() | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"qh-boundary-imbalance-strategy-v1-result","path":"research/results/quarter-hour-boundary-imbalance-strategy-v1-result.json","if-no-files-found":"error"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; Download all Strategy V1 shard artifacts with pagination; Require 120 compact source shards and run frozen Strategy V1; Upload Strategy V1 result [if: always()].

Built-in token referenced explicitly through `github.token`.

### qh-boundary-strategy-v2.yml

Triggers/filters: `{"pull_request":{"paths":["research/PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-STRATEGY-V2-PREREGISTRATION.md","research/PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-STRATEGY-V2-IMPLEMENTATION.md","research/qh_boundary_strategy_v2_core.py","research/quarter-hour-boundary-imbalance-strategy-v1-result-summary.json","scripts/aggregate-qh-boundary-strategy-v2.py","scripts/download-github-run-artifacts.sh","test/test_qh_boundary_strategy_v2.py",".github/workflows/qh-boundary-strategy-v2.yml"]},"push":{"branches":["research/qh-boundary-strategy-v2-run"],"paths":["research/PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-STRATEGY-V2-RUN-AUTHORIZATION.md"]}}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| invariants | inherits workflow {"contents":"read","actions":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | none declared |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4`.

Step inventory: actions/checkout@v4; Verify frozen research lineage; Compile deterministic Strategy V2 implementation; Run Strategy V2 synthetic invariants.

Built-in token referenced explicitly through `github.token`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| source | inherits workflow {"contents":"read","actions":"read"} | github.event_name != 'pull_request' | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"qh-strategy-v2-source","path":"research/results/qh-strategy-v2-source","if-no-files-found":"error"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; Download frozen Strategy V1 compact source shards; Upload exact V2 source package.

Built-in token referenced explicitly through `github.token`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| aggregate | inherits workflow {"contents":"read","actions":"read"} | github.event_name != 'pull_request' | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/download-artifact@v4","inputs":{"name":"qh-strategy-v2-source","path":"research/results/qh-strategy-v2-source"}},{"action":"actions/upload-artifact@v4","inputs":{"name":"qh-boundary-imbalance-strategy-v2-development-result","path":"research/results/quarter-hour-boundary-imbalance-strategy-v2-development-result.json","if-no-files-found":"error"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/download-artifact@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; Download frozen V2 source package; Require 120 frozen source shards and run Strategy V2 development evidence; Upload Strategy V2 development result [if: always()].

Built-in token referenced explicitly through `github.token`.

### qh-individual-trades-data-v1-1.yml

Triggers/filters: `{"pull_request":{"paths":["research/PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-INDIVIDUAL-TRADES-DATA-V1-1.md","scripts/audit-qh-individual-trades-data-v1-1-shard.py","scripts/aggregate-qh-individual-trades-data-v1-1.py","test/test_qh_individual_trades_data_v1_1.py",".github/workflows/qh-individual-trades-data-v1-1.yml"]},"push":{"branches":["research/qh-individual-trades-data-v1-1"],"paths":["research/PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-INDIVIDUAL-TRADES-DATA-V1-1-FULL-RUN.md"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| invariants | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | none declared |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4`.

Step inventory: actions/checkout@v4; Verify parser invariants.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| canary | inherits workflow {"contents":"read"} | github.event_name == 'pull_request' | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"qh-v11-canary-${{ matrix.asset }}-${{ matrix.month }}","path":"research/results/qh-v11-canary/*.json","if-no-files-found":"warn"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; Validate individual-trades canary; Upload canary evidence [if: always()].

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| shard | inherits workflow {"contents":"read"} | github.event_name != 'pull_request' | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"qh-v11-shard-${{ matrix.asset }}-${{ matrix.month }}","path":"research/results/qh-v11-shard/*.json","if-no-files-found":"warn"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; Verify and discard raw shard; Upload compact shard evidence [if: always()].

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| aggregate | inherits workflow {"contents":"read"} | github.event_name != 'pull_request' && always() | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/download-artifact@v4","inputs":{"pattern":"qh-v11-shard-*","path":"research/results/qh-v11-shards","merge-multiple":"true"}},{"action":"actions/upload-artifact@v4","inputs":{"name":"qh-individual-trades-data-v1-1","path":"research/results/qh-individual-trades-data-v1-1-summary.json","if-no-files-found":"warn"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/download-artifact@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; actions/download-artifact@v4; Require 120/120 green shards; Upload aggregate evidence [if: always()].

### qh-individual-trades-data-v1-3.yml

Triggers/filters: `{"pull_request":{"paths":["research/PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-INDIVIDUAL-TRADES-DATA-V1-3.md","scripts/audit-qh-individual-trades-data-v1-3-shard.py","scripts/aggregate-qh-individual-trades-data-v1-3.py","test/test_qh_individual_trades_data_v1_3.py",".github/workflows/qh-individual-trades-data-v1-3.yml"]},"push":{"branches":["research/qh-individual-trades-data-v1-3-clean"],"paths":["research/PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-INDIVIDUAL-TRADES-DATA-V1-3-FULL-RUN.md"]}}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| invariants | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | none declared |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4`.

Step inventory: actions/checkout@v4; Verify frozen V1.3 parser invariants.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| canary | inherits workflow {"contents":"read"} | github.event_name == 'pull_request' | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"qh-v13-canary-${{ matrix.role }}-${{ matrix.asset }}-${{ matrix.month }}","path":"research/results/qh-v13-canary/*.json","if-no-files-found":"error"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; Validate frozen V1.3 canary; Upload V1.3 canary evidence [if: always()].

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| shard | inherits workflow {"contents":"read"} | github.event_name != 'pull_request' | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"qh-v13-shard-${{ matrix.asset }}-${{ matrix.month }}","path":"research/results/qh-v13-shard/*.json","if-no-files-found":"error"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; Verify and discard raw V1.3 shard; Upload compact V1.3 shard evidence [if: always()].

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| aggregate | inherits workflow {"contents":"read"} | github.event_name != 'pull_request' && always() | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/download-artifact@v4","inputs":{"pattern":"qh-v13-shard-*","path":"research/results/qh-v13-shards","merge-multiple":"true"}},{"action":"actions/upload-artifact@v4","inputs":{"name":"qh-individual-trades-data-v1-3","path":"research/results/qh-individual-trades-data-v1-3-summary.json","if-no-files-found":"error"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/download-artifact@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; actions/download-artifact@v4; Require 120/120 V1.3 green shards; Upload V1.3 aggregate evidence [if: always()].

### qh-individual-trades-source-v0-1.yml

Triggers/filters: `{"push":{"branches":["research/qh-individual-trades-source-v0-1"],"paths":["scripts/audit-qh-individual-trades-source-v0-1.py",".github/workflows/qh-individual-trades-source-v0-1.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| availability | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"qh-individual-trades-source-v0-1","path":"research/results/qh-individual-trades-source-v0-1-summary.json\nresearch/results/qh-individual-trades-source-v0-1-full.json\n","if-no-files-found":"warn"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; Check 120 monthly trades archives and checksums; Upload source-feasibility evidence [if: always()].

### quarter-hour-boundary-imbalance-v1-data-v0.yml

Triggers/filters: `{"pull_request":{"paths":["research/PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-V1-SELECTION.md","scripts/audit-quarter-hour-boundary-imbalance-v1-data-v0.py",".github/workflows/quarter-hour-boundary-imbalance-v1-data-v0.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| data-v0 | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"quarter-hour-boundary-imbalance-v1-data-v0","path":"research/results/quarter-hour-boundary-imbalance-v1-data-v0-summary.json\nresearch/results/quarter-hour-boundary-imbalance-v1-data-v0-full.json\n","if-no-files-found":"warn"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; Audit official archive availability only; Upload V0 audit evidence [if: always()].

### quarter-hour-boundary-imbalance-v1-data-v1.yml

Triggers/filters: `{"pull_request":{"paths":["research/PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-V1-DATA-V1.md","scripts/audit-quarter-hour-boundary-imbalance-v1-data-v1-shard.py","scripts/aggregate-quarter-hour-boundary-imbalance-v1-data-v1.py","test/test_quarter_hour_boundary_imbalance_v1_data_v1.py",".github/workflows/quarter-hour-boundary-imbalance-v1-data-v1.yml"]},"push":{"branches":["research/quarter-hour-order-imbalance-v1-data-v1-sharded"],"paths":["research/PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-V1-DATA-V1-FULL-RUN.md"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| invariants | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | none declared |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4`.

Step inventory: actions/checkout@v4; Verify Data V1 parser invariants.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| canary | inherits workflow {"contents":"read"} | github.event_name == 'pull_request' | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"qh-v1-canary-${{ matrix.asset }}-${{ matrix.month }}","path":"research/results/qh-v1-canary/*.json","if-no-files-found":"warn"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; Stream-validate representative shard; Upload canary evidence [if: always()].

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| shard | inherits workflow {"contents":"read"} | github.event_name != 'pull_request' | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"qh-v1-shard-${{ matrix.asset }}-${{ matrix.month }}","path":"research/results/qh-v1-shard/*.json","if-no-files-found":"warn"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; Verify, stream-parse and discard raw shard; Upload compact shard evidence [if: always()].

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| aggregate | inherits workflow {"contents":"read"} | github.event_name != 'pull_request' && always() | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/download-artifact@v4","inputs":{"pattern":"qh-v1-shard-*","path":"research/results/qh-v1-shards","merge-multiple":"true"}},{"action":"actions/upload-artifact@v4","inputs":{"name":"quarter-hour-boundary-imbalance-v1-data-v1","path":"research/results/quarter-hour-boundary-imbalance-v1-data-v1-summary.json","if-no-files-found":"warn"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/download-artifact@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; Download all shard manifests; Require 120/120 green shards; Upload aggregate Data V1 evidence [if: always()].

### regime-gated-grid-v2.yml

Triggers/filters: `{"push":{"branches":["research/regime-gated-grid-v2"],"paths":["research/REGIME-GATED-GRID-V2-FROZEN.md","research/regime-gated-grid-v2.js","research/run-regime-gated-grid-v2.mjs","research/dynamic-grid-proxy-v1.js","research/grid-path-simulator-v1.js","scripts/collect-regime-gated-grid-v2.py","test/regime-gated-grid-v2.test.js","test/dynamic-grid-proxy-v1.test.js","test/grid-path-simulator-v1.test.js",".github/workflows/regime-gated-grid-v2.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| discovery | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"regime-gated-grid-v2","path":"research/results/regime-gated-grid-v2-summary.json\nresearch/results/regime-gated-grid-v2-full.json\nresearch/results/regime-gated-grid-v2.md\n","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-node@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; actions/setup-node@v4; Verify frozen Grid V2 invariants; Collect official Binance Vision regime and minute data; Run first frozen Regime-Gated Grid V2 discovery; Upload untouched V2 discovery evidence.

### release-coordinator.yml

Triggers/filters: `{"push":{"branches":["main"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| sweep | inherits workflow {"contents":"read","pull-requests":"write"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/setup-node@v4","inputs":{"node-version":"20","cache":"npm"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-node@v4`.

Step inventory: actions/checkout@v4; actions/setup-node@v4; Deterministic install; Close stale release PRs.

Built-in token referenced explicitly through `github.token`.

### research-profit-discovery-v1.yml

Triggers/filters: `{"push":{"branches":["research-profit-discovery-v1"],"paths":["research/paperbot-profit-special-agent-v1.js","research/run-paperbot-profit-discovery.mjs",".github/workflows/research-profit-discovery-v1.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| discovery | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"paperbot-profit-discovery-v1","path":"research/results/paperbot-profit-discovery-v1-summary.json\nresearch/results/paperbot-profit-discovery-v1-full.json\nresearch/results/paperbot-profit-discovery-v1.md\n","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-node@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; actions/setup-node@v4; Run frozen 1460-day discovery; Upload untouched discovery evidence.

### research-profit-v2-upup.yml

Triggers/filters: `{"push":{"branches":["research-profit-agent-v2"],"paths":["research/PAPERBOT-PROFIT-SPECIAL-AGENT-V2.md","research/paperbot-profit-special-agent-v2.js","research/run-paperbot-profit-v2-upup.mjs","test/paperbot-profit-special-agent-v2.test.js",".github/workflows/research-profit-v2-upup.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| discovery | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"paperbot-profit-v2-upup","path":"research/results/paperbot-profit-v2-upup-summary.json\nresearch/results/paperbot-profit-v2-upup-full.json\n","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-node@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; actions/setup-node@v4; V2 module tests; Run frozen V2 UP-UP discovery; Upload untouched V2 evidence.

### runtime-smoke.yml

Triggers/filters: `{"push":{"branches":["main"]},"schedule":[{"cron":"17,47 * * * *"}],"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| smoke | inherits workflow {"contents":"read","statuses":"write"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | none declared |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-node@v4`.

Step inventory: actions/checkout@v4; actions/setup-node@v4; Publish runtime smoke pending; Verify GitHub Pages and Northflank runtime; Publish runtime smoke result [if: ${{ always() }}]; Preserve runtime smoke failure semantics [if: ${{ steps.runtime_smoke.outcome != 'success' }}].

Built-in token referenced explicitly through `github.token`.

### selective-static-cross-venue-funding-v4.yml

Triggers/filters: `{"push":{"branches":["research/selective-static-cross-venue-funding-v4"],"paths":["research/SELECTIVE-STATIC-CROSS-VENUE-FUNDING-V4-FROZEN.md","research/selective-static-cross-venue-funding-v4.js","research/run-selective-static-cross-venue-funding-v4.mjs","scripts/collect-selective-static-cross-venue-binance-v4.py","test/selective-static-cross-venue-funding-v4.test.js",".github/workflows/selective-static-cross-venue-funding-v4.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| validation | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"selective-static-cross-venue-funding-v4","path":"research/results/selective-static-cross-venue-funding-v4-summary.json\nresearch/results/selective-static-cross-venue-funding-v4-full.json\nresearch/results/selective-static-cross-venue-funding-v4.md\n","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-node@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; actions/setup-node@v4; Verify frozen Selective Static V4 invariants; Collect official Binance Vision V4 holdout archives; Run first independent V4 validation; Upload untouched V4 evidence.

### self-history-perp-factor-v2.yml

Triggers/filters: `{"push":{"branches":["research/self-history-perp-factor-v2"],"paths":["research/SELF-HISTORY-PERP-FACTOR-V2-FROZEN.md","research/self_history_perp_factor_v2.py","research/run-self-history-perp-factor-v2.py","scripts/collect-self-history-perp-factor-v2.py","test/test_self_history_perp_factor_v2.py",".github/workflows/self-history-perp-factor-v2.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| discovery | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"self-history-perp-factor-v2","path":"research/results/self-history-perp-factor-v2-summary.json\nresearch/results/self-history-perp-factor-v2-full.json\nresearch/results/self-history-perp-factor-v2.md\n","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; Verify frozen V2 invariants; Collect official Binance Vision factor archives; Run first frozen V2 discovery; Upload untouched discovery evidence.

### self-history-perp-factor-v3.yml

Triggers/filters: `{"push":{"branches":["research/self-history-perp-factor-v3"],"paths":["research/SELF-HISTORY-PERP-FACTOR-V3-FROZEN.md","research/self_history_perp_factor_v3.py","research/run-self-history-perp-factor-v3.py","test/test_self_history_perp_factor_v3.py",".github/workflows/self-history-perp-factor-v3.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| discovery | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"self-history-perp-factor-v3","path":"research/results/self-history-perp-factor-v3-summary.json\nresearch/results/self-history-perp-factor-v3-full.json\nresearch/results/self-history-perp-factor-v3.md\n","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; Verify frozen V3 invariants; Collect official Binance Vision factor archives; Run first frozen V3 discovery; Upload untouched discovery evidence.

### spot-perp-basis-dislocation-v1-data-v1.yml

Triggers/filters: `{"push":{"branches":["research/spot-perp-basis-dislocation-v1-data-v1"],"paths":["research/SPOT-PERP-BASIS-DISLOCATION-V1-DATA-V1-FROZEN.md","scripts/audit-spot-perp-basis-dislocation-v1-data-v1.py",".github/workflows/spot-perp-basis-dislocation-v1-data-v1.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| foundation | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"spot-perp-basis-dislocation-v1-data-v1","path":"research/results/spot-perp-basis-dislocation-v1-data-v1.json","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; Python syntax; Run frozen full-row public-data audit; Upload untouched foundation evidence.

### spot-perp-basis-dislocation-v1.yml

Triggers/filters: `{"push":{"branches":["research/spot-perp-basis-dislocation-v1-strategy"],"paths":["research/SPOT-PERP-BASIS-DISLOCATION-V1-FROZEN.md","research/spot-perp-basis-dislocation-v1.js","research/run-spot-perp-basis-dislocation-v1.mjs","scripts/collect-spot-perp-basis-dislocation-v1.py","test/spot-perp-basis-dislocation-v1.test.js",".github/workflows/spot-perp-basis-dislocation-v1.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| discovery | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"spot-perp-basis-dislocation-v1","path":"research/results/spot-perp-basis-dislocation-v1-summary.json\nresearch/results/spot-perp-basis-dislocation-v1-full.json\nresearch/results/spot-perp-basis-dislocation-v1.md\n","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-node@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; actions/setup-node@v4; Syntax check frozen engine and runner; Verify frozen strategy invariants; Collect discovery-only official Binance Vision archives; Run first frozen Basis Dislocation discovery; Upload untouched discovery evidence.

### spot-perp-basis-volatility-regime-v1.yml

Triggers/filters: `{"push":{"branches":["research/spot-perp-basis-volatility-regime-v1"],"paths":["research/SPOT-PERP-BASIS-VOLATILITY-REGIME-V1-FROZEN.md","research/spot-perp-basis-volatility-regime-v1.js","research/run-spot-perp-basis-volatility-regime-v1.mjs","test/spot-perp-basis-volatility-regime-v1.test.js",".github/workflows/spot-perp-basis-volatility-regime-v1.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| feature-discovery | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"spot-perp-basis-volatility-regime-v1","path":"research/results/spot-perp-basis-volatility-regime-v1-summary.json\nresearch/results/spot-perp-basis-volatility-regime-v1-full.json\nresearch/results/spot-perp-basis-volatility-regime-v1.md\n","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-node@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; actions/setup-node@v4; Syntax check frozen feature engine and runner; Verify frozen feature invariants; Collect discovery-only synchronized Binance Vision archives; Run first frozen Basis-Volatility feature discovery; Upload untouched feature evidence.

### spot-perp-funding-harvest-v1-data-v1.yml

Triggers/filters: `{"push":{"branches":["research/spot-perp-funding-harvest-v1-data-v1"],"paths":["research/SPOT-PERP-FUNDING-HARVEST-V1-DATA-V1-FROZEN.md","scripts/audit-spot-perp-funding-harvest-v1-data-v1.py",".github/workflows/spot-perp-funding-harvest-v1-data-v1.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| coverage-audit | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"spot-perp-funding-harvest-v1-data-v1","path":"research/results/spot-perp-funding-harvest-v1-data-v1.json","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; Run frozen Spot-Perp public-data audit; Upload untouched foundation evidence.

### spot-perp-funding-harvest-v1-data-v2.yml

Triggers/filters: `{"push":{"branches":["research/spot-perp-funding-harvest-v1-data-v2"],"paths":["research/SPOT-PERP-FUNDING-HARVEST-V1-DATA-V2-FROZEN.md","scripts/audit-spot-perp-funding-harvest-v1-data-v2.py",".github/workflows/spot-perp-funding-harvest-v1-data-v2.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| coverage-audit | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"spot-perp-funding-harvest-v1-data-v2","path":"research/results/spot-perp-funding-harvest-v1-data-v2.json","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; Run frozen Spot-Perp V2 public-data audit; Upload untouched foundation evidence.

### spot-perp-funding-harvest-v1.yml

Triggers/filters: `{"push":{"branches":["research/spot-perp-funding-harvest-v1-strategy"],"paths":["research/SPOT-PERP-FUNDING-HARVEST-V1-FROZEN.md","research/spot-perp-funding-harvest-v1.js","research/run-spot-perp-funding-harvest-v1.mjs","scripts/collect-spot-perp-funding-harvest-v1.py","test/spot-perp-funding-harvest-v1.test.js",".github/workflows/spot-perp-funding-harvest-v1.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| discovery | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"spot-perp-funding-harvest-v1","path":"research/results/spot-perp-funding-harvest-v1-summary.json\nresearch/results/spot-perp-funding-harvest-v1-full.json\nresearch/results/spot-perp-funding-harvest-v1.md\n","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-node@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; actions/setup-node@v4; Verify frozen Spot-Perp V1 invariants; Collect discovery-only official Binance Vision archives; Run first frozen Spot-Perp V1 discovery; Upload untouched discovery evidence.

### spot-perp-funding-persistence-v2.yml

Triggers/filters: `{"push":{"branches":["research/spot-perp-funding-persistence-v2"],"paths":["research/SPOT-PERP-FUNDING-PERSISTENCE-V2-FROZEN.md","research/spot-perp-funding-persistence-v2.js","research/run-spot-perp-funding-persistence-v2.mjs","scripts/collect-spot-perp-funding-persistence-v2.py","test/spot-perp-funding-persistence-v2.test.js",".github/workflows/spot-perp-funding-persistence-v2.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| validation | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"spot-perp-funding-persistence-v2","path":"research/results/spot-perp-funding-persistence-v2-summary.json\nresearch/results/spot-perp-funding-persistence-v2-full.json\nresearch/results/spot-perp-funding-persistence-v2.md\n","if-no-files-found":"error","retention-days":"30"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-node@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; actions/setup-node@v4; Verify frozen V2 state invariants; Collect independent official Binance Vision archives; Run first frozen V2 independent validation; Upload untouched V2 evidence.

### v10-visual-qa.yml

Triggers/filters: `{"pull_request":{"paths":["v10/**","v9/v9.js","v9/index.html","index.html","version.json","manifest.webmanifest","scripts/v10-visual-qa.mjs","scripts/r122-command-browser-qa.mjs","test/v10-r83-visual-qa-harness.test.js",".github/workflows/v10-visual-qa.yml"]},"push":{"branches":["main"],"paths":["v10/**","v9/v9.js","v9/index.html","index.html","version.json","manifest.webmanifest","scripts/v10-visual-qa.mjs","scripts/r122-command-browser-qa.mjs","test/v10-r83-visual-qa-harness.test.js",".github/workflows/v10-visual-qa.yml"]},"workflow_dispatch":""}`.

| Job | Declared/effective inheritance | Condition | Checkout | Cache/artifact declarations |
|---|---|---|---|---|
| mobile-visual | inherits workflow {"contents":"read"} | no job condition | [{"action":"actions/checkout@v4","ref":"DEFAULT EVENT REF/SHA (runtime UNKNOWN)","persist-credentials":"DEFAULT true","repository":"current repository"}] | [{"action":"actions/upload-artifact@v4","inputs":{"name":"meridian-v10-visual-qa-${{ github.sha }}","path":"artifacts/visual-qa/","if-no-files-found":"warn","retention-days":"14"}}] |

Executed code revision: checkout rule above; subsequent script-selected revisions UNKNOWN. Actions: `actions/checkout@v4, actions/setup-node@v4, actions/upload-artifact@v4`.

Step inventory: actions/checkout@v4; actions/setup-node@v4; Verify Chrome; Start deterministic local shell; Run mobile visual QA; Run R122 Command behavioral QA; Upload visual evidence [if: always()].

## Manual risk interpretation

- `cross-sectional-reversal-v1.yml` has no token permission declaration. Effective default is UNKNOWN, so continuation must not assume this PR workflow is read-only.

- `backend-safety.yml` executes PR code/tests with contents and PR read permissions, default checkout persistence, and npm cache. A trusted writer must not execute PR code or restore its caches/artifacts into a credential-bearing job. `npm ci --ignore-scripts` reduces install-script execution; it does not make repository tests trusted.

- `copilot-coding-pilot.yml` uses workflow_run, no checkout, and separate claim/generate/publish jobs. Claim has contents write; publish has contents and PR write. Those are repository capabilities, not technical path/branch confinement. Source YAML fetches the control helper at GITHUB_SHA; helper behavior requires its own exact-commit review.

- `copilot-ci-event-pilot.yml` is an inline workflow_run observer with copilot-requests write. No checkout does not make model invocation free or establish a cross-lane invocation limit.

- `claude-mailbox-review.yml` and `claude-watchdog-15m.yml` directly reference only the secret name CLAUDE_CODE_OAUTH_TOKEN, and grant issues write plus id-token write. Natural-language reviewer restrictions do not equal credential isolation. The watchdog caches a fingerprint; this is not a durable atomic budget ledger.

- `release-coordinator.yml` runs main/dispatch repository code with PR write and npm caching. `runtime-smoke.yml` runs main/schedule/dispatch code with statuses write. `meridian-snapshot.yml` has contents write and switches to telemetry at runtime; exact telemetry revision is UNKNOWN. `asset-watch-mirror.yml` has OIDC authority; its watchdog has actions write. They must be considered when claiming global writer fencing.

- Named research push filters constrain normal triggers, not token authority, and are not permission to rerun research. workflow_dispatch can select a ref; review conditions and source authorization separately. No absence of YAML secrets proves absence of credential access through built-in tokens, OIDC or third-party actions.

## Reproduction

List Git tree `0e28cd177a3af0423092789647b439f60fed809f` and `.github/workflows` tree `8968c2b066c8751de6658ef1428ff5984188f0da`; require exactly the 75 listed blob entries. Fetch each path with `ref=0e28cd177a3af0423092789647b439f60fed809f`. Check `SHA1("blob " + byte_length + NUL + UTF8_body)` against the blob column and SHA-256 against the content column. Parse with a YAML 1.2-compatible loader or BaseLoader to avoid YAML 1.1 boolean conversion of `on`. Extract `on`, workflow/job `permissions`, every checkout `with`, cache/artifact `uses/with`, and lexical `secrets` identifiers. Manually examine custom fetch/run commands separately. Do not execute any retrieved code during inventory.

Sources: [workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax), [event revision and workflow_run security](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), [checkout v4 defaults](https://github.com/actions/checkout/blob/v4/action.yml).
