# R30: actual trade risk visibility

Protected status responses already provide entry, stop, quantity, realized PnL and entry/exit fees. The UI now retains these fields in its last-five-trade model and shows stop risk = abs(entry - recorded initial stop) × quantity, net R and gross R before fees. Absent values remain unknown. For the currently supported fixed-stop Paper engines the recorded stop is unchanged; future trailing implementations must persist initialSl.

The stop-risk amount excludes fees and slippage beyond the recorded entry. Gross R excludes explicit fees but still includes execution-price effects. Neither number alone identifies delay versus market movement. Exact attribution still requires contemporaneous quotes and timestamps.

Open V3 positions show asset, side, entry, stop, risk, last marked unrealized PnL and opening time. V2 is labelled PAUSIERT in performance details when locked or when its successor exists. Full and reduced V3 risk are named separately.

No extra API requests or strategy/execution changes. R29 remains a separate research draft; it is not included in this release. The -32 USD losses shown by the user have not been individually re-audited without authenticated raw inputs.
