# MERIDIAN v7.102 — Stopping Rule

Status: REJECTED / RESEARCH ONLY / NO PROMOTION.

The fixed correlation-cluster allocator is closed. Do not tune its 30-day lookback, hourly sampling, signed correlation threshold `0.70`, 80% coverage requirement, `1.00` cluster budget or UNKNOWN-cluster behavior.

The experiment established that correlation-aware clustering preserves more edge than v7.101 and reduces drawdown, but still attenuates 301/419 trades and loses too much 90d expectancy. It does not resolve the negative middle chronological fold.

Do not react by dropping AVAX, selecting LONG/TRANSITION, blocking SHORT/RANGE, or adding another performance-derived gate. Any further allocator work must use a separately predeclared architecture based on marginal portfolio contribution or covariance-aware risk contribution, not a parameter variation of v7.101/v7.102.

Prospective holdouts remain authoritative future evidence. No allocator result permits automatic promotion.
