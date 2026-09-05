# MERIDIAN v8 Clean Production Cutover

This document records the controlled cutover plan after successful R8 iPhone validation.

- Current clean preview: `/v8-clean/`
- Production root target: redirect root entry to `/v8-clean/`
- Pre-cutover rollback commit: `bdfc64f8cf588d5b4c3d6a3f4daebf019b8e7749`
- Rollback branch will be created before root-entry change.
- Baseline `6.2.0 / 6.2-SIGNAL-V1` remains frozen.
- Paper/live execution unchanged; live trading remains disabled.
- `server.js` untouched.
