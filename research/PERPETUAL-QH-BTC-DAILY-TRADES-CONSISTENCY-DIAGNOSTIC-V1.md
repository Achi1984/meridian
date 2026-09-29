# BTCUSDT 2025-01 daily individual-trades source-consistency diagnostic V1

Status: **DIAGNOSTIC ONLY — NO DATA GATE AUTHORIZATION**  
Execution impact: **false**

## Trigger

#348 verified all 31 official daily 1m kline archives against the official monthly 1m kline archive. Twenty-nine days reconcile with the monthly individual-trades archive. Only **2025-01-14** and **2025-01-29** differ, while monthly and daily 1m klines agree exactly on those days.

Observed monthly-trades excess versus both kline forms:
- 2025-01-14: +49,228 trades, +3,476.307 BTC base volume, +336,899,306.6193 USDT derived quote volume;
- 2025-01-29: +22,787 trades, +1,119.317 BTC base volume, +113,730,085.2595 USDT derived quote volume.

This is too large to be explained by the sparse malformed raw `quoteQty` rows.

## Frozen diagnostic

For exactly those two days:
- verify official CHECKSUMs for the monthly individual-trades archive;
- verify CHECKSUMs for the official **daily individual-trades** archives;
- verify CHECKSUMs for the official daily 1m kline archives;
- extract the two target days from the monthly trade archive;
- aggregate monthly trades, daily trades and klines minute-by-minute;
- compare count, base volume and derived `price*qty` quote volume;
- report only the minutes that diverge.

Trade direction is not used. Raw `quoteQty` anomalies are counted but cannot be repaired or normalized by this protocol.

## Interpretation

If daily individual trades reconcile minute-by-minute with daily klines while the monthly trade package differs, the anomaly is isolated to the monthly individual-trades package for those days. A later separately frozen data protocol may then consider composing the corpus from official **daily** individual-trades archives, but only after an availability/size and quality audit across the fixed universe/window.

If daily trades also disagree with klines, no source promotion is allowed; the mismatch requires a deeper source-semantics audit.

No signal, forward return, position, PnL, Paper promotion or live action is authorized.
