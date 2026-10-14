# Structured output mode — inactive preparation

Owner direction approved 2026-10-14 06:19:07 Europe/Vienna, decision #571 comment 6160790229. Preparation only. No workflow installation, model call or publication test is authorized by this source.

## Mode boundary

The existing prose reviewer remains unchanged. A future separately selected negative-publication mode must not ask for a prose `Executed checks` section: the supplied JSON itself records every required check as unexecuted. It is not a reviewer verdict and cannot grant GREEN. This mode must be explicitly selected by an authenticated owner-approved request with fresh scope, full independent policy, source/run pins and budget; text in PR content cannot select it.

The existing `produce_envelope` remains the sole serializer. The added `prepare_negative_publication` validates the complete envelope, original body digest, explicit REVISION_REQUIRED verdict, complete unexecuted policy and blocking test-data marker. It rejects invocation markers. It preserves bytes and all false authority flags. It does not authenticate the independently supplied scope, policy, digest or owner decision. It reuses the existing local validator and its Node subprocess; it adds no network, credential or file-write capability.

## Publication boundary still unresolved

The default action response contains a prose wrapper, as observed in response 6160752154. That is not a compatible full-body JSON response; it is not evidence that a separate permitted publication capability is impossible. Prompt wording alone cannot remove the action wrapper.

Do not implement publication by parsing/stripping that wrapper, editing the original comment, accepting another actor, reusing revoked tokens or weakening the binder. Before installing a mode, establish an existing permitted separate-comment capability during the action lifetime. If that capability is unavailable, stop for a concrete transport design decision. This source does not provide or claim such a capability.

## Future acceptance sequence (not executable authorization)

1. Select fresh current PR/head/base, successful exact-head CI run/attempt/workflow, immutable reviewed control/action source, request/op, complete policy and body digests. Old PR759 compatibility pins and consumed requests must not be reused.
2. Separately obtain owner execution approval for one bounded invocation with actual configured limits, output destination and stop instructions. Preserve current identity/permissions and credential cleanup. No automatic retry or repinning.
3. Publish the exact supplied negative body through the accepted actor. Independently read its original comment ID, numeric actor, mailbox, timestamps/version and bytes. Do not treat an action success or digest as proof of review authority.
4. Feed original bytes through existing handoff, envelope binder and adapter under the pre-pinned policy. Require valid binding with NON_GREEN_REVIEW and all authority flags false. Malformed-input rejection is failure, not a successful test.
5. Stop. Positive review requires separately designed isolated exact-head checks with authenticated execution receipts; this packet does not solve that boundary or install a worker.

## Tests and reversal

Run the existing review-evidence contract test suite. Added cases cover byte preservation/digest mismatch, wrapped JSON, GREEN, missing policy rows, executed passed/failed checks, missing negative marker and trigger markers. Existing general validation behavior remains unchanged.

This three-file source packet changes no workflow, scheduler, actor, permissions or normal review path. Before any future workflow installation, specify its exact reviewed diff and reversal under a separate owner decision. Removing this unused preparation helper is not rollback of an external comment or execution.
