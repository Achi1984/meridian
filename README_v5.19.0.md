# ACHI MERIDIAN v5.19.0 — NET EXPOSURE + HEDGE ENGINE 1.0

- BTC-S30 wird bei vorhandenem BTC-Long als Hedge-Leg erkannt.
- Hedge Value und Liquidation Health sind getrennte Entscheidungen.
- Neue Kennzahlen: Gross Long Proxy, Short Hedge, Net Long Proxy, Hedge Ratio, Hedge Survivability.
- Kritischer BTC-S30 wird nicht mehr pauschal als EXIT behandelt: KEEP HEDGE · BUFFER CRITICAL.
- Margin Release bleibt bei kritischem Survivability-Puffer blockiert.
- Bestehendes Global Risk Gate bleibt unverändert übergeordnet.

Hinweis: Exposure Proxy = Spotwert + Investment × Hebel. Das ist kein exaktes Delta und keine automatische Orderfreigabe.
