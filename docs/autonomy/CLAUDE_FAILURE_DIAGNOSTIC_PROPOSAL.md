# Failure-only reviewer diagnostic — inactive proposal

This inactive Draft includes the exact proposed workflow diff; main is unchanged. No retry or model call is started by this proposal.
Base reviewed: 0e28cd177a3af0423092789647b439f60fed809f.

Two failed review attempts hide the actual SDK result prose. The action writes a
JSON array of messages into RUNNER_TEMP/claude-execution-output.json. There were
no uploaded artifacts, so the old runners' detailed files cannot be recovered
through the currently available artifact listing. This helper does not recover
those failures or establish quota/OAuth/provider cause.

The helper reads only that fixed filename, at most 2 MiB, rejects duplicate keys,
excessive depth/record count, malformed JSON, symlinks and special files. It emits
only hardcoded classifications and false authority/evidence booleans. It never
outputs free text, request/session IDs, prompts, environment, token/cost fields,
tool results, file paths or exception details. No raw artifacts or step summary
are created. Structured SDK error markers are hints, not verified root causes.
Unknown formats and prose-only failures remain explicitly unclassified.

The proposed workflow delta in this Draft (not adopted on main) adds `id: claude_review` to the existing
review action step, then appends:

```yaml
      - name: Classify reviewer failure without raw output
        if: ${{ failure() && steps.claude_review.outcome == 'failure' }}
        timeout-minutes: 1
        shell: bash
        env:
          DIAGNOSTIC_TEMP: ${{ runner.temp }}
        run: python3 -I -B scripts/claude-failure-diagnostic.py "$DIAGNOSTIC_TEMP"
```

The diagnostic does not enable continue-on-error; the failed review stays failed.
No changes to credentials, permissions, reviewer prompt, model settings, retries,
triggers or show_full_output. Keep show_full_output false/default. The helper must
be loaded from the reviewed trusted main checkout, never a PR artifact or code.
The workflow remains privileged under its existing settings; this is bounded
diagnostic disclosure, not a new execution sandbox. Reviewed workflow adoption is
required before wiring. A later authorized review could produce classifications;
this proposal neither starts it nor promises a diagnosis.

Primary source reviewed at action commit
1d6de8cb0c237e7c15e9e1bdf973826ebae490cc:
- https://github.com/anthropics/claude-code-action/blob/1d6de8cb0c237e7c15e9e1bdf973826ebae490cc/base-action/src/execution-file.ts
- https://github.com/anthropics/claude-code-action/blob/1d6de8cb0c237e7c15e9e1bdf973826ebae490cc/base-action/src/run-claude-sdk.ts
- https://github.com/anthropics/claude-code-action/blob/1d6de8cb0c237e7c15e9e1bdf973826ebae490cc/action.yml

CI entry: `node --test test/claude-failure-diagnostic.test.js`. This wrapper is
discovered by existing Release Safety's `node --test test/*.test.js`; it runs all
nine Python regressions, requires successful completion, and bounds output/time.
Direct test: `python3 -I -B test/test_claude_failure_diagnostic.py`.
Only synthetic fixtures; no captured sensitive SDK transcript is retained.

Activation gate: MERIDIAN_GO.md requires owner approval and exact-head cross-model review for workflow changes. The required Claude reviewer is itself unavailable after two attempts. No automatic merge or review-policy bypass is permitted. Activating this exact diagnostic candidate therefore requires an explicit owner decision on a narrow review exception and the merge candidate, followed by at most one separately authorized diagnostic review run. Existing failed reviews remain failed.
