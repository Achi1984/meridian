# Cross-Sectional Low-Volatility V1 — Frozen Discovery Evidence

Status: **DISCOVERY FAIL / HOLDOUT NOT AUTHORIZED / RESEARCH LINE CLOSED**  
Ruleset: `CROSS-SECTIONAL-LOW-VOLATILITY-V1-FROZEN`  
Research only: **true**  
Execution impact: **false**  
Strategy PnL calculated: **false**

## Provenance

- Frozen implementation base merge: `852e6d43e3c55bb93c0ca9cce9392e76f4806fb1`
- Run-authorization commit: `837b86259d2683f17abd6e28b3a76a72e39e92af`
- Workflow run: **37129972221 — SUCCESS**
- Invariants job: **111222969830 — SUCCESS**
- Source job: **111222996068 — SUCCESS**
- Evaluate job: **111223027596 — SUCCESS**
- Source artifact: **11275844066**
- Source artifact ZIP digest: `sha256:639d8955d360209c4b371693de6072aaa750a744965ab653c8427bde3e183948`
- Result artifact: **11275854084**
- Result artifact ZIP digest: `sha256:572c6c79a7d32d929c84786747f54deea756b0f7b254c3cace542ed36c6a6a5f`
- Exact result JSON SHA-256: `6a6e466d49f80e0085b078902b2d26a77b5c3a11d06d9f2dc8e83b94df915e24`
- Exact result Markdown SHA-256: `b03a7c333da2ccc152ae968571c8cae8e1c062980a89291bfc274ffebe2fe0f7`
- Result JSON Git blob: `7c36feb6a7dfdd8eec7d14bd17f63759b0a2328a`
- Result Markdown Git blob: `a6130948918591515c764e056b3504cd9d8a545c`
- Source receipt digest: `6a562441822e70f7086e179beee785ff268c2c2986d5815325d1fce8302829d1`
- Source manifest SHA-256: `fdf17a414f9abd0e4a9df016a88cd35c1dfefb54000ca52f737ea11965f491bf`

## Independent source integrity

The first discovery run retained exactly:

- 12 frozen assets;
- **8,738** contiguous hourly rows per asset;
- first retained hour: **2025-01-03T23:00:00Z**;
- last retained hour: **2026-01-03T00:00:00Z**;
- 13 official monthly archives per asset;
- no funding data;
- no private data;
- no synthetic backfill;
- no row from the untouched holdout period.

Every retained asset JSON SHA-256 matched the source manifest before evaluation.

## First untouched discovery result

Decision:

`DISCOVERY_FAIL_RESEARCH_STOP`

| Frozen metric | Result |
|---|---:|
| Weeks | **48** |
| Mean weekly Rank IC | **+0.215035** |
| Median weekly Rank IC | **+0.286713** |
| Positive IC weeks | **35/48** |
| Rank IC Newey-West(4) t | **4.3375** |
| Mean Low-2 minus High-2 next-week spread | **+1.0254%** |
| Median Low-2 minus High-2 spread | **+2.7325%** |
| Positive spread weeks | **32/48** |
| Spread Newey-West(4) t | **0.9583** |
| Positive IC blocks | **4/4** |
| Positive spread blocks | **3/4** |

The rank relationship was strongly positive and cleared its frozen statistical gate. The Low-2 minus High-2 spread was positive in level and in three of four chronological blocks, but its preregistered Newey-West statistic did not clear the required threshold:

`0.9583 < 1.645`

Frozen gate failure:

- `SPREAD_NW_T_LT_1_645`

## Research consequence

Per the preregistration, this V1 line is closed without retuning.

Not authorized:

- untouched holdout evaluation;
- changing the 28-day lookback;
- changing basket size;
- changing the Newey-West lag or threshold;
- removing assets or selecting favorable subperiods;
- changing the discovery dates;
- converting the positive rank relation into a strategy under the V1 name;
- strategy PnL;
- Paper bots;
- live trading.

The positive Rank IC may be retained only as frozen descriptive evidence for designing a separately named, independently preregistered future hypothesis. It cannot be used to rescue V1.
