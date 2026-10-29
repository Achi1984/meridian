# Meridian 11 app read access

The app-opening form validates the existing Meridian read password with a bounded `GET` to the protected portfolio-history endpoint. The server decides whether a bearer value is valid, including values that happen to have the same shape as a share token. A successful response makes the credential available in memory to the existing manual Bot and Depot readers. The app has no Asset-Watch share login UI; the separate gateway/client share capability remains restricted to its Bot endpoint and cannot unlock the app or Depot.

The shared access controller clears both readers when access is explicitly locked, expires, is rejected by a reader, the page is hidden by a pagehide event, or the controller is disposed. Access expires at the absolute 15-minute deadline measured from successful verification; focus and visibility changes do not renew it. Before private content is shown on foreground, focus, or pageshow, both readers synchronously reproject cached data against source freshness without fetching. A visibility-hidden document is visually hidden while access remains valid, and each reader rechecks the deadline before using the credential.

The password and snapshots are not written to browser storage. Reader requests remain manual, bounded, and read-only. The app gate is a user-interface control, not a privacy boundary for publicly hosted source; protected server endpoints continue to enforce `MERIDIAN_READ_TOKEN_SHA256`.

The local M11 entrypoints and their shared module graph use the cache-only `?v=B16-M11` identity so browsers cannot reuse the prior B15 module graph. The B16 preview remains a draft; the cache identity is not a publication or activation claim.
