# Offline H5 / H7 signal prototypes

These pure deterministic functions use caller-supplied synthetic or already-authorized data. They contain no imports, network, scheduler, persistent state, trading, trade plans or PNL calculations. They neither collect data nor change the existing campaign or frozen LowVol reference. Experimental signal rules are **unvalidated**, not preregistered or performance-tested by this packet.

Every result includes `executionAuthorized:false` and `requiresTradePlan:true`. No CRV qualification or tradability is asserted. `valid:true` means structurally valid input and computable indicators, not a good strategy. An independently justified trade plan must subsequently pass the net CRV policy and all execution/research prerequisites. Even a mathematically qualified plan cannot authorize execution.

## Input and clock contract

Both functions require exact JSON-shaped objects, finite numeric values, dense bounded arrays and safe-integer `asOfMs >= 0`. Unknown fields, optional tuning parameters, malformed values, duplicate symbols, time gaps, out-of-order bars and future data reject the **entire** input. No asset is silently dropped to rescue a malformed selection.

`closeTimeMs` is the **exclusive end boundary of a fully closed bar**, aligned to its UTC interval. A bar ending at `asOfMs` is allowed. Its data must actually have been received by that observation time; timestamp validity cannot establish receipt or feed quality. No partially open bar is accepted. The newest close must be younger than one interval: exactly one interval old is stale. Clocks start at a positive interval boundary. The caller must supply the asset universe that was available then; there is no survivor-bias or data-quality certification here.

## H5: shock followed by first body-midpoint reclaim

Export: `evaluateH5Signal({asOfMs, bars})`.

`bars` contains **23–25** contiguous closed five-minute bars, each exactly `{closeTimeMs, open, high, low, close, volume}`. OHLC prices are finite and positive, volume finite and nonnegative; high/low must contain open and close. Indexing below starts at zero.

- Shock is fixed at index **21**; supplied confirmation bars are indices 22 through the last index, providing one to three confirmation opportunities.
- Prior simple ATR14 is the mean of true ranges at indices **7–20**. True range uses each bar's high/low and the preceding close. The shock and confirmation bars never enter this baseline.
- Prior volume is the median of indices **1–20**, with the middle two averaged. Zero ATR or median volume produces valid `NONE`, not a trade.
- The shock's absolute **body**, `abs(close-open)`, must be at least 3 ATR, and its volume at least 3 median volume.
- A down-body shock suggests LONG; an up-body shock suggests SHORT. The reclaim level is the **body midpoint**, `open+(close-open)/2`, not the high/low midpoint.
- Find the first confirmation close at or above that midpoint for LONG, at or below it for SHORT. A `DRAFT_SIGNAL` occurs only when that first reclaim is the **latest** supplied bar. An earlier reclaim yields `NONE`, avoiding repeat signals as later confirmations arrive. Replaying the exact same input is intentionally deterministic; this stateless function does not provide persistent deduplication.
- Structural stop is shock low minus 0.25 ATR for LONG, shock high plus 0.25 ATR for SHORT. Structural target is the shock **open**, never a manufactured 3R target. Stop and midpoint must remain positive and finite.

The result is `{valid, errors, executionAuthorized:false, requiresTradePlan:true, status, signal}`. Status is `INVALID`, `NONE` or `DRAFT_SIGNAL`. Invalid/NONE has `signal:null`. A draft signal contains `{familyId:'H5', direction, observedAtMs, shockCloseTimeMs, priorATR14, priorMedianVolume, shockMidpoint, stopPrice, structuralTargetPrice}`. `observedAtMs` is the latest closed bar's boundary, not an assumed executable entry price.

**First design attempt rejected for direct entry:** the current stop/target construction is structurally incompatible with the required net CRV of 3:1 for entry at the reclaim close or a worse price. For a LONG, entry is at least the shock body midpoint, the target is the shock open, and the stop is no higher than the shock close minus 0.25 ATR. With positive body size B, gross reward:risk is therefore at most `(B/2)/(B/2 + 0.25 ATR) < 1`. SHORT is symmetric. Nonnegative costs make the ratio no better. If price has already passed the target, the planned reward is nonpositive.

This is useful early falsification of the **direct-entry design**, not a viable 3:1 trading rule or evidence of an edge. The primitive remains a research signal only. A later improved entry price is unproven and must not be presumed. Do not invent a distant target, relocate the stop or relax the CRV requirement to rescue this attempt. A different entry/exit mechanism requires a separate documented design and counts as a new variant under the campaign limits. The module deliberately leaves its original structural prices unchanged. It has no fees, fills, stop path, liquidity, funding, liquidation or live-trading model.

## H7: defensive spot selection features

Export: `evaluateH7Selection({asOfMs, assets})`.

`assets` contains 1–50 objects exactly `{symbol, bars}`. Symbols must be unique and match `/^[A-Z][A-Z0-9]{0,19}$/`. Every asset has exactly **201** contiguous closed daily bars, each exactly `{closeTimeMs, close}`, with a finite positive close. All assets must share the same latest endpoint, fresh by less than 86400000 milliseconds.

Compute SMA200 from closes at indices **1–200**. Eligibility is strictly `lastClose > sma200`. Realized volatility is the **population standard deviation** of the latest 30 log returns, indices **171–200**, using `log(close[i])-log(close[i-1])`; it is not annualized. The extra history does not enter that volatility window. Eligible assets rank by ascending volatility, with exact numerical ties broken by symbol in ASCII lexical order. No tolerance or adaptive parameter search is applied.

Select at most three assets, each at draft weight 0.25. These are experimental selection weights, not risk-sized position recommendations. The remainder is cash: zero selections gives 1.0, one gives 0.75, two gives 0.5, three gives 0.25. This primitive does not schedule the proposed weekly rebalance or issue rebalancing trades.

The result is `{valid, errors, executionAuthorized:false, requiresTradePlan:true, status, selection, cashWeight}`. Status is `INVALID` or `DRAFT_SELECTION`; selected entries are `{symbol, weight, realizedVolatility, sma200, lastClose}`. Invalid input always yields `selection:[]` and `cashWeight:1`.

H7 selection provides no finite target or stop, so it is **not a complete CRV-compliant Spot bot**. It remains research-only until a separately reviewed finite payoff design exists. Its relationship to the frozen LowVol family transfers neither evidence nor authorization.

## Numerical and research limits

Indicators use JavaScript floating-point arithmetic with detected nonfinite or nonpositive required values rejected. These indicators do not use the exact-decimal payoff evaluator. A fixed primitive provides no evidence that the mechanism is profitable or robust. Historical data already inspected remains inspected; these functions cannot create a new holdout. Research runs, variant registration and promotion require their own applicable controls outside this source-only packet.
