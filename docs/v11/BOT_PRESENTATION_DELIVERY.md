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

The current successor’s actual-shell Chromium run passes at 320×568, 355×700,
375×667, 390×844, 430×932, and 1440×900. The responsive Bot summary stacks
between 351px and 390px; collapsed card heights measure 155.53–169.53px at
320px, 199.53px at 355/375/390px, 110.64–117.28px at 430px, and 110.64px at
1440px. There is no arbitrary card-height limit.

At 320, 355, and 390px, the browser test scales each computed descendant font
size in Bot cards and Command to exactly 1.35×. All six cards at each width keep
their P/L label and full amount on one line; “Nicht verfügbar” stays whole.
Nested text ranges are nonempty and contained in the card, including at least
five P/L words per card across 306 Bot descendants. The Bot range checks find no
clipping or horizontal overflow; maximum card heights are 215.91px at 320px and
239.61px at 355/390px.
Command rows remain 134.62px at all three widths, with one-line identities
(244px, 267px, and 302px wide respectively), no overlap/overflow, and controls
at least 44px tall. Thus both Bot and Command enlarged-text behavior is checked
at 320/355/390; only the 320px enlarged viewports are in the screenshot allowlist.

Actual sibling geometry checks run for the six-card fixture at each actual-shell
viewport: identity and P/L, heading and badges, P/L label and amount, capital
label and amount, and top/capital/disclosure pairs must be same-parent siblings,
nonintersecting, and vertically ordered. The selected “Alle Kontraktarten” fit
is measured and asserted in the actual visible control at 355, 375, 390, and
430px: widths are 289, 309, 324, and 364px versus 127.18px of option text.
These filter measurements are test evidence; the card-only screenshots do not
show the filter control. Generated 20-bot snapshots at 320 and 390px also assert
filters/actions remain visible before the first card without clipping/overflow;
keyboard jump/return retains selection without an extra read.

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

For the fixture's three negative-P/L Command rows, normal row heights are 121px
at 320/355/375/390px, then 46px at 430/1440px. Identities remain one line at
normal size. At 1.35×, each row measures 134.62px at 320/355/390px; identities
remain one line at 244/267/302px respectively. The checks assert no row overlap
or horizontal overflow and controls at least 44px tall; at 320px Details stays
below its jump button.

The six refreshed after/Command captures are `after-320x568.png`,
`after-390x844.png`, `after-320x568-enlarged-text.png`, `command-320x568.png`,
`command-390x844.png`, and `command-320x568-enlarged-text.png`. The two before
captures are immutable: `before-320x568.png` SHA-256
`10b24729049add401fd22e438d59e7a33031fe0aabc0d8afbf091b659b93633b` and
`before-390x844.png` SHA-256
`6d1f8140eac36e79b1a79384be28e2bf6c75b65e6f250a6adc20acd472d4b71e`.

Focused validation commands and totals:

- `node --test test/v11-bot-read-view.test.js test/v11-module-cache-identity.test.js test/v11-shell-safety.test.js test/v11-autonomy-status.test.js test/v11-version-history.test.js` — 43 tests passed.
- `V11_B11_EVIDENCE_DIR=/home/runner/work/meridian/meridian/docs/v11/evidence/b11-bots-presentation node --test test/v11-b11-bot-cockpit-chrome.test.js` — 1 actual-shell Chromium test passed; six viewports, 1.35× at 320/355/390, and generated 20-bot runs at 320/390.
- `node --test test/v11-bot-read-view-chrome.test.js` — 1 Chrome test passed at 320/375/390/430.
- `node --test test/v11-shell-chrome.test.js` — 1 Chrome test passed at 320/375/390/430.
- `node --test test/v11-terminal-entry.test.js` — 3 tests passed, including five viewport runs and exact reversible source-delta checks.

These focused suites total 49 passing tests. `node --check` on the changed Bot
view and browser/terminal tests, checkpoint JSON validation, and `git diff
--check` passed. Secret scanning found no secrets; CodeQL JavaScript analysis
reported zero alerts. Hosted full Safety CI and independent full Claude/source
plus actual-image review remain pending with Lead.

All screenshots and browser data are synthetic. These checks do not establish
real-account behavior, physical-device/browser coverage, deployment, activation,
or operational readiness.
