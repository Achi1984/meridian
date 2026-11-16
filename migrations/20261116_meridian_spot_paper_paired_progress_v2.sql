-- UNAPPLIED: forward-only extension after 20261110_meridian_spot_paper_paired_progress.sql.
-- Applying this migration does not enable V2 at the gateway.
BEGIN;

ALTER TABLE meridian_spot_paper_paired_progress
  DROP CONSTRAINT IF EXISTS meridian_spot_paper_paired_progress_journal_sequence_check,
  DROP CONSTRAINT IF EXISTS meridian_spot_paper_paired_progress_payload_check,
  DROP CONSTRAINT IF EXISTS meridian_spot_paper_paired_progress_v2_sequence_check,
  DROP CONSTRAINT IF EXISTS meridian_spot_paper_paired_progress_v2_payload_check;

ALTER TABLE meridian_spot_paper_paired_progress
  ADD CONSTRAINT meridian_spot_paper_paired_progress_v2_sequence_check CHECK (
    journal_sequence BETWEEN 1 AND 9007199254740991
    AND COALESCE((
      (payload->>'schemaVersion' = 'SPOT_PAPER_PAIRED_PROGRESS_V1'
        AND journal_sequence >= 2)
      OR
      (payload->>'schemaVersion' = 'SPOT_PAPER_PAIRED_PROGRESS_V2'
        AND (journal_sequence >= 2 OR
          (journal_sequence = 1 AND payload->>'classification' = 'NO_OBSERVATION')))
    ), false)
  ),
  ADD CONSTRAINT meridian_spot_paper_paired_progress_v2_payload_check CHECK (
    octet_length(payload::text) <= 65536
    AND jsonb_typeof(payload) = 'object'
    AND payload->'identity' IS NOT NULL
    AND payload->'identity' = identity
    AND payload->>'journalSequence' IS NOT NULL
    AND (payload->>'journalSequence')::bigint = journal_sequence
    AND payload->>'journalSha256' IS NOT NULL
    AND payload->>'journalSha256' = journal_sha256
    AND payload->'terminal' IS NOT NULL
    AND payload->'terminal'->>'status' IS NOT NULL
    AND payload->'terminal'->>'status' = terminal_status
    AND payload->>'schemaVersion' IN (
      'SPOT_PAPER_PAIRED_PROGRESS_V1', 'SPOT_PAPER_PAIRED_PROGRESS_V2')
    AND payload->>'classification' IS NOT NULL
    AND COALESCE((
      (payload->>'schemaVersion' = 'SPOT_PAPER_PAIRED_PROGRESS_V1'
        AND journal_sequence >= 2
        AND payload->>'classification' = 'OBSERVED_CHECKPOINT')
      OR
      (payload->>'schemaVersion' = 'SPOT_PAPER_PAIRED_PROGRESS_V2'
        AND (
          (payload->>'classification' = 'NO_OBSERVATION'
            AND jsonb_typeof(payload->'runStartedAt') = 'number'
            AND jsonb_typeof(payload->'lastSuccessfulPollAt') = 'null'
            AND payload->>'completedCycles' = '0'
            AND jsonb_typeof(payload->'observedAt') = 'null'
            AND jsonb_typeof(payload->'valuationAt') = 'null'
            AND jsonb_typeof(payload->'arms') = 'null')
          OR
          (payload->>'classification' = 'OBSERVED_CHECKPOINT'
            AND journal_sequence >= 2
            AND jsonb_typeof(payload->'runStartedAt') = 'number'
            AND jsonb_typeof(payload->'lastSuccessfulPollAt') = 'number'
            AND jsonb_typeof(payload->'completedCycles') = 'number'
            AND jsonb_typeof(payload->'observedAt') = 'number'
            AND jsonb_typeof(payload->'valuationAt') = 'number'
            AND jsonb_typeof(payload->'arms') = 'array')
        )
      )), false)
  );

COMMIT;
