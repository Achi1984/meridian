import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function assessObservationEvidence({ observeExitCode, observeReport, readback }) {
  const report = readback?.report;
  const terminalVerified = readback?.reconciliation === "TERMINAL_REPORT_AVAILABLE" &&
    readback.runId === report?.runId && readback.resumed === false &&
    Number.isSafeInteger(readback.eventCount) && readback.eventCount >= 2 &&
    readback.checkpoint?.stopReason === report?.stopReason &&
    observeReport?.schemaVersion === report?.schemaVersion &&
    observeReport?.runId === report?.runId && observeReport?.mode === "observe" &&
    observeReport?.observations === report?.observations &&
    observeReport?.dataGaps === report?.dataGaps &&
    observeReport?.requests === report?.requests &&
    observeReport?.deliveredBytes === report?.deliveredBytes &&
    readback.executionImpact === false && report?.mode === "observe" &&
    report?.schemaVersion === "SPOT_PAPER_PILOT_REPORT_V1" &&
    report?.pair === "BTC/EUR" && report?.executionImpact === false &&
    report?.liveTrading === false && report?.autoPromotion === false &&
    Array.isArray(report?.fills) && report.fills.length === 0;
  const cleanBoundedTermination = observeExitCode === 0 && terminalVerified &&
    report?.operationalStatus === "COMPLETED_BOUNDED" &&
    ["CYCLE_LIMIT", "DURATION_LIMIT"].includes(report.stopReason);
  const acceptedObservations = Number.isSafeInteger(report?.observations) ?
    report.observations : 0;
  const accepted = cleanBoundedTermination && acceptedObservations >= 1;
  return {
    outcome: accepted ? "DATA_ACCEPTED" :
      cleanBoundedTermination ? "FAILED_DATA_ACCEPTANCE" : "INCOMPLETE_OR_UNVERIFIED",
    cleanBoundedTermination,
    terminalVerified,
    accepted,
    acceptedObservations,
    dataGaps: Number.isSafeInteger(report?.dataGaps) ? report.dataGaps : null,
    requests: Number.isSafeInteger(report?.requests) ? report.requests : null,
    bytes: Number.isSafeInteger(report?.deliveredBytes) ? report.deliveredBytes : null,
    stopReason: report?.stopReason ?? null,
    reconciliation: readback?.reconciliation ?? null,
    runId: readback?.runId ?? report?.runId ?? null
  };
}

async function main(argv) {
  const [observePath, readbackPath, exitCodeText, outputPath] = argv;
  if (!observePath || !readbackPath || exitCodeText === undefined || !outputPath) {
    throw new Error("Usage: evidence-assessment.mjs <observe.json> <readback.json> <exit-code> <output.json>");
  }
  const readJson = async path => {
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch {
      return null;
    }
  };
  const observeReport = await readJson(observePath);
  const readback = await readJson(readbackPath);
  const exitCode = /^\d+$/.test(exitCodeText) ? Number(exitCodeText) : null;
  const assessment = assessObservationEvidence({ observeExitCode: exitCode, observeReport, readback });
  await writeFile(outputPath, `${JSON.stringify(assessment, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`${JSON.stringify(assessment)}\n`);
  if (!assessment.accepted) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
