# MERIDIAN v7.69 — Intratrade Candle-Path Drawdown

Generated: 2026-09-03T03:54:34.511Z

Research-only. Challenger V3.2 ranking remains frozen. This replay measures 15m close-to-market drawdown and a conservative adverse intrabar drawdown for the v7.68 risk finalists 0.25% and 0.50%. No Paper/runtime/UI changes.

## P0

risk_0.25: Baseline adverse DD **7.786%**, V3.2 adverse DD **4.63%**, delta **-3.156pp**; close DD delta **-3.1pp**. Trades B/V3.2 **706/720**.
risk_0.50: Baseline adverse DD **8.551%**, V3.2 adverse DD **9.167%**, delta **0.616pp**; close DD delta **0.651pp**. Trades B/V3.2 **74/720**.

## P1

risk_0.25: Baseline adverse DD **8.567%**, V3.2 adverse DD **8.107%**, delta **-0.46pp**; close DD delta **-0.585pp**. Trades B/V3.2 **505/720**.
risk_0.50: Baseline adverse DD **8.944%**, V3.2 adverse DD **8.743%**, delta **-0.201pp**; close DD delta **-0.275pp**. Trades B/V3.2 **82/355**.

## P2

risk_0.25: Baseline adverse DD **8.438%**, V3.2 adverse DD **8.031%**, delta **-0.407pp**; close DD delta **-0.39pp**. Trades B/V3.2 **266/323**.
risk_0.50: Baseline adverse DD **8.757%**, V3.2 adverse DD **8.067%**, delta **-0.69pp**; close DD delta **-0.867pp**. Trades B/V3.2 **42/55**.

## P3

risk_0.25: Baseline adverse DD **7.945%**, V3.2 adverse DD **7.748%**, delta **-0.197pp**; close DD delta **-0.272pp**. Trades B/V3.2 **658/719**.
risk_0.50: Baseline adverse DD **8.216%**, V3.2 adverse DD **8.68%**, delta **0.464pp**; close DD delta **-0.464pp**. Trades B/V3.2 **34/590**.

## Cross-period aggregate

risk_0.25: lower V3.2 close DD **4/4**, lower V3.2 adverse DD **4/4**, avg V3.2 close DD **7.129%**, avg V3.2 adverse DD **7.129%**, avg Baseline adverse DD **8.184%**.
risk_0.50: lower V3.2 close DD **3/4**, lower V3.2 adverse DD **2/4**, avg V3.2 close DD **8.557%**, avg V3.2 adverse DD **8.664%**, avg Baseline adverse DD **8.617%**.

## Guardrail

No promotion from realized-equity DD alone. Require candle-path robustness across disjoint periods before prospective shadow.
