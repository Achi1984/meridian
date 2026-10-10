# Inactive publisher credential delta

Base: main `0e28cd177a3af0423092789647b439f60fed809f`. Trial3 remains the successful live milestone. This patch does not repeat or extend that trial.

The existing publisher keeps reads, artifact retrieval, claims and Git object/ref writes on its job `GH_TOKEN`. Only the fixed Draft-creation POST uses `MERIDIAN_PUBLISHER_TOKEN`, intended to be a short-lived GitHub App installation token. Missing credentials or an unconfigured bot identity fail before publication writes. The returned Draft must identify the pinned bot, actual positive PR number, expected head/base commits and repository. An uncertain or mismatched POST result stops without retry; the remotely created PR might still exist and requires reconciliation.

`PUBLISHER_BOT_LOGIN = None` deliberately leaves the implementation inactive. No workflow, source pin, deadline, claim or packet permission is changed. Token prefix validation cannot prove installation identity, permissions, expiry or revocation. Reviewed minting and scope verification are still required before activation; no PAT fallback is implemented. The actual installed App bot login must be pinned by a later reviewed configuration, never inferred from a model or the returned PR.

For PR creation, the separate App should request only repository Pull requests: write (plus implicit metadata access), not blanket Contents: write. PR-write itself is broader than creation and can include update-branch capabilities; the helper's exact endpoint/payload restriction is not a platform-wide security boundary. The original job retains Contents: write and still requires its existing isolation and branch protections. This one-shot delta permits no later GH_TOKEN push to an already-open App PR.

Retained: generator credential isolation, pinned CLI and zero-tool probe, trusted test template, artifact validation, no-reset claim, non-force publication and draft-only output.

Not implemented: App creation/installation or minting workflow; secret/settings changes; activation; successor descriptors; automatic CI proof; another live/model invocation; automatic review or merge. Next live evidence must demonstrate App-created PR CI without the GITHUB_TOKEN approval hurdle and, in a separately bounded change, one approved successor.

Validation: `node --test test/copilot-coding-pilot.test.js test/copilot-publisher-credential.test.js` passes all 24 tests (18 existing and 6 new). Existing publisher fixtures now provide explicit mocked bot/token configuration and complete PR responses. The positive flow asserts only the fixed Draft POST selects the publisher credential. Negative artifact and ledger fixtures still reach their intended validation, with API/download assertions; production guards remain unchanged.

References: https://docs.github.com/en/actions/concepts/security/github_token and https://docs.github.com/en/rest/pulls/pulls#create-a-pull-request .
