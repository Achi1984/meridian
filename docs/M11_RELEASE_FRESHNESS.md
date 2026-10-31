# M11 release freshness

Owner request, 2026-10-31: automatically refresh the app version when opening or returning to its tab. Observed trigger: an existing Cloud Browser tab still executed FIX5 after FIX9 had deployed. Reload fetched FIX9 but cleared the deliberately memory-only access.

## Behavior

- On initial visible load, pageshow, focus or return to visible, check the public `v11/index.html` with no-store, credentials omitted and no referrer. One in-flight check, at most one attempt per minute of lifecycle activity; no recurring polling timer.
- Read the five existing module-entry URLs as the release identity. All five must be recognized, unique, local and on the same supported B/FIX release. No second manifest or frozen V10 version change. Responses are bounded to 128 KiB and a five-second deadline. Failures leave the loaded page usable.
- A strictly newer coherent identity triggers automatic replacement only while the app is locked, no password has been entered and no verification is running. A public `m11build` URL marker prevents automatic reload loops if the CDN returns stale HTML again. Older responses never cause downgrades.
- During an unlocked session, password entry or verification, display “Neue Meridian-Version verfügbar” and an explicit “Jetzt aktualisieren” action. Reload clears memory-only access and current unsaved UI state; the notice states that the app will lock. No credential persistence or session extension is introduced.
- The verifier's intermediate locked notification cannot trigger navigation: automatic reconsideration happens only after a completed public check or lifecycle return, not from access-state callbacks.

## Boundaries and rollout

This refreshes software, not private account data. Bot/Depot reads remain manual. No provider, workflow, backend, scheduler, service worker or authorization changes. The five served entries and all local imports use FIX10; historical snapshot assertions remain pinned.

Already-open FIX9 or older tabs do not contain this checker. They need one ordinary reload to acquire FIX10; subsequent supported releases are detected automatically. This cannot remotely execute new behavior in an old already-loaded document. Public release checks can be unavailable offline, and unsupported future identity formats safely require manual reload. Real iPhone Safari acceptance is separate from synthetic hosted Chrome tests.

## Validation

Focused release tests cover coherent/partial identities, equal/older/newer releases, privacy options and public-only path, safe/unsafe reload, loop marker, throttle/in-flight deduplication, hidden-tab lifecycle, timeout/late completion, failed/oversized/non-HTML bodies, disposal, typed password and the verification intermediate state. Existing module-graph, static shell, terminal CSP and historical restoration checks remain applicable. Full exact-head CI and independent review are required before Lead merge; this document does not claim deployment or live acceptance.
