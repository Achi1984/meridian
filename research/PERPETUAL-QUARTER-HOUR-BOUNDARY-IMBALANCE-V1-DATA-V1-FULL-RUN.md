# Quarter-Hour Boundary Imbalance V1 — Full Data V1 Run Authorization

Status: **AUTHORIZED AFTER GREEN CANARIES**  
Authorization scope: **strategy-neutral full data-quality audit only**  
Signal/PnL authorization: **false**

## Canary workflow

Workflow run: **36613126749**  
PR: **#333**

Parser invariant tests: **PASS**

### BTCUSDT / 2025-01

Result: **DATA_V1_SHARD_PASS**

- aggTrades archive SHA-256: `9a4dedaeb6e2ac6896856781a659e5508debcd5071558c501b648cb39a123eaa`
- aggTrades compressed bytes: **692,363,439**
- aggregate-trade rows: **55,419,154**
- timestamp unit: **MILLISECOND**
- quarter-hour bins: **2,976 / 2,976**
- empty quarter-hour bins: **0**
- 1m klines: **44,640 / 44,640**
- kline timestamp unit: **MILLISECOND**
- funding rows: **93**
- maximum funding inter-event gap: approximately **8.000003 h**
- raw archives retained: **false**
- directional imbalance calculated: **false**
- forward returns calculated: **false**
- positions calculated: **false**
- strategy PnL calculated: **false**

Artifact:
- ID **11054880472**
- digest `sha256:7bdd64dfcf4120670fcfc48fa65401f2ca37d3c95bfe21bd5c1213bef11bb5c6`

### ADAUSDT / 2026-08

Result: **DATA_V1_SHARD_PASS**

- aggTrades archive SHA-256: `6bfa898622f06208e8223afdf346552a2fcb3729a1d80a9955f81a64b950d213`
- aggTrades compressed bytes: **43,741,472**
- aggregate-trade rows: **2,990,194**
- timestamp unit: **MILLISECOND**
- quarter-hour bins: **2,976 / 2,976**
- empty quarter-hour bins: **0**
- 1m klines: **44,640 / 44,640**
- kline timestamp unit: **MILLISECOND**
- funding rows: **93**
- maximum funding inter-event gap: approximately **8.000004 h**
- raw archives retained: **false**
- directional imbalance calculated: **false**
- forward returns calculated: **false**
- positions calculated: **false**
- strategy PnL calculated: **false**

Artifact:
- ID **11054201859**
- digest `sha256:7b31786c1ab9432c4e2fa0220c8265d61bef1141f7ebed32a27821be834b0d60`

## Integration gates at canary head

At PR head `023534ce59ff747cfd5aa43bacab99d9a21a2120`:

- MERIDIAN Agent Orchestration Safety: **PASS**
- MERIDIAN Release Safety: **PASS**
- MERIDIAN Quarter-Hour Imbalance V1 Data V0: **PASS**
- MERIDIAN Quarter-Hour Imbalance V1 Data V1 canaries: **PASS**

No production/trading runtime file is changed by this research branch.

## Authorized full run

The full **120 asset-month shard** Data V1 quality audit is authorized using the already-frozen code and gates.

Fixed scope:
- BTCUSDT, ETHUSDT, XRPUSDT, SOLUSDT, DOGEUSDT, ADAUSDT
- 2025-01 through 2026-08
- official Binance USD-M monthly aggTrades, 1m klines and fundingRate
- maximum six concurrent shards

The run may calculate **data-quality and coverage metadata only**.

It must not calculate:
- directional order imbalance;
- forward returns;
- signal/return relationships;
- positions;
- strategy PnL.

A full-run PASS authorizes only later strategy preregistration.
