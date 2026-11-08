CREATE TABLE IF NOT EXISTS meridian_spot_paper_host8h_reports (
  run_id text PRIMARY KEY CHECK (run_id = 'btc-eur-paper-host-8h-001'),
  config_hash text NOT NULL CHECK (config_hash ~ '^[a-f0-9]{64}$'),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  envelope jsonb NOT NULL,
  observed_at timestamptz NOT NULL,
  journal_sequence integer NOT NULL CHECK (journal_sequence >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE meridian_spot_paper_host8h_reports FROM PUBLIC;
