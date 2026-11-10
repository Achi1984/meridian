-- UNAPPLIED: additive progress-only storage; apply separately after deployment review.
CREATE TABLE IF NOT EXISTS meridian_spot_paper_paired_progress (
  run_id text PRIMARY KEY CHECK (run_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  identity jsonb NOT NULL CHECK (
    jsonb_typeof(identity) = 'object'
    AND identity->>'schemaVersion' = 'SPOT_PAPER_PAIRED_EXPECTED_IDENTITY_V1'
    AND identity->>'runId' = run_id
    AND identity->>'pair' = 'BTC/EUR'
    AND jsonb_array_length(identity->'models') = 3
  ),
  journal_sequence bigint NOT NULL CHECK (journal_sequence BETWEEN 2 AND 9007199254740991),
  journal_sha256 text NOT NULL CHECK (journal_sha256 ~ '^[a-f0-9]{64}$'),
  terminal_status text NOT NULL CHECK (
    terminal_status IN ('UNKNOWN', 'TERMINAL_RECORDED', 'INTERRUPTED_RECORDED')
  ),
  payload jsonb NOT NULL CHECK (
    octet_length(payload::text) <= 65536
    AND payload->>'schemaVersion' = 'SPOT_PAPER_PAIRED_PROGRESS_V1'
    AND payload->'identity' = identity
    AND (payload->>'journalSequence')::bigint = journal_sequence
    AND payload->>'journalSha256' = journal_sha256
    AND payload->'terminal'->>'status' = terminal_status
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE meridian_spot_paper_paired_progress FROM PUBLIC;
