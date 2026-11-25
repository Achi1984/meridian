# BTC and ETH one-hour failed breakout

The sample uses OKX USDT linear perpetuals, September, October and November 1–24, 2026 (UTC), split into two twelve-day blocks per month for parity with the earlier replay. October and November were previously inspected for breakout performance. September is an additional historical check. The last four hours in each block cannot initiate a signal.

At time t the preceding hourly candle has closed outside the preceding 24-hour high or low. Freeze both range boundaries. At t+1h classify the signal as a failed breakout if the next completed hourly close is back within that original range, inclusive. Use the next hourly open as modeled entry. Compare continuation and reversal at this same price, exiting both three hours later. Across all breakouts, separately compare the original direction at t versus t+1h, each with three hours of exposure.

Each outcome includes 30 bp of round-trip fees and slippage in total plus signed realized OKX funding on entry notional. Settlement precedes modeled boundary fills. Bar opens approximate fills and assume immediate availability of the closed candle. Multiple events may overlap. Attribution is per signal, without compounding. The return before confirmation helps locate the initial retracement but cannot be earned after the confirmation signal.

Run scripts/research/failed_breakout_replay.py with an output JSON path. Fields ending in Pct are percentage points of entry notional.
