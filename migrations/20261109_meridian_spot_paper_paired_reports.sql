CREATE TABLE IF NOT EXISTS meridian_spot_paper_paired_reports (
  run_id text PRIMARY KEY CHECK (run_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  config_hash text NOT NULL CHECK (config_hash ~ '^[a-f0-9]{64}$'),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  envelope jsonb NOT NULL CHECK (octet_length(envelope::text) <= 262144),
  created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE meridian_spot_paper_paired_reports FROM PUBLIC;
