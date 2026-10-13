# Owner-accepted photo mapping — 13 October 2026

The owner supplied IMG_0273.jpeg and accepted the analysis at 21:29 Europe/Vienna. All 22 visible labels are mapped below. These are research priorities, not profitable-strategy claims or extra registered campaign slots. No performance evaluation or trading is authorized by this file.

| Visible concepts | Research role | Priority |
|---|---|---|
| Breakout; Momentum Indicators | Continuation hypotheses; Williams-related breakout | High |
| Reversal; Oscillators | Trend pullback and shock/reclaim | High |
| Support & Resistance; Dynamic S&R; Trend Lines | Fixed causal price boundaries, averages or channels | High with explicit rules |
| Market Structures; BOS; CHoCH | Structure continuation/change; confirmed pivots only | Medium |
| Volume | Separately evaluated liquidity/activity filter | High as filter |
| Candlestick; Divergence | Incremental signal features against a simple control | Medium |
| Fair Value Gap; Supply & Demand | Defined zones/retracement hypotheses, not proof of institutional orders | Experimental |
| Fibonacci; Harmonic Patterns; Elliott Wave; Gann Angles | Require objective anchors, invalidation and causal recognition | Backlog |
| Heikin Ashi; Renko | Alternative signal transformations; real market-price execution | Backlog |
| Moon Phases | No priority in current campaign | Deferred |

## Selected subcategories

1. Trend pullback: implement the daily P1 specification from WILLIAMS_RESEARCH_20261013.md first. A four-hour entry is a separate later variant. The entry/exit conflict is resolved: exits take priority, and a new long requires current %R strictly between -80 and -20 following a crossing from <= -80. No same-bar re-entry.
2. Structure breakout: candidate close above the highest high of the preceding 20 completed bars, excluding the signal bar. Signal becomes available only after close and receipt. Entry occurs later at an executable quote. A 4-hour versus daily version and a volume filter each consume variant budget; no tested winner yet. This differs from Williams session-open-plus-range breakout and must retain that lineage distinction.
3. Failed breakout/reclaim: breach of a support fixed before the event followed by a confirmed close back above it. Fifteen-minute research candidate; compare with the existing five-minute H5 shock/reclaim hypothesis without reusing its evidence as a PASS. Full stop/exit/expiry parameters remain to be preregistered.
4. Impulse retracement/FVG: experimental bullish zone may be defined after three closed candles by low[t] > high[t-2], zone [high[t-2], low[t]]. Earliest observation is close/receipt of t; only later retracements can count. This geometry alone neither identifies pending orders nor guarantees a fill. Additional impulse threshold, entry, expiry and exit rules remain unspecified and must precede testing.

## Controls and data requirements

Start from each unfiltered baseline; add exactly one feature per counted comparison. Do not stack many indicators before attributing incremental contribution. Preserve all failed attempts and existing 12-family/36-candidate limits; taxonomy does not silently expand them. Existing failed breakout lineage remains visible.

A swing point requiring two later candles is available only after those candles close and arrive. Never timestamp its use at the earlier pivot candle. Rolling highs/lows provide a simpler first structure control.

Synthetic Heikin Ashi/Renko prices are not assumed executable. Official platform documentation explains their non-standard construction: https://www.tradingview.com/pine-script-docs/concepts/non-standard-charts-data/ . Raw OHLCV supports signal development; quote/trade data and explicit execution assumptions are needed for realistic fills.

The completed 201-day sample is coverage evidence and inspected development material only, not a performance evaluation. P1 requires OHLCV, not just prepared close windows. Point-in-time membership, identity, costs, FX and independent evaluation data remain unresolved.

Next implementation packet: pure offline P1 signal evaluator, causal synthetic fixtures and independent review. No runtime integration, live orders, automated promotion or changes to the frozen reference. The prior mandatory 3:1 policy still requires a separate reviewed code migration before downstream evaluation.
