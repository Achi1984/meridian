# R32 — Paper learning gates

R32 turns the Challenger V3 cost phase into an explicit prospective experiment.

- Legacy V3 trades remain in the ledger but do not count toward the R31 cost-phase sample.
- The first checkpoint is 20 closed cost-aware trades.
- At 30 trades, negative expectancy with PF below 0.90 retires V3 automatically once flat.
- Borderline evidence is extended to 50 trades instead of changing parameters repeatedly.
- Positive evidence (PF at least 1.10 and positive expectancy) keeps the frozen strategy running.
- Retirement is Paper-only. There is no automatic live promotion, ledger reset, or Pionex action.

This policy can stop a demonstrably weak candidate. It cannot prove future profitability.
