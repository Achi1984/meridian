# M11 Claude runtime capture (source-only, unverified)

`scripts/autonomy/m11-claude-runtime-capture.mjs` is a pure bytes parser for local Claude SDK execution transcripts. It is preparatory evidence only.

## Contract

- Input is untrusted bytes only.
- Parsing is bounded (`MAX_BYTES`, `MAX_RECORDS`, `MAX_DEPTH`) and fails closed on malformed JSON, duplicate keys, oversized/deep input, invalid UTF-8, and ambiguous terminal structure.
- Exactly one `system/init` and one terminal `result` are required.
- Supported adapter version is explicit and fixed: `mutable@v1`. Unknown versions fail closed.
- The parser captures only allowlisted fields:
  - observed session ID,
  - requested model,
  - observed model (single-model only; conflicts fail closed),
  - result subtype,
  - explicit `is_error` boolean,
  - finite integer `num_turns`.

## Safety and non-promotion

- Output is always `status: "UNVERIFIED"` with `promotesTrustedRuntime: false`.
- Missing stop reason, truncation proof, and provenance stay `UNKNOWN`; no completion inference is derived from success subtype.
- Prose/tool text is ignored for metadata and never echoed.
- No `verifyRuntimeEvidence` seam is implemented here.
- Captured candidates are intentionally insufficient to satisfy `m11-review-boundary` trusted runtime witness requirements.
