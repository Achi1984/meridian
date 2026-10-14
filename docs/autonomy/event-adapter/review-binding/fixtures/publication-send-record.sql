-- INACTIVE PREPARATION ONLY. Apply only after separately approved provisioning.
-- Requires publication-ledger.sql; this file is not wired into any runner.
CREATE TABLE meridian_publisher.send_records (
 operation_key text PRIMARY KEY REFERENCES meridian_publisher.reservations(operation_key),
 comment_id bigint NOT NULL UNIQUE CHECK (comment_id BETWEEN 1 AND 9007199254740991),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON meridian_publisher.send_records FROM PUBLIC;
CREATE FUNCTION meridian_publisher.guard_send_record() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 RAISE EXCEPTION 'publisher send records are immutable';
END;
$$;
REVOKE ALL ON FUNCTION meridian_publisher.guard_send_record() FROM PUBLIC;
CREATE TRIGGER guard_send_record_row BEFORE UPDATE OR DELETE
ON meridian_publisher.send_records FOR EACH ROW
EXECUTE FUNCTION meridian_publisher.guard_send_record();
CREATE TRIGGER guard_send_record_truncate BEFORE TRUNCATE
ON meridian_publisher.send_records FOR EACH STATEMENT
EXECUTE FUNCTION meridian_publisher.guard_send_record();
-- Future non-owner sender role: schema USAGE, SELECT/INSERT on send_records,
-- SELECT plus the minimum UPDATE privilege needed for FOR UPDATE on reservations.
-- Confirmation reader: schema USAGE and SELECT only on both tables.
-- No request/user/model-controlled path may acquire sender pool privileges.
-- Administrative owners can defeat these guards; host trust remains required.
