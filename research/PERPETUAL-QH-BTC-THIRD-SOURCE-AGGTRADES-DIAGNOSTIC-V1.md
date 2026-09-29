# BTCUSDT 2025-01 third-source aggTrades diagnostic V1

Status: **DIAGNOSTIC ONLY — NO DATA GATE AUTHORIZATION**

## Trigger

#350 established that official monthly and daily individual-trades packages are identical on the two BTCUSDT days that disagree with both monthly and daily 1m kline totals. The discrepancy is therefore not monthly packaging.

The remaining question is which source family diverges: individual trades or klines.

## Frozen third source

For 2025-01-14 and 2025-01-29 only, this diagnostic adds official daily `aggTrades` as an independent third source and compares minute-level base volume and derived `price*qty` quote volume against:
- official daily individual trades;
- official daily 1m klines.

For aggTrades, declared underlying trade counts from `first_trade_id..last_trade_id` are recorded only as diagnostics. Aggregate-row counts are never equated to individual-trade counts.

## Decision interpretation

- aggTrades + individual trades align, kline differs -> kline-source divergence on the affected windows;
- aggTrades + kline align, individual differs -> individual-trades divergence;
- individual + kline align, aggTrades differs -> aggTrades divergence;
- otherwise -> unresolved three-way/partial divergence.

This diagnostic cannot authorize a data protocol or strategy test. No direction, signal, return, position or PnL is calculated.
