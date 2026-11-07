import assert from "node:assert/strict";
import {createHash, randomBytes} from "node:crypto";
import {readFile} from "node:fs/promises";
import {Pool} from "pg";
import test from "node:test";
import {createPrivateReportStore} from "../private-report-store.mjs";

const connectionString = process.env.MERIDIAN_TEST_PAPER_REPORT_DATABASE_URL;
const postgresTest = connectionString ? test : test.skip;

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function reportInput(runId, content = "original") {
  return {
    runId,
    configHash: hash("synthetic-config"),
    digest: hash(content),
    envelope: {schema: "SYNTHETIC_TEST_ONLY", runId, content}
  };
}

async function waitUntil(check, message, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail(message);
}

postgresTest("private Paper report store preserves PostgreSQL transaction guarantees", async t => {
  const admin = new Pool({connectionString, max: 1});
  let database;
  let blocker;
  let timeoutDatabase;
  const schema = `paper_report_test_${process.pid}_${randomBytes(5).toString("hex")}`;
  let schemaCreated = false;
  t.after(async () => {
    await Promise.all([database, blocker, timeoutDatabase]
      .filter(Boolean)
      .map(pool => pool.end()));
    if (schemaCreated) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  });

  const identity = await admin.query(
    "SELECT current_database() AS database, inet_server_addr() AS address, current_setting('server_version') AS version"
  );
  const target = identity.rows[0];
  assert.match(target.database, /^meridian_paper_report_test_[a-z0-9_]+$/);
  assert.equal(target.address, null, "integration tests require a local Unix socket");
  console.log(`Synthetic PostgreSQL integration target: ${target.version}, local socket`);

  await admin.query(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  const options = {connectionString, options: `-c search_path=${schema}`};
  database = new Pool({...options, max: 2});
  blocker = new Pool({...options, max: 1});
  timeoutDatabase = new Pool({...options, max: 1});
  const migration = await readFile(
    new URL("../migrations/20261101_meridian_paper_reports.sql", import.meta.url),
    "utf8"
  );
  await database.query(migration);

  const store = createPrivateReportStore(database);
  const concurrentInput = reportInput("synthetic-concurrent-identical");
  const duplicateResults = await Promise.all([
    store.insertImmutable(concurrentInput),
    store.insertImmutable(concurrentInput)
  ]);
  assert.deepEqual(duplicateResults.sort(), ["IDENTICAL", "INSERTED"]);

  const conflict = await store.insertImmutable(
    reportInput(concurrentInput.runId, "conflicting-content")
  );
  assert.equal(conflict, "CONFLICT");
  const persisted = await database.query(
    "SELECT content_sha256 FROM meridian_paper_reports WHERE run_id = $1",
    [concurrentInput.runId]
  );
  assert.equal(persisted.rows[0].content_sha256, concurrentInput.digest);

  const rejectedRunId = "synthetic-trigger-rollback";
  await database.query(`
    CREATE FUNCTION reject_synthetic_report() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.run_id = '${rejectedRunId}' THEN
        RAISE EXCEPTION 'synthetic rollback test';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER reject_synthetic_report BEFORE INSERT ON meridian_paper_reports
    FOR EACH ROW EXECUTE FUNCTION reject_synthetic_report();
  `);
  await assert.rejects(
    store.insertImmutable(reportInput(rejectedRunId)),
    /synthetic rollback test/
  );
  assert.equal(store.activeCount(), 0);
  const rolledBack = await database.query(
    "SELECT run_id FROM meridian_paper_reports WHERE run_id = $1",
    [rejectedRunId]
  );
  assert.equal(rolledBack.rowCount, 0);
  await database.query(`
    DROP TRIGGER reject_synthetic_report ON meridian_paper_reports;
    DROP FUNCTION reject_synthetic_report();
  `);
  assert.equal(await store.insertImmutable(reportInput("synthetic-after-trigger")), "INSERTED");

  const timeoutStore = createPrivateReportStore(timeoutDatabase, {
    maxConcurrent: 1,
    operationTimeoutMs: 150
  });
  const blockedInput = reportInput("synthetic-timeout-lock");
  const backendBefore = (await timeoutDatabase.query("SELECT pg_backend_pid() AS pid"))
    .rows[0].pid;
  const blockerClient = await blocker.connect();
  try {
    await blockerClient.query("BEGIN");
    await blockerClient.query(
      `INSERT INTO meridian_paper_reports (run_id, config_hash, content_sha256, envelope)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [
        blockedInput.runId,
        blockedInput.configHash,
        blockedInput.digest,
        JSON.stringify(blockedInput.envelope)
      ]
    );

    const pending = timeoutStore.insertImmutable(blockedInput);
    const timedOut = assert.rejects(
      pending,
      error => error.code === "PAPER_REPORT_OUTCOME_UNKNOWN"
    );
    await waitUntil(async () => {
      const result = await admin.query(`
        SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity
           WHERE datname = current_database()
             AND wait_event_type = 'Lock'
             AND query LIKE '%INSERT INTO meridian_paper_reports%'
        ) AS waiting
      `);
      return result.rows[0].waiting;
    }, "report insert did not reach a PostgreSQL row lock");
    await timedOut;
    assert.equal(timeoutStore.activeCount(), 1);
    await assert.rejects(
      timeoutStore.insertImmutable(reportInput("synthetic-busy")),
      error => error.code === "STORE_BUSY"
    );
  } finally {
    await blockerClient.query("ROLLBACK");
    blockerClient.release();
  }

  await waitUntil(
    () => timeoutStore.activeCount() === 0,
    "timed-out transaction did not roll back and release its store slot"
  );
  const afterTimeout = await database.query(
    "SELECT run_id FROM meridian_paper_reports WHERE run_id = $1",
    [blockedInput.runId]
  );
  assert.equal(afterTimeout.rowCount, 0);
  assert.equal(
    await timeoutStore.insertImmutable(reportInput("synthetic-after-timeout")),
    "INSERTED"
  );
  const backendAfter = (await timeoutDatabase.query("SELECT pg_backend_pid() AS pid"))
    .rows[0].pid;
  assert.equal(backendAfter, backendBefore, "the same pooled PostgreSQL connection was reused");
});
