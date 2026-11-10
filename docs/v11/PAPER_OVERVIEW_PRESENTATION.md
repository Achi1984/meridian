# M11 Paper overview presentation

The existing three-bot overview keeps each bot in a collapsed disclosure card.
Its summary shows the bot and strategy, the projected state with data freshness,
net PnL, and the report's source timestamp. Missing reports stay unknown;
LowVol V2 stays prepared in its native USDT unit. A stale report is marked
stale rather than presented as current. Summary values omit detailed unknown
reasons, which remain in the expanded card.

Expanded cards group capital and results, costs and trades, risk information
where validated, and status/source details. “Alle Details öffnen” and “Alle
Details schließen” operate on the bot cards and their trade disclosures and
are native keyboard-operable buttons. Amounts remain bot-local; no currencies
are aggregated. The presentation adds no report source or runtime status.

Focused model, rendering, and Chrome layout checks:

```sh
node --test test/v11-spot-paper-bot-overview.test.js
```

The browser check exercises 320, 390, and 1280 pixel viewports using visibly
synthetic fixtures and writes preview screenshots to
`V11_SPOT_PAPER_BOT_OVERVIEW_EVIDENCE_DIR` or the system temporary directory.
