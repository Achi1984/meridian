# Trial4 recovery evidence proposal — offline only

This standalone preparation package validates the preserved output of Trial4. The validator performs no network operation, model call, credential handling or publication. The package adds no recovery workflow or publication authority; it includes an unmodified historical helper whose live phases must not be invoked. It does not diagnose the actual publisher failure. The original `stage=initial` receipt cannot distinguish key transport, module loading and several pre-publication checks.

From this directory, run the self-contained offline tests:

```sh
python3 -I test_original_packet.py
```

To inspect a separately supplied, decoded original ZIP:

```sh
python3 -I validate_original_packet.py /path/to/original-packet.zip
```

The CLI does not download or extract files. It reads the ZIP in memory, verifies its exact size and SHA-256, checks the helper SHA-256 before executing its inert module definitions, then applies the original packet/ledger contract. No code from the artifact is executed. `original-pilot.py` is an exact historical verification dependency; do not invoke its claim, generate or publish phases.

`original-packet.zip.b64` preserves the original 1,208-byte ZIP as a text fixture. Tests decode it in memory. The report contains only fixed identifiers, file hashes/sizes and verification status; it always states `publication_authorized=false` and `live_state_verified=false`. It neither creates a recovery claim nor modifies the original evidence.

Pinned provenance:

| Item | Value |
| --- | --- |
| Artifact | `11705462075` |
| ZIP SHA-256 | `1331957db426ec31a4c478144bd60e84708ede0090aae160b4ea2b04351f7dd8` |
| Original control run / attempt | `38147058996` / `1` |
| Original base | `294ee068149f2faeae287c633d7ec2f19259802d` |
| Original claim | `4e404f06e4c89786775e261397e0b941c5c5d4b3` |
| Helper source commit | `a34163015220d688c14cba044713ddc9684cab44` |
| Helper SHA-256 | `4786e18ec611a22a9c6cebb476cb6910d7f5812c7240c64432b50916e05b16df` |
| Original deadline | 2026-10-11 15:00 UTC / 17:00 Europe/Vienna (`1791730800`) |

The original deadline is not extended. Content validation can succeed after expiry, but never authorizes publication. A future live recovery needs a separately reviewed execution identity, durable one-shot claim, live-state reconciliation and explicit authorization; it must not spoof the original control attempt, reset its claim, rewrite provenance or silently rebind the base. This package introduces none of those mechanisms.

Tests cover the original artifact, changed archive size/digest, changed helper before execution, altered provenance and boolean/integer confusion, changed claim/milestones, injected executable text, extra paths, invalid ledger evidence and expiry reporting. They provide offline evidence only.
