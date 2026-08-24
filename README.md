# ACHI MERIDIAN v5.24.1 — Break-even Protection + Layout Fix

Neu:
- Break-even Protection Engine 1.0.
- LONG wird BE PROTECTED, wenn Live > BE, SL >= BE, SL < Live und SL vor der Liquidation liegt.
- SHORT spiegelbildlich: Live < BE, SL <= BE, SL > Live und SL vor der Liquidation.
- BE PROTECTED Bots lösen keinen primären CRITICAL/DANGER Capital-Loss-Block mehr aus.
- Restrisiko bleibt sichtbar: Slippage, Fees, Gap und Execution.
- BE Protection gibt niemals automatisch ADD oder neues Kapital frei.
- BTC-L100 mit SL 77,000 / BE 76,938.9 wird bei gültigem Live-Zustand als BE PROTECTED behandelt.
- BTC-S30 bleibt aktuell unprotected und mit 6.25% Pionex-Puffer der relevante Risk-Blocker.
- Zusätzlicher iPhone Layout-Fix für alle verbliebenen 3-Spalten Reality/Calibration-Kacheln.
