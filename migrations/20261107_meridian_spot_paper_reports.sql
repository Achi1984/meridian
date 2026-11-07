CREATE TABLE IF NOT EXISTS meridian_spot_paper_reports (
  run_id text PRIMARY KEY CHECK (run_id = 'spot-paper-42395522899-1'),
  config_hash text NOT NULL CHECK (config_hash ~ '^[a-f0-9]{64}$'),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  envelope jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE meridian_spot_paper_reports FROM PUBLIC;
