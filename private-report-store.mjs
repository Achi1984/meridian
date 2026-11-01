export function createPrivateReportStore(db) {
  if (!db || typeof db.connect !== "function" || typeof db.query !== "function") return null;

  return Object.freeze({
    async insertImmutable({runId, configHash, digest, envelope}) {
      const client = await db.connect();
      let transaction = false;
      try {
        await client.query("BEGIN");
        transaction = true;
        const inserted = await client.query(
          `INSERT INTO meridian_paper_reports
             (run_id, config_hash, content_sha256, envelope)
           VALUES ($1, $2, $3, $4::jsonb)
           ON CONFLICT (run_id) DO NOTHING
           RETURNING run_id`,
          [runId, configHash, digest, JSON.stringify(envelope)]
        );
        if (inserted.rowCount === 1) {
          await client.query("COMMIT");
          transaction = false;
          return "INSERTED";
        }
        const existing = await client.query(
          `SELECT config_hash, content_sha256
             FROM meridian_paper_reports
            WHERE run_id = $1
            FOR SHARE`,
          [runId]
        );
        const row = existing.rows[0];
        if (!row) throw new Error("paper_report_unique_row_missing");
        await client.query("COMMIT");
        transaction = false;
        return row.config_hash === configHash && row.content_sha256 === digest
          ? "IDENTICAL"
          : "CONFLICT";
      } catch (error) {
        if (transaction) {
          try { await client.query("ROLLBACK"); } catch { }
        }
        throw error;
      } finally {
        client.release();
      }
    },

    async get(runId) {
      const result = await db.query(
        `SELECT run_id, config_hash, content_sha256, envelope
           FROM meridian_paper_reports
          WHERE run_id = $1`,
        [runId]
      );
      return result.rows[0] ?? null;
    }
  });
}
