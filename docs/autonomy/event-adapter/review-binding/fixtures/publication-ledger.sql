-- PREPARATION ONLY. Never executed by importing the adapter or starting Meridian.
-- Provisioning requires a separately reviewed migration and DB-role approval.
CREATE SCHEMA meridian_publisher;
REVOKE ALL ON SCHEMA meridian_publisher FROM PUBLIC;
CREATE TABLE meridian_publisher.reservations (
    operation_key text PRIMARY KEY CHECK (operation_key ~ '^[a-f0-9]{64}$'),
    intent_sha256 text NOT NULL CHECK (intent_sha256 ~ '^[a-f0-9]{64}$'),
    body_sha256 text NOT NULL CHECK (body_sha256 ~ '^[a-f0-9]{64}$'),
    run_id bigint NOT NULL CHECK (run_id BETWEEN 1 AND 9007199254740991),
    run_attempt integer NOT NULL CHECK (run_attempt = 1),
    status text NOT NULL CHECK (status IN ('RESERVED','CONFIRMED','AMBIGUOUS')),
    comment_id bigint CHECK (comment_id BETWEEN 1 AND 9007199254740991),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK ((status = 'CONFIRMED' AND comment_id IS NOT NULL)
        OR (status IN ('RESERVED','AMBIGUOUS') AND comment_id IS NULL))
);
REVOKE ALL ON meridian_publisher.reservations FROM PUBLIC;

CREATE FUNCTION meridian_publisher.guard_reservation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    IF TG_OP IN ('DELETE','TRUNCATE') THEN
        RAISE EXCEPTION 'publisher reservations cannot be removed';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'RESERVED' OR NEW.comment_id IS NOT NULL THEN
            RAISE EXCEPTION 'publisher reservation must start reserved';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD.status <> 'RESERVED' OR NEW.status NOT IN ('CONFIRMED','AMBIGUOUS')
       OR ROW(NEW.operation_key,NEW.intent_sha256,NEW.body_sha256,NEW.run_id,NEW.run_attempt,NEW.created_at)
          IS DISTINCT FROM
          ROW(OLD.operation_key,OLD.intent_sha256,OLD.body_sha256,OLD.run_id,OLD.run_attempt,OLD.created_at) THEN
        RAISE EXCEPTION 'publisher reservation identity or terminal state is immutable';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION meridian_publisher.guard_reservation() FROM PUBLIC;
CREATE TRIGGER guard_reservation_row BEFORE INSERT OR UPDATE OR DELETE
ON meridian_publisher.reservations FOR EACH ROW
EXECUTE FUNCTION meridian_publisher.guard_reservation();
CREATE TRIGGER guard_reservation_truncate BEFORE TRUNCATE
ON meridian_publisher.reservations FOR EACH STATEMENT
EXECUTE FUNCTION meridian_publisher.guard_reservation();
-- A future dedicated non-owner role receives only schema USAGE, SELECT, INSERT
-- and UPDATE(status,comment_id). Never DELETE/TRUNCATE/DDL or application-table access.
-- Owner/superuser can remove safeguards: that administrative trust is not solved here.
