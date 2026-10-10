# Reviewer runtime source research — inactive

Source pairing: SDK release `v1.0.19`, Git tree
`f0b503aae1ba151d29d117088de4238d1983e33e`. Its `nodejs/package.json`
declares `copilotCliVersion: "1.0.95"`. This identifies a matching release;
published package integrity, installation and runtime compatibility still require
verification. Current SDK main targets a newer CLI and must not replace this pin.
The installed `@github/copilot-sdk` 1.0.19 declaration files were also read
locally without runtime startup: they confirm the constructor/session fields,
pre-create `onEvent`, and `PermissionDecisionReject` with `kind: "reject"` and
optional `feedback`. This is API-shape verification, not a live compatibility test.

Verified API configuration shape (illustrative only; not executable approval):

```js
import {CopilotClient, RuntimeConnection} from '@github/copilot-sdk';
const client = new CopilotClient({
  mode: 'empty',
  baseDirectory: freshConfig,
  workingDirectory: emptyWorkingDirectory,
  builtinPluginDirectories: [],
  enableRemoteSessions: false,
  useLoggedInUser: false,
  gitHubToken: approvedReadOnlyJobToken,
  connection: RuntimeConnection.forStdio({
    path: integrityVerifiedCli,
    args: ['--no-auto-update'],
    env: explicitCleanEnvironment,
  }),
});
const session = await client.createSession({
  model: approvedExactClaudeModel,
  allowedModels: [approvedExactClaudeModel],
  configDirectory: freshConfig,
  enableConfigDiscovery: false,
  tools: [], availableTools: [],
  excludedTools: ['builtin:*', 'mcp:*', 'custom:*'],
  mcpServers: {}, customAgents: [], pluginDirectories: [],
  instructionDirectories: [], skillDirectories: [], includedBuiltinSkills: [],
  memory: {enabled: false},
  infiniteSessions: {enabled: false},
  systemMessage: {mode: 'append', content: fixedReviewerInstructions},
  onPermissionRequest: () => ({kind: 'reject'}),
  onEvent: boundedCollector,
});
// One fresh session, one send only; no resume or repeated send.
const response = await session.sendAndWait({prompt: boundedEvidencePrompt}, timeoutMs);
// Production code needs finally cleanup, abort on failure and outer process deadline.
await session.disconnect();
await client.stop();
```

`connection.env` replaces inherited environment. `mode: 'empty'` requires explicit
persistence and tool configuration; source sets exclusion precedence to deny.
Empty-mode prompt handling preserves SDK security instructions and removes the
environment-context section. Avoid `systemMessage.mode: 'replace'`: source warns
that it also removes SDK security guardrails. Fresh directories, denied permissions
and no tools remain real controls; prompt wording is not a permission boundary.

`onEvent` in session creation is registered before the create RPC for non-cloud
sessions. Capture `assistant.usage` there: generated `AssistantUsageData.model`
is the model used for that call. `apiCallId`, input/output tokens, `cost`,
`initiator`, `interactionType`, `isAuto`, `isByok` and tool counts are optional.
Do not turn absence into zero or fabricate identifiers. `cost` is a multiplier,
not dollars. Usage events are ephemeral; a later session log is not an equivalent
source. Session-start selection and model-authored text do not prove call identity.

Require one observed call with exact approved model and no adverse signals. Bound
collected event count/bytes; refuse missing/mismatched identity, session errors,
tool execution, subagents, compaction, unexpected model/provider routing or
multiple observed calls. Preserve unknown outcomes without retry. Assistant
message `data.content` is text, and a single call can produce multiple chunks:
do not equate assistant-message count with API-call count. No raw reasoning or
provider transcript belongs in published diagnostics.

Critical limit: one `sendAndWait` is one user turn, not proof of exactly one
provider request. The examined public session limit surface exposes AI credits,
not an atomic one-provider-call cap. Disabling infinite sessions requests no
automatic compaction, but all runtime behavior still needs a credential-free
loopback probe. Observing a second call can invalidate a result and trigger abort;
it cannot reverse already accepted usage. Timeout similarly does not prove remote
cancellation. Retain the existing account spending block and finite reservations.

Next evidence: pin package integrity; verify SDK/CLI handshake and exact option
serialization against the pinned runtime without authentication; probe tool list,
permission denial and event delivery with local synthetic provider fixtures.
An authorized bounded live trial is still needed for actual Copilot model identity,
entitlement and usage. This source research invoked no model and supplied no token.

## Integration checkpoint — source exists, route remains inactive

The separate implementation candidates now include
`scripts/copilot-review-evidence.py` and `scripts/copilot-review-runtime.mjs`,
with mock-based tests. Lead also verified import and construction of the real
SDK 1.0.19 client without starting it, after supplying explicit `baseDirectory`.
This confirms constructor compatibility, not a handshake, inference or end-to-end
review. The collector remains BLOCKED while authenticated exact-base/audit
attestations and Git tree-mode evidence are missing. Its synthetic tests do not
supply those live attestations.

Next concrete integration: bind the collector to authenticated exact-head/base,
audit and tree-mode observations; implement an independent process supervisor
that enforces timeout and cleanup around SDK startup/send/stop; then bind one
new durable approved reservation to the reviewed evidence and runtime artifacts.
Preserve the distinction between one SDK send and a hard provider-request cap.
No runnable workflow, durable invocation ledger or authenticated result publisher
exists in this candidate yet. Prepare and review that complete bounded wiring
before proposing a live trial; do not describe the mock-tested components as an
operational replacement reviewer.

Primary source paths at tag v1.0.19:
- https://github.com/github/copilot-sdk/blob/v1.0.19/nodejs/package.json
- https://github.com/github/copilot-sdk/blob/v1.0.19/nodejs/src/types.ts
- https://github.com/github/copilot-sdk/blob/v1.0.19/nodejs/src/client.ts
- https://github.com/github/copilot-sdk/blob/v1.0.19/nodejs/src/session.ts
- https://github.com/github/copilot-sdk/blob/v1.0.19/nodejs/src/generated/session-events.ts
- https://github.com/github/copilot-sdk/blob/v1.0.19/nodejs/test/e2e/permissions.e2e.test.ts
- https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/usage-and-billing
- https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/streaming-events
# Target packet sizing verified by Lead

For PR #662 head `db41d71af629c9a180c92bb75ab5ca9b86348d4c` against
base `18105903153d71cf6656e208456face06708a857`, Lead fetched all nine required
immutable head/base blobs through the authenticated connector and independently
verified their Git blob hashes. The complete locally reconstructed diff is
50,781 UTF-8 bytes; source inventory is 144,615 bytes. The original 32 KiB diff
and 128 KiB inventory limits would reject the intended target. The revised limits
are 64 KiB diff, 128 KiB serialized packet, 256 KiB source inventory and unchanged
64 KiB per source file. These are transport bounds, not token or spending caps.
This validates source sizing only; it supplies neither missing execution
attestations nor a model review.

