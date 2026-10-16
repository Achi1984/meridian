# OHLCV preparation and cost sensitivity contract

21 complete candidate histories now retain all 4,221 normalized daily OHLCV rows in ohlcv-20241013/. The manifest declares column order, provider identity, current receipt meaning, exclusions and SHA256 per asset file. All closes agree exactly with the previously saved close-only windows. No replacement candidates, missing-day interpolation, new downloads or strategy evaluation.

Only 201 bars per asset are available in this packet: enough for the prototype warmup, not a multi-year performance comparison or a sequence of out-of-sample trades. TON/TAO remain incomplete; attempted LEO/KAS mappings remain unavailable. Historical identity and tradability remain provisional. March–October2024 was inspected; it cannot become an untouched holdout. AvailableAt remains the actual2026 archive receipt. Never overwrite it with historical close time. The strict signal evaluator will correctly reject this old window as stale at today's receipt; historical replay needs separately evidenced historical availability, not bypassed checks.

`prepare-ohlcv-windows.mjs` reproduces the files offline from the prior audit, prior prepared closes and local filtered archive cache. Run at repository root. The cache is a local prerequisite, not fetched by this utility. Checksum/source URLs remain in warmup-history-audit-20241013.json. SHA256 of prepared files checks export integrity, not historic publication truth.

## Cost assumptions, not a verified fee schedule

spot-cost-assumptions.json supplies three predeclared sensitivity cases. Per side, in basis points:

| Case | Fee | Half spread | Adverse slippage |
|---|---:|---:|---:|
| Base assumption | 10 | 5 | 5 |
| Stress assumption | 20 | 10 | 20 |
| Shock assumption | 20 | 30 | 60 |

These are chosen scenario parameters, not calibrated market estimates, actual account rates, universally conservative bounds or loss caps. Report all cases; do not select the one making a strategy pass. No fee discounts or maker rebates assumed. The Binance commission FAQ explains that account/symbol and order-side rates, fee currency, discounts and additional commissions matter; its own example rates are explicitly fictional. No account or private API accessed.

For a future synthetic-cost comparison, let m be an observed midquote strictly after signal receipt, q the quantity and a=(halfSpreadBps+adverseSlippageBps)/10000. Model buy price=m*(1+a), sell price=m*(1-a). Charge feeBps/10000 on each side's own executed notional, with conservative upward monetary rounding. Buy cash debit=q*buyPrice+fee; sell cash credit=q*sellPrice-fee. Fee treatment is a quote-equivalent approximation; production must model fees deducted in base/quote/BNB and resulting quantities exactly.

Do not add a half-spread again when using observed ask/bid prices. Do not double-charge slippage embedded in an actual fill. Entry and exit notionals can differ, so a round-trip cost is not a constant percentage of both trades' starting equity. A stop triggered through a gap uses the next executable quote, not the nominal stop. A touched daily high/low does not prove a fill or determine intraday order of events.

Daily OHLCV does not provide the required midquotes, spreads or order-book depth. A future next-bar-open approximation must be explicitly labelled, separately preregistered and cannot demonstrate executable edge. No such approximation was run here. Liquidity/participation limits, historical fees, tax/special commission treatment, lot sizes and FX remain gates. USD/USDT is not EUR; missing conversion data forbids EUR PnL. Funding and borrowing are excluded only because this contract covers unlevered spot, not because derivatives have zero costs.

## Next bounded packet

Resolve historical instrument identity/eligibility and publication evidence; obtain a longer eligible history and execution/FX evidence; migrate the superseded3:1 campaign policy through review. Then freeze one baseline-versus-P1 comparison, dataset scope and trial ledger before evaluating outcomes. No performance result or paper/live activation is implied by this preparation.
