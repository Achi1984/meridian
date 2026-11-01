CREATE TABLE IF NOT EXISTS meridian_paper_reports (
  run_id text PRIMARY KEY CHECK (run_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$'),
  config_hash text NOT NULL CHECK (config_hash ~ '^[a-f0-9]{64}$'),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  envelope jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE meridian_paper_reports FROM PUBLIC;
