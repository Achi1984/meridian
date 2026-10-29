# M11 Coordinator Core Acceptance

This acceptance suite is implemented in `/home/runner/work/meridian/meridian/test/m11-coordinator-core-acceptance.test.js`.

Scope (core only):

- Uses real collector, atomic backend, state store, lifecycle, boundary, and runtime capture modules.
- Verifies durable coordination across start/observe/restart with canonical JSON reconstruction between lifecycle calls.
- Covers capture-to-rejection behavior for unverified runtime candidates and validates fail-closed fences.
- Asserts exact transition sequences, admission gate/quota retention, and transition counters.

Explicitly out of scope:

- Hosted trusted-runtime attestation success paths.
- End-to-end receipt composition and full receipt delivery workflows.
- Any fake runtime attestation or fabricated committed transitions.

Receipt composition remains separately validated after receipt dependency integration lands.
