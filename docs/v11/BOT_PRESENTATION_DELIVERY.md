# B11 bot presentation delivery

The collapsed card leads with symbol, direction/leverage badges and signed P/L.
Capital is secondary; USD amounts use German two-decimal formatting, with an
explicit signed `<0,01` for nonzero values below one cent. Existing USD/USDT
capital units remain unchanged. Native Details disclosures expose the technical
reference and original numeric precision. Source values, sort inputs, snapshot
count semantics, and read-only behavior are unchanged.

## Synthetic visual comparison

Before and after images use the same six-bot synthetic fixture, including
duplicate BTC symbols, negative P/L, missing and zero-as-unconfirmed P/L, and a
tiny nonzero P/L. The refreshed after images show the card list; the original
before images are unchanged.

| Viewport | Before | After |
| --- | --- | --- |
| 320×568 | [before](evidence/b11-bots-presentation/before-320x568.png) | [after](evidence/b11-bots-presentation/after-320x568.png) |
| 390×844 | [before](evidence/b11-bots-presentation/before-390x844.png) | [after](evidence/b11-bots-presentation/after-390x844.png) |

[After at 320×568 with enlarged text](evidence/b11-bots-presentation/after-320x568-enlarged-text.png)

At 320px, Command rows stack the identity, signed P/L, and native Details
disclosure. The identity remains on one rendered line at normal and 1.35×
descendant text sizes; the 390px contract-type filter gives the full selected
“Alle Kontraktarten” option its own grid row.

The 1.35× browser check scales computed font sizes only on descendants of the
Bot cards and Command overview; it does not enlarge the whole page or global
text. Generated 20-bot snapshots at 320px and 390px confirmed that the labeled
filters and refresh/lock controls remain before and reachable ahead of the card
list, with no horizontal overflow and keyboard jump/return preserving selection.

## Command overview

Command now shows compact rows with symbol/direction and signed two-decimal P/L;
the reference and source-precision value are in each row's native disclosure.
Snapshot time is localized German date/time with an explicit UTC suffix; the
exact source timestamp and source/direction breakdown are in “Quelle & Zeit”.
Unknown fresh metadata remains explicitly “Unbekannt”, distinct from locked,
stale, and unavailable states. Search, filters, reset, and refresh/lock controls
precede the card list, so they remain reachable with large snapshots.
No authentication/depot lifecycle, backend, or network-read changes were made.
The coordinated presentation release advances the local M11 cache identity to
`B15-M11` across all four entrypoints and the reachable 22-module graph; the
preview remains a draft.

| Viewport | Command capture |
| --- | --- |
| 320×568 | [synthetic Command](evidence/b11-bots-presentation/command-320x568.png) |
| 390×844 | [synthetic Command](evidence/b11-bots-presentation/command-390x844.png) |

[Command at 320×568 with 1.35× text](evidence/b11-bots-presentation/command-320x568-enlarged-text.png)

For the fixture's three negative-P/L Command rows, heights measured 121px at
320px width, 46–61px at 375px, and 46px at 390px, 430px, and 1440px. At 320px,
identity text occupied 244px and one line. With 1.35× descendant text, rows
grew naturally to 134.63px; identity remained one line and Details stayed below
the jump button without overlap or horizontal overflow. Row controls remained
at least 44px tall.

Actual-shell Chromium checks passed at 320×568, 375×667, 390×844, 430×932
and 1440×900. The largest collapsed card measured 148.39px at 320px width;
maximums at 375px, 390px and 430px were 117.28px, and all cards measured
110.64px at 1440px. Enlarged text grew naturally without overlap, clipping or
horizontal overflow. Visible filter/action controls and disclosures meet the
44px touch-target minimum. The run covered keyboard Command jump/return,
same-snapshot disclosure persistence, filters without extra reads, and clearing
on new, locked, stale and error states.

Focused validation commands and totals:

- `node --test test/v11-bot-read-view.test.js` — 33 tests passed.
- `CHROME_BIN=/usr/bin/chromium V11_B11_EVIDENCE_DIR=/tmp/m11-visual-evidence node --experimental-websocket test/v11-b11-bot-cockpit-chrome.test.js`
  — 1 actual-shell Chromium test passed, including five standard viewports and
  generated 20-bot runs at 320px and 390px.
- `node --experimental-websocket test/v11-terminal-entry.test.js` — 3 tests passed, including
  five viewport runs and exact reversible source-delta checks.

All screenshots and browser data are synthetic. These checks do not establish
real-account behavior, physical-device/browser coverage, deployment, activation,
or operational readiness.
