# Quarter-Hour Boundary Imbalance — Individual Trades Data V1.2 Full-Run Authorization

Status: **AUTHORIZED AFTER FROZEN CANARIES**  
Authorization scope: **strategy-neutral 120-shard data-quality audit only**  
Signal / forward-return / position / PnL authorization: **false**

## Frozen protocol head before authorization

PR: **#353**  
Protocol head: `6120c51aff9eeeacbdfaf87f94033ff80079f2e5`

No protocol, parser, threshold, gate, strategy, Paper or execution file was changed after the five canary results were observed.

## Canary and invariant gate

Workflow run: **36629831568**  
Release Safety: **36629831513 — PASS**

Required invariant job:
- parser invariants: **PASS**

Required frozen canaries:
- BTCUSDT / 2025-01 / known fixture: **PASS**
- SOLUSDT / 2025-07 / known fixture: **PASS**
- ETHUSDT / 2025-11 / independent canary: **PASS**
- XRPUSDT / 2026-02 / independent canary: **PASS**
- DOGEUSDT / 2026-05 / independent canary: **PASS**

Canary artifacts:
- BTCUSDT/2025-01: artifact `11061472839`, digest `sha256:ae5b3449b3cba863f1bf0fdb6cf75f026548c0d997a94bc554381df014d40cbf`
- SOLUSDT/2025-07: artifact `11062367361`, digest `sha256:cacf1a62158eed587f1cdca9c92d818b456a867b06b56ec9335f7c5699786637`
- ETHUSDT/2025-11: artifact `11061474963`, digest `sha256:2a185c15797038a40fc2551aa7795a68128fb466edad7ff856bf7aeffc6d1482`
- XRPUSDT/2026-02: artifact `11062686735`, digest `sha256:bc78e5bd67e64054952fa22801b8568fc756a287d25a20c4ebf1b64cbd7004e4`
- DOGEUSDT/2026-05: artifact `11062217190`, digest `sha256:bfec0c97d4b196b441e9e43050d6758cf42abc9cd3b66e12f9204475a58cddba`

## Authorized full run

The already-frozen Data V1.2 code is authorized for the fixed **120 asset-month shard** audit:

- BTCUSDT, ETHUSDT, XRPUSDT, SOLUSDT, DOGEUSDT, ADAUSDT
- 2025-01 through 2026-08
- official Binance USD-M individual trades as primary event stream
- official 1m klines as structural cadence / diagnostic cross-source evidence
- official funding-rate source for funding coverage
- maximum six concurrent shards
- raw archives deleted after compact quality evidence is written

Hard gates remain exactly those frozen before canary execution:
- published checksum verification;
- schema/numeric validation;
- strictly increasing unique individual trade IDs;
- monotone millisecond timestamps inside the target month;
- complete quarter-hour primary trade-stream coverage;
- complete 1m kline cadence;
- funding coverage / gap limits.

Diagnostic-only fields remain diagnostic-only:
- raw source `quoteQty` consistency;
- numeric trade-ID gaps;
- first-10-second activity coverage;
- exact kline count/base/quote reconciliation.

No post-result tolerance or threshold may be introduced.

## Forbidden calculations

The full run must not calculate:
- directional order imbalance;
- forward returns;
- signal/return relationships;
- positions;
- strategy PnL;
- Paper promotion;
- live execution.

## Decision rule

Only **120/120 PASS** may advance to a separately preregistered strategy-stage protocol.

Any shard failure freezes Data V1.2 as FAIL. The failed condition must be diagnosed separately; V1.2 itself must not be edited to rescue the observed result.
