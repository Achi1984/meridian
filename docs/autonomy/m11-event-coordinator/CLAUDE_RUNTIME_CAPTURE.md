# M11 Claude runtime capture (source-only, unverified)

`scripts/autonomy/m11-claude-runtime-capture.mjs` is a pure bytes parser for local Claude SDK execution transcripts. It is preparatory evidence only.

## Contract

- Input is untrusted bytes only.
- Caller must explicitly pass `parserContractVersion`; only `m11-claude-runtime-capture@v1` is supported.
- Parsing is bounded (`MAX_BYTES`, `MAX_RECORDS`, `MAX_DEPTH`) and fails closed on malformed JSON, duplicate keys, oversized/deep input, invalid UTF-8, and ambiguous terminal structure.
- Exactly one `system/init` and one terminal `result` are required.
- The parser-contract version is external to transcript bytes. SDK `init.adapter_version` is not required.
- Reviewed upstream action reference: `1d6de8cb0c237e7c15e9e1bdf973826ebae490cc`. Current workflow still uses mutable `@v1`; hosted provenance remains `UNKNOWN`.
- The parser captures only allowlisted fields:
  - observed session ID,
  - requested model (`UNKNOWN` unless separately supplied by caller),
  - observed model from narrow SDK paths (`system/init.model`, `assistant.message.model`, `result.modelUsage` keys),
  - result subtype,
  - explicit `is_error` boolean,
  - finite integer `num_turns`.
- Conflicting session metadata or conflicting model observations fail closed.
- Provided malformed `result.session_id` is rejected and never treated as absent.

## Safety and non-promotion

- Output is always `status: "UNVERIFIED"` with `promotesTrustedRuntime: false`.
- Missing stop reason, truncation proof, and provenance stay `UNKNOWN`; no completion inference is derived from success subtype.
- Prose/tool text and unrelated user/tool model fields are ignored for metadata and never echoed.
- No `verifyRuntimeEvidence` seam is implemented here.
- Captured candidates are intentionally insufficient to satisfy `m11-review-boundary` trusted runtime witness requirements.
