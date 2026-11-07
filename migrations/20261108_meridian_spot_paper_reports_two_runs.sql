BEGIN;

ALTER TABLE meridian_spot_paper_reports
  DROP CONSTRAINT meridian_spot_paper_reports_run_id_check,
  ADD CONSTRAINT meridian_spot_paper_reports_run_id_check
    CHECK (run_id IN ('spot-paper-42395522899-1', 'spot-paper-42404743386-1'));

REVOKE ALL ON TABLE meridian_spot_paper_reports FROM PUBLIC;

COMMIT;
