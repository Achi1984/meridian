# MERIDIAN v7.68 — Portfolio Risk Sensitivity

Generated: 2026-09-02T19:42:33.622Z

Research-only. Challenger V3.2 score and ranking are frozen. Only risk per trade changes: 0.25%, 0.50%, 0.75%, 1.00%. Portfolio gates remain identical to v7.67. A separate diagnostic run uses 1.00% risk but disables only the 8% max-drawdown shutdown. No Paper/runtime/UI changes.

## P0

Risk 0.25% — V3.2: trades **723**, AvgR **0.059**, PF **1.105**, end equity **11075.71**, realized DD **4.2%**. Baseline DD **7.43%**.
Risk 0.50% — V3.2: trades **723**, AvgR **0.059**, PF **1.105**, end equity **12161.81**, realized DD **8.39%**. Baseline DD **8.55%**.
Risk 0.75% — V3.2: trades **41**, AvgR **-0.005**, PF **0.992**, end equity **9958.92**, realized DD **9.12%**. Baseline DD **8.58%**.
Risk 1.00% — V3.2: trades **30**, AvgR **0.12**, PF **1.225**, end equity **10324.38**, realized DD **8.55%**. Baseline DD **8.58%**.
Diagnostic 1.00% / no max-DD stop: V3.2 trades **638**, AvgR **0.046**, PF **1.081**, end equity **12578.8**.

## P1

Risk 0.25% — V3.2: trades **723**, AvgR **0.056**, PF **1.099**, end equity **11002.99**, realized DD **8.03%**. Baseline DD **8.32%**.
Risk 0.50% — V3.2: trades **358**, AvgR **0.14**, PF **1.266**, end equity **12706.17**, realized DD **8.56%**. Baseline DD **8.68%**.
Risk 0.75% — V3.2: trades **77**, AvgR **0.06**, PF **1.107**, end equity **10295.32**, realized DD **9.78%**. Baseline DD **8.42%**.
Risk 1.00% — V3.2: trades **61**, AvgR **0.023**, PF **1.04**, end equity **10070.08**, realized DD **8.47%**. Baseline DD **8.36%**.
Diagnostic 1.00% / no max-DD stop: V3.2 trades **631**, AvgR **0.061**, PF **1.11**, end equity **13759.77**.

## P2

Risk 0.25% — V3.2: trades **358**, AvgR **-0.075**, PF **0.878**, end equity **9328.86**, realized DD **8.5%**. Baseline DD **8.21%**.
Risk 0.50% — V3.2: trades **74**, AvgR **-0.124**, PF **0.804**, end equity **9534.06**, realized DD **8.39%**. Baseline DD **8.69%**.
Risk 0.75% — V3.2: trades **55**, AvgR **-0.084**, PF **0.865**, end equity **9637.6**, realized DD **8.97%**. Baseline DD **9.26%**.
Risk 1.00% — V3.2: trades **47**, AvgR **-0.03**, PF **0.95**, end equity **9823.14**, realized DD **9.08%**. Baseline DD **9.48%**.
Diagnostic 1.00% / no max-DD stop: V3.2 trades **627**, AvgR **0.018**, PF **1.032**, end equity **10426.46**.

## P3

Risk 0.25% — V3.2: trades **721**, AvgR **0.082**, PF **1.149**, end equity **11532.37**, realized DD **7.7%**. Baseline DD **7.78%**.
Risk 0.50% — V3.2: trades **593**, AvgR **0.073**, PF **1.131**, end equity **12213.27**, realized DD **8.11%**. Baseline DD **8.29%**.
Risk 0.75% — V3.2: trades **26**, AvgR **-0.262**, PF **0.622**, end equity **9487.02**, realized DD **9.11%**. Baseline DD **8.45%**.
Risk 1.00% — V3.2: trades **63**, AvgR **-0.048**, PF **0.921**, end equity **9643.58**, realized DD **8.9%**. Baseline DD **8.41%**.
Diagnostic 1.00% / no max-DD stop: V3.2 trades **606**, AvgR **0.069**, PF **1.125**, end equity **14232.5**.

## Cross-period aggregate

risk_0.25: V3.2 positive AvgR **3/4**, PF>1 **3/4**, better AvgR than Baseline **3/4**, lower realized DD **3/4**, avg end equity **10734.98**, avg realized DD **7.11%**.
risk_0.50: V3.2 positive AvgR **3/4**, PF>1 **3/4**, better AvgR than Baseline **4/4**, lower realized DD **4/4**, avg end equity **11653.83**, avg realized DD **8.36%**.
risk_0.75: V3.2 positive AvgR **1/4**, PF>1 **1/4**, better AvgR than Baseline **3/4**, lower realized DD **1/4**, avg end equity **9844.72**, avg realized DD **9.24%**.
risk_1.00: V3.2 positive AvgR **2/4**, PF>1 **2/4**, better AvgR than Baseline **4/4**, lower realized DD **2/4**, avg end equity **9965.3**, avg realized DD **8.75%**.

No-DD diagnostic: positive AvgR **4/4**, PF>1 **4/4**, avg end equity **12749.38**.

## Guardrail

Do not alter V3.2 weights from this test. This step diagnoses portfolio risk sensitivity only. Intratrade mark-to-market drawdown still requires the planned v7.69 candle-path replay before any Shadow promotion.
