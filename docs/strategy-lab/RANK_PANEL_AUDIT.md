# Historical rank-panel feasibility audit

Four dates selected before retrieval:1January2023,2July2023,7January2024,7July2024. Each public CMC page supplied200 embedded records. IDs are unique and provider rank sequence is1–200; the first40 are retained with identity, reported capitalization and source timestamps. All USD quote dates match the requested snapshot day. The manifest records HTML hashes and raw Top20 changes by provider ID, not ticker text. No price returns, strategies or trades are evaluated.

Observed raw-provider-Top20 transitions (stablecoins and wrappers INCLUDED):

| From / to | Entered | Left |
|---|---|---|
| Jan2023 / Jul2023 | BCH, TON | UNI, LEO |
| Jul2023 / Jan2024 | LINK, ICP | WBTC, BUSD |
| Jan2024 / Jul2024 | LEO, NEAR | ICP, LTC |

These are set differences between four snapshots, not dates of actual entry/exit, not every intervening membership change, not proof of listing/delisting and not Meridian's eligible Top20. The exercise demonstrates why a fixed survivor list cannot represent changing historical membership.

## Source-quality finding

Provider ranks are NOT consistently sorted by the reported USD market capitalization. Across200records there are11,16,22 and25 adjacent inversions respectively. Among retained rows, affected rank pairs include23/24 inJan2023;25/26 and39/40 inJan2024;17/18 and36/37 inJul2024. Jan2024 also has a40/41 boundary inversion, with rank41 outside the reduced export. No values or rank fields were silently repaired. Source snapshot reconstruction/revisions and rank conventions need investigation before an eligible market-cap-ranked universe can be certified.

The stored tags were returned today. They are explicitly NOT proven historical classifications. A stablecoin/wrapper exclusion cannot acquire point-in-time validity merely because the page is labelled historical. Do not sort only the reduced40 and claim a globally corrected ranking: complete candidate depth and exclusion coverage must be verified. The retained rows plus audit findings preserve the disagreement without choosing whichever ordering helps a strategy.

## Timing and eligibility gates

Source lastUpdated/quoteLastUpdated describe observations, not public release availability. Actual receipt is recorded separately. Pages retrieved today do not prove when those versions first existed; no publication-lag assumption is fabricated. Four semiannual snapshots cannot support a weekly rebalanced historical universe. Missing intermediate snapshots remain missing, not forward-filled through known future changes.

Historical token identity/migrations, exchange listing and market filters, stablecoin/wrapper status, minimum history and liquidity must be evaluated as of each decision. Stable provider IDs help trace identity but do not replace venue-contract verification. New entrants lacking warmup cannot be replaced selectively after seeing returns.

Next work: resolve ranking conventions/capitalization consistency and historical classification evidence, then obtain the needed weekly source panel with a predeclared publication/eligibility policy. This is source preparation only; existing trial caps, prior failures, frozen reference and platform lane remain untouched. No Top20 backtest or execution is approved by this packet.

Sources: https://coinmarketcap.com/historical/20230101/ , https://coinmarketcap.com/historical/20230702/ , https://coinmarketcap.com/historical/20240107/ , https://coinmarketcap.com/historical/20240707/ . Individual records contain source hashes and retrieval times. Full200records per page were inspected; this reduced export retains40. No paid data or account access used.
