# MERIDIAN FIB DCA Futures Long — v0.1

Status: research/paper/backtest only. No live-order execution.

## Strategy
- Direction: LONG perpetual futures.
- Structure timeframe: 4H confirmed swing low -> swing high.
- Multi-timeframe stack: 4H defines confirmed swing/regime; 1H is the mandatory setup confirmation; 15m times execution. Closed candles only.
- v0.2 gate: 4H and 1H must pass trend/momentum confirmation; 15m needs at least 2 confirmation points before a DCA fill.
- DCA retracements: 0.382 / 0.500 / 0.618 / 0.786.
- Capital weights: 15% / 20% / 30% / 35%.
- Baseline leverage: 3x; backtest matrix 2x/3x/4x.
- Entry at a level requires stabilization/reclaim plus momentum confirmation (RSI/MACD/EMA and price action). No blind falling-knife fills.
- Invalidate cycle when the confirmed swing low is structurally lost. No new DCA below invalidation.

## Exits
- TP1: prior swing high; close 30%, move protection toward weighted break-even.
- TP2: Fib extension 1.272; close 30%, lock profit.
- TP3: Fib extension 1.618; close remaining 40% or optional trailing runner.
- New cycle only after a newly confirmed swing.

## Backtest requirements
- Candle-by-candle event simulation; no look-ahead.
- Same-source OHLCV for indicators.
- Include taker/maker fees, configurable slippage, historical funding when available, leverage/margin and liquidation approximation.
- Conservative intrabar rule: when entry/TP/SL can all be hit in one candle and sequence is unknowable, resolve against the strategy or use lower-timeframe data.
- Train/test or walk-forward split; optimization period must not be the reporting period.
- Assets: BTC first; then ETH, SOL, AVAX; then HBAR, XRP, ADA, SUI.
- Timeframes: 4H structure, 1H/15m confirmation.

## Metrics
Net return; max drawdown; profit factor; win rate; cycle count; average weighted entry; DCA-level utilization; TP1/TP2/TP3 hit rate; stop/liquidation count; funding+fee drag; exposure time; Buy&Hold comparison.

## Data
Primary research feed: official OKX USDT-SWAP historical candles. Cross-check/fallback: official Bybit/Binance perpetual OHLCV. Reject web snippets/aggregator prices as backtest input.

## Safety gate
Paper mode is mandatory until out-of-sample results are acceptable across multiple assets/regimes. Live trading requires a separate explicit implementation and approval.
