# Full evidence envelope binding (source-only)

`bind_envelope(observation_raw, expected_raw, required_policy_raw)` composes the existing exact-comment guard with the v2 evidence contract. Supply the complete observed comment and independent original actor, version, request/CI scope and mandatory-check policy pins. The shared guard verifies the original full body bytes, comment identity/timestamps and Claude actor before the contract sees the envelope. No inner claim is substituted and no observed body is used to overwrite version pins.

Only a completely validated v2 envelope exposes a planner response. A valid adverse verdict remains adverse for the existing adapter. Legacy v1 claims remain supported by the old entrypoint, but cannot provide complete executed-check evidence through this entrypoint. Mailbox 571 is required. Output contains scope, verdict, version and digest metadata, never raw bodies, findings or commands.

Tests compose the actual contract producer, this binder and the unchanged continuation adapter. They cover edited versions, wrong actor/mailbox, independent policy/scope mismatch, invalid evidence and v1 rejection. Existing v1 tests protect the shared guard refactor.

Every authentication, provenance and action-authority flag remains false. Executed-check fields are supplied claims, not independent proof of execution. This module does not fetch comments, execute commands, change the live Claude producer or workflow, grant permissions or activate a worker. Existing read-only handoff runtime behavior is unchanged; deployment wiring and independent evidence provenance remain separate gates.
