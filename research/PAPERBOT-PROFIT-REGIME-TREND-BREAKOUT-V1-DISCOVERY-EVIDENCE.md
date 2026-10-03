# Regime-Gated Trend / Breakout V1 — Frozen Discovery Evidence

Status: **DISCOVERY PASS / HOLDOUT UNTOUCHED**  
Ruleset: `PAPER-PROFIT-REGIME-TREND-BREAKOUT-V1`  
Execution impact: **false**  
Auto-promotion: **false**

## Provenance

- Implementation merge commit: `b45e021ec29d4c53b9878dd74ccad84482fdf3be`
- Implementation PR: **#461**
- Run-authorization commit: `df689266b113d4a2fda7c5c4c405f738fb77990d`
- Workflow run: **37102449505 — SUCCESS**
- Source artifact: **11266308720**
- Source artifact digest: `sha256:51e84ed6eb02fd8ebbb49351d5c4e1ad59555b69f571f807a6d021f6f0473b06`
- Result artifact: **11266752800**
- Result artifact digest: `sha256:b2ff28a23a42dc5166b9a21a3c58cfc3d74adaec5078ca57d2887f05ac77cc41`
- Exact source JSON SHA-256: `08fb30cd3c9028920637c71d86035a723be2fdc63ee25607b842dc79211cc69b`
- Source JSON SHA was independently rechecked against the downloaded source artifact and matched exactly.

## Frozen source coverage

Fixed source request:
- 2021-08-08T00:00:00.000Z through 2026-09-30T23:59:59.999Z
- Binance Spot public completed 1D klines
- no private/account data
- no synthetic history

Rows:
- BTC / ETH / SOL / XRP / HBAR / LINK / AVAX: **1,880** each
- SUI: **1,247**, first common date 2023-05-03

Common timestamps:
- total: **1,247**
- Discovery: **872**
- frozen Holdout: **375**
- Discovery: 2023-05-03 through 2025-09-20
- Holdout starts: 2025-09-21

## First untouched Discovery result

Decision:

`REGIME_TREND_BREAKOUT_V1_DISCOVERY_PASS_HOLDOUT_REQUIRED`

| Gate input | Frozen result |
|---|---:|
| Evaluation periods | 872 |
| Net compounded return, 8 bps | **+22.8742%** |
| PnL on 10,000 start equity | **+2,287.42** |
| Profit Factor | **1.16854** |
| Max drawdown | **6.8196%** |
| Positive chronological windows | **4/5** |
| Positive assets | **6/8** |
| Positive-PnL concentration | **21.1647%** |
| 16-bps stress compounded return | **+21.5729%** |
| Turnover notional | 147,101.27 |
| Maximum gross exposure | 0.26676x |

Every frozen Stage-B Discovery gate passed.

## Holdout integrity

The result artifact records:

`"holdout": null`

No Holdout return or PnL was evaluated in run 37102449505. This Discovery pass does **not** authorize Paper or live trading. It authorizes only a separately reviewed and separately authorized Holdout evaluation using the already frozen rules and 2025-09-21 through 2026-09-30 Holdout interval.

No parameter, threshold, universe, source window, cost assumption or sizing rule may be changed before Holdout inspection.
