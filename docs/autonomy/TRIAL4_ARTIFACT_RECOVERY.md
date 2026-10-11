# Original Trial4 artifact recovery candidate

This locally prepared candidate contains a concrete authenticated GitHub adapter and protected-job launcher. It has not been activated or dispatched. The workflow template deliberately requires a real immutable source commit and literal file hashes before it can be installed. Publishing a draft integration PR grants no execution authority. Reviewed merge, exact main approval and the existing owner environment gate remain required.

The only output is one App-authored draft containing the exact two previously generated files from artifact 11705462075. No model call, original workflow rerun, claim reset, merge, or protection change is included. The original archive, provenance, claim and 15:00Z deadline remain unchanged. This separate recovery authorization expires at 2026-10-11T18:00:00Z (20:00 Vienna), explicitly extended by the owner at 18:49 Vienna on October 11. Expiry stops new writes and minting; token revocation still runs. A transport diagnostic success does not explain the original stage-initial failure.

`approved_base` has no workflow default. It must equal the reviewed main SHA, GitHub execution/workflow SHA, authenticated run head and live main. The launcher compares the complete workflow bytes against the rendered immutable template, authenticates the owner and native environment approval, and reconciles the original fixed failed-job receipt. The original artifact, source run, source PR, original claim, green main checks and absence of output paths/PRs are checked before writes. A distinct atomic recovery branch claim consumes the one-shot identity; uncertainty requires reconciliation, never automatic retry.

Ordinary job credentials prepare the branch but cannot create the PR through this adapter. Only the existing verified broker's repository-scoped PR-write App token can perform the fixed draft POST. Success requires a validated response and confirmed token revocation with the expected App/install/repository identities. The broker source is retained byte-for-byte and hash-checked. No credentials are persisted or included in receipts.

## Repository mapping and verification

Place runtime files, Python tests, `workflow.template.yml`, and `evidence/` under `scripts/autonomy/trial4-recovery/`. Place `trial4-artifact-recovery.test.js` under `test/`, and this document at `docs/autonomy/TRIAL4_ARTIFACT_RECOVERY.md`.

Run offline tests with:

```
python3 -I -m unittest discover -s scripts/autonomy/trial4-recovery -p 'test_recovery_*.py'
node --test test/trial4-artifact-recovery.test.js
```

The tests use only preserved public evidence and synthetic API/key/token fixtures. No live network or secrets are used.

After freezing runtime/template bytes into a real source commit, call `recovery_launcher.render_workflow(actual_source_sha)` in an offline import to produce `.github/workflows/trial4-artifact-recovery.yml`. Do not substitute a fictional SHA. Independently verify uploaded source hashes and rendered workflow bytes after GitHub upload. Any runtime/template change requires a fresh source anchor and rerender. The resulting reviewed merge SHA becomes the explicit `approved_base` for a separately authorized dispatch; it is not the historical artifact base.

Remaining deployment gates are real immutable anchoring, reviewed integration and exact-base approval, native environment approval, unexpired authorization, and all authenticated live preflights. Unexpected signed download origins, missing logs, unknown HTTP outcomes or unavailable schemas stop closed. The candidate does not promise that the preserved draft can be published before the current window expires.

## R2 execution budget

The job timeout is 20 minutes; the loader is limited to 3 minutes and the secret-bearing step to 15 minutes. A process watchdog interrupts ordinary launcher work after 10 minutes. The authenticated current job start also binds a 20-minute job budget, and minting requires at least 4 minutes of normal work plus cleanup/native termination margin remaining. The original artifact and completed diagnostic deadlines are not modified by the separate owner extension.

The Linux alarm interrupts slow reads as well as ordinary Python work. The broker replaces the operation alarm with a separate 60-second cleanup alarm during DELETE, allowing revocation after the authorization deadline. Failed or timed-out cleanup reports reconciliation required, never success. Runner loss, force cancellation or SIGKILL can still prevent cleanup; an issued token may remain valid until its verified GitHub expiry (at most one hour). This residual platform limit is not presented as guaranteed revocation.
