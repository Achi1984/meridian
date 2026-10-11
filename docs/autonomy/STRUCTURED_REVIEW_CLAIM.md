# Structured reviewer claim — offline contract

This source-only extension prepares a machine-readable Claude result for a future reviewed integration. It extends the existing V3 review coordinator; it does not replace the mailbox, authenticate a reviewer, create a native PR approval or enforce repository protection.

## Scope and boundary

The contract accepts an already-decoded JavaScript data object and separately supplied expected pins. It does not parse raw JSON or extract verdicts from prose. A future transport decoder must reject duplicate JSON keys, bound input bytes and handle decoding errors before this function; a parsed object cannot reveal discarded duplicate keys.

The claim identifies the repository, PR, request, operation, reviewed head/base and CI run/attempt/workflow/head, plus verdict and CI status/conclusion. Expected values must come from the controlling caller's independently reconciled request, never be copied from the model response to make it pass. Exact equality and strict field types are consistency checks only: caller inputs themselves remain unauthenticated by this module.

A successful action execution is not a successful review. A missing, malformed, stale or mismatched claim must not be replaced by a search for green text in a comment. Non-GREEN verdicts remain explicit results. A structurally valid GREEN with consistent completed-success CI is still only an unverified model claim; live CI results must be fetched separately.

## Authority

All authority flags remain false: authentication, provenance verification, authorization, merge, activation and request dispatch. A model-supplied reviewer label, author, comment ID or transport identity cannot establish identity. Authenticated GitHub retrieval and actor provenance, fresh PR/head/base state, actual required CI, independent review, owner scope, protections and expected-state merge guards remain separate gates.

The existing classifyReview API and its deduplication behavior remain unchanged. Validation reserves no operation, consumes no one-shot key, accesses no network or filesystem and mutates no supplied object. It provides neither durable replay prevention nor an atomic GitHub head/base fence.

## Future integration

A later reviewed workflow may request structured output using the exported schema and pass the decoded result to this validator. That wiring is absent here. The current Claude action's automatically issued App token is revoked before action return; a native approval step must not try to reuse it. A separate explicitly reviewed credential/hook design and effective administrative controls are still required before key storage or pilot activation.

Tests cover malformed fields, scope and CI mismatches, hostile objects, non-GREEN outcomes, immutable input handling and permanently false authority. They validate offline behavior, not live reviewer identity or branch-protection enforcement.

## Serialized transport adapter

`scripts/structured-review-transport.py` adds a provider-independent decoder in front of the existing validator. Standard input is a JSON object with exactly two fields, `claim` and `expected`, each containing its own serialized JSON object. Expected pins must still come from an independently reconciled request, never from the claim itself.

The outer frame is limited to 131072 UTF-8 bytes and one object level; each inner string is limited to 16384 UTF-8 bytes and two object levels. Arrays, duplicate decoded keys (including escaped aliases), non-finite numbers and malformed JSON are rejected before validation. Duplicate detection covers the serialized strings actually received; it cannot recover keys discarded by an upstream parser.

The adapter resolves Node from the trusted launcher's PATH and invokes fixed code with canonical JSON on stdin, no shell, a sanitized child environment and a five-second timeout. The launcher PATH, adapter and sibling validator are trusted inputs, not response-controlled fields. The fixed child writer limits its result to 2048 UTF-8 bytes; capture_output is not an operating-system memory limit against a malicious replacement executable or validator. Errors expose fixed codes, not raw input or child diagnostics. Importing the module performs no I/O.

A zero exit code means a structurally valid claim, including non-GREEN verdicts; it does not mean approval or authority. Authentication, provenance, authorization, dispatch, merge and activation flags remain false. This adapter adds no workflow consumer, model call, credential reuse, native approval or administrative change. Offline tests do not establish provider schema compatibility or live reviewer identity.
