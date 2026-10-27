# Meridian 11 app read access

The app-opening form validates the existing Meridian read password with a bounded `GET` to the protected portfolio-history endpoint. A successful response makes the credential available in memory to the existing manual Bot and Depot readers. Asset-Watch share credentials are not valid app credentials and remain restricted to the Bot reader.

The shared access controller clears both readers when access is explicitly locked, expires, is rejected by a reader, the page is hidden by a pagehide event, or the controller is disposed. Access expires at the absolute 15-minute deadline measured from successful verification; focus and visibility changes do not renew it. A visibility-hidden document is visually hidden while access remains valid, and each reader rechecks the deadline before using the credential.

The password and snapshots are not written to browser storage. Reader requests remain manual, bounded, and read-only. The app gate is a user-interface control, not a privacy boundary for publicly hosted source; protected server endpoints continue to enforce `MERIDIAN_READ_TOKEN_SHA256`.
