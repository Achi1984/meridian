# Proposed manual publisher key transport diagnostic

This proposal contains one manually dispatched workflow, restricted to the Meridian repository, `main`, actor `Achi1984` and run attempt 1. Publishing the proposal as a Draft PR does not activate it. Do not dispatch before the exact workflow has passed review and required CI and has been merged under the owner's bounded diagnostic authorization. This workflow does not recover or publish the original packet.

On 2026-10-11 at 16:57:52 Europe/Vienna, the owner explicitly extended the separate diagnosis/recovery authorization through 18:00 Europe/Vienna (16:00 UTC; `1791734400`). This proposal uses that fixed diagnostic deadline. The step removes the secret from Python's environment immediately; if expired, it drops the local reference without validation, emits only `WINDOW_EXPIRED` and exits. No automatic extension exists.

Before a bounded dispatch, verify the reviewed workflow head, successful required CI, main-only condition and effective protected environment branch/reviewer rules. The whole job uses the existing `meridian-draft-publisher` owner approval gate. A new manual dispatch is not a durable one-shot claim; repeat dispatches need separately reconciled authorization. Workflow reruns are rejected by the attempt-1 guard. The time extension permits no new model invocation, additional spending or bypass.

The inline Python code removes the existing environment secret, checks the fixed deadline, then applies the same bounded ASCII/PEM/base64 transport criteria as the publisher runner's `private_key()` function. Within the window it emits only one fixed status: `ACCEPTED_TRANSPORT_ONLY` or `REJECTED`. It emits no key, key length, exception text, fingerprint or parsed contents. It creates no files and invokes no subprocess, model, network, token mint or Draft POST. The workflow grants no GitHub token permissions, checks out no code and uses no third-party action.

This checks transport syntax only. Even non-key synthetic bytes can satisfy it; success does not establish that the key is usable RSA, belongs to the App, or can authenticate. It also does not test publisher helper imports, identity checks, claim, artifact, ledger or publication. The actual Trial4 startup failure remains unknown until new evidence distinguishes those boundaries. The diagnostic must not be presented as a complete root-cause test.

Removing the environment entry does not scrub process memory, the original process environment, the runner's copy or the surrounding trusted runner. The key must remain confined to this protected step. Test fixtures are synthetic and never use a real private key.

Offline tests extract and execute the exact workflow inline Python, cover accepted and rejected transport fixtures and expiry cleanup, and inspect the manual-only guards and limited call surface:

```sh
python3 -I test/publisher-key-transport-diagnostic.test.py
```

No Trial4 packet, claim, artifact, source event or historical deadline is changed. The original artifact/helper deadline remains 2026-10-11 15:00 UTC (17:00 Europe/Vienna); the separate, explicitly extended diagnostic authorization is not a rewrite of that original evidence. This proposal does not implement a live recovery publisher, retries, automatic reviews or merges. A successful transport diagnostic never authorizes those later actions by itself.
