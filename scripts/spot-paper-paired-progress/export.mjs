import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {open, lstat} from 'node:fs/promises';
import {isAbsolute, normalize} from 'node:path';
import {
  PROGRESS_SCHEMA, ROLES, MAX_RECENT_FILLS, canonicalJson,
  validIdentity, validateProgress, exactKeys
} from './contract.mjs';

export const MAX_JOURNAL_BYTES = 16 * 1024 * 1024;
export const MAX_JOURNAL_EVENTS = 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const integer = value => Number.isSafeInteger(value) && value >= 0;
const assert = condition => { if (!condition) throw new Error('UNKNOWN'); };
const sameStat = (a, b) => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'nlink']
  .every(key => a[key] === b[key]);
const roleArray = values => Array.isArray(values) && values.length === 3 &&
  values.every((value, index) => value?.role === ROLES[index]);

function matchesIdentity(value, identity) {
  return value && Object.keys(identity).filter(key => key !== 'schemaVersion')
    .every(key => canonicalJson(value[key]) === canonicalJson(identity[key]));
}

function projectJournal(envelope, expectedIdentity, exportedAt, check) {
  assert(exactKeys(envelope, ['payload', 'sha256']));
  const {payload, sha256} = envelope;
  assert(payload?.schemaVersion === 'SPOT_PAPER_PILOT_JOURNAL_V1' &&
    payload.runId === expectedIdentity.runId &&
    Array.isArray(payload.events) && payload.events.length <= MAX_JOURNAL_EVENTS &&
    payload.sequence === payload.events.length &&
    hash(JSON.stringify(payload)) === sha256);
  const manifest = payload.manifest;
  assert(manifest?.schemaVersion === 'SPOT_PAPER_PAIRED_MANIFEST_V1' &&
    manifest.mode === 'paper' && matchesIdentity(manifest, expectedIdentity) &&
    integer(manifest.startedAt) && payload.createdAt === manifest.startedAt);
  const assumptions = manifest.assumptions;
  assert(assumptions?.feeBpsPerSide === 20 && assumptions.slippageBpsPerSide === 10 &&
    assumptions.ratesVerified === false &&
    assumptions.accountContractId === 'BTC_EUR_PAIRED_PAPER_EEA_SPOT_V2' &&
    assumptions.accountContractVersion === 2 &&
    assumptions.feeBasis === 'EEA_SPOT_ONLY_TAKER_ASSUMPTION' &&
    assumptions.feeSource ===
      'https://www.okx.com/en-eu/help/important-notice-upcoming-spot-fee-adjustment-eea' &&
    assumptions.feeAsOf === '2026-11-09' &&
    assumptions.accountTier === 'UNKNOWN' &&
    assumptions.accountingEngine === 'PAIRED_FEE_SCENARIO_LEDGER_V1');
  const fills = ROLES.map(() => []);
  const fillIds = ROLES.map(() => new Set());
  const ids = new Set();
  let latest = null;
  let latestAt = manifest.startedAt;
  let terminal = {status: 'UNKNOWN', at: null};
  let failed = false;
  let cycles = 0;
  for (const [index, event] of payload.events.entries()) {
    check();
    assert(event && typeof event.id === 'string' && event.id.length <= 256 &&
      event.id.length > 0 && !ids.has(event.id));
    ids.add(event.id);
    if (index === 0) {
      assert(event.id === 'paired-start' && event.type === 'start' &&
        event.at === manifest.startedAt);
      continue;
    }
    if (event.type === 'shared_observation') {
      assert(!failed && terminal.status === 'UNKNOWN' &&
        event.cycle === ++cycles && cycles <= 480 &&
        integer(event.observedAt) && event.observedAt === event.effectAt &&
        event.observedAt >= latestAt && event.observedAt <= exportedAt &&
        integer(event.decisionAt) && event.decisionAt <= event.effectAt &&
        roleArray(event.valuations) && roleArray(event.fills) &&
        roleArray(event.riskStates) && roleArray(event.decisions) &&
        integer(event.ticker?.receivedAt) &&
        integer(event.ticker?.requestStartedAt) &&
        event.decisionAt <= event.ticker.requestStartedAt &&
        event.ticker.requestStartedAt <= event.ticker.receivedAt &&
        event.ticker.receivedAt <= event.effectAt &&
        event.effectAt - event.ticker.receivedAt <= 10_000);
      for (const [roleIndex, group] of event.fills.entries()) {
        assert(Array.isArray(group.fills) && group.fills.length <= 2);
        for (const fill of group.fills) {
          assert(fill && typeof fill.id === 'string' && fill.id.length <= 256 &&
            !fillIds[roleIndex].has(fill.id) &&
            fill.side === (fills[roleIndex].length % 2 === 0 ? 'BUY' : 'SELL') &&
            integer(fill.grossCents) && fill.grossCents > 0 &&
            integer(fill.feeCents) &&
            fill.feeCents === Number((BigInt(fill.grossCents) * 20n + 5000n) / 10000n) &&
            integer(fill.quantitySat) && fill.quantitySat > 0 &&
            typeof fill.priceNano === 'string' && /^[1-9]\d{0,29}$/.test(fill.priceNano) &&
            fill.grossCents === Number((BigInt(fill.quantitySat) *
              BigInt(fill.priceNano) + 50_000_000_000_000n) / 100_000_000_000_000n) &&
            integer(fill.quoteReceivedAt) && fill.quoteReceivedAt <= event.effectAt &&
            integer(fill.signalAt) && fill.signalAt <= event.effectAt &&
            (fill.executionAt === undefined || fill.executionAt === event.effectAt));
          fillIds[roleIndex].add(fill.id);
          fills[roleIndex].push({
            side: fill.side, grossCents: fill.grossCents,
            feeCents: fill.feeCents, executionAt: event.effectAt
          });
        }
      }
      latest = event;
      latestAt = event.observedAt;
    } else if (event.type === 'shared_feed_failure') {
      assert(!failed && terminal.status === 'UNKNOWN' &&
        integer(event.at) && event.at >= latestAt && event.at <= exportedAt);
      failed = true;
      latestAt = event.at;
    } else if (event.type === 'terminal') {
      const report = event.report;
      assert(index === payload.events.length - 1 && event.id === 'paired-terminal' &&
        integer(event.at) && event.at >= latestAt && event.at <= exportedAt &&
        report?.schemaVersion === 'SPOT_PAPER_PAIRED_REPORT_V1' &&
        matchesIdentity(report, expectedIdentity) &&
        report.endedAt === event.at && report.startedAt === manifest.startedAt &&
        report.liveTrading === false && report.executionImpact === false &&
        report.autoPromotion === false &&
        ['COMPLETED_BOUNDED', 'INTERRUPTED_OR_STOPPED'].includes(report.outcome) &&
        (!failed || report.outcome === 'INTERRUPTED_OR_STOPPED'));
      terminal = {status: report.outcome === 'COMPLETED_BOUNDED' ?
        'TERMINAL_RECORDED' : 'INTERRUPTED_RECORDED', at: event.at};
      latestAt = event.at;
    } else {
      throw new Error('UNKNOWN');
    }
  }
  assert(latest !== null);
  const arms = latest.valuations.map((valuation, index) => {
    const roleFills = fills[index];
    const fees = roleFills.reduce((sum, fill) => sum + fill.feeCents, 0);
    const turnover = roleFills.reduce((sum, fill) => sum + fill.grossCents, 0);
    assert(valuation.startingCapitalCents === 100_000 &&
      (valuation.netEquityCents === null || Number.isSafeInteger(valuation.netEquityCents)) &&
      valuation.feesCents === fees && valuation.turnoverCents === turnover &&
      Array.isArray(valuation.openPositions) && valuation.openPositions.length <= 1 &&
      valuation.openPositions.length === roleFills.length % 2 &&
      integer(valuation.slippageCents) &&
      valuation.modeledCostsCents === fees + valuation.slippageCents);
    const risk = latest.riskStates[index];
    return {
      role: ROLES[index], modelId: expectedIdentity.models[index].modelId,
      startingCapitalCents: valuation.startingCapitalCents,
      netEquityCents: valuation.netEquityCents,
      netPnlCents: valuation.netEquityCents === null ? null :
        valuation.netEquityCents - valuation.startingCapitalCents,
      cashCents: null,
      bookedFeesCents: fees, modeledSlippageCents: valuation.slippageCents,
      hypotheticalExitFeeCents: null, hypotheticalExitSlippageCents: null,
      turnoverCents: turnover, exposureCents: valuation.exposureCents,
      sampledDrawdownCents: valuation.sampledDrawdownCents,
      unresolvedObservations: valuation.unresolvedObservations,
      inventoryStatus: valuation.openPositions.length ? 'OPEN' : 'FLAT',
      stopReason: risk.stopReason, tradingStoppedAt: risk.stoppedAt,
      fillCount: roleFills.length,
      completedRoundTripCount: Math.floor(roleFills.length / 2),
      recentFills: roleFills.slice(-MAX_RECENT_FILLS)
    };
  });
  return validateProgress({
    schemaVersion: PROGRESS_SCHEMA, identity: expectedIdentity,
    journalSequence: payload.sequence, journalSha256: sha256,
    classification: 'OBSERVED_CHECKPOINT',
    observedAt: latest.observedAt, valuationAt: latest.effectAt,
    exportedAt, latestEventAt: latestAt, terminal,
    currency: 'EUR', monetaryUnit: 'CENTS',
    assumptions: {feeBpsPerSide: 20, slippageBpsPerSide: 10,
      ratesVerified: false, feeBasis: 'EEA_SPOT_ONLY_TAKER_ASSUMPTION',
      netEquityIncludesCosts: true},
    arms
  }, expectedIdentity);
}

export async function exportProgress({
  runDirectory, expectedIdentity, now = Date.now, timeoutMs = 3000,
  signal, io = {open, lstat}
} = {}) {
  if (!validIdentity(expectedIdentity) || typeof runDirectory !== 'string' ||
      !isAbsolute(runDirectory) ||
      runDirectory.length > 4096 ||
      normalize(runDirectory).split('/').filter(Boolean).length > 128 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) {
    return {status: 'UNKNOWN', progress: null};
  }
  const deadline = performance.now() + timeoutMs;
  const check = () => assert(!signal?.aborted && performance.now() < deadline);
  const handles = new Set();
  let finished = false;
  let busy = false;
  const flags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
  const acquire = async (path, directory = false) => {
    const handle = await io.open(path, flags | (directory ? constants.O_DIRECTORY : 0));
    if (finished) { await handle.close(); throw new Error('UNKNOWN'); }
    handles.add(handle);
    check();
    return handle;
  };
  const task = (async () => {
    // Pin each directory component, refusing symlinks even in parent paths.
    let directory = await acquire('/', true);
    for (const part of normalize(runDirectory).split('/').filter(Boolean)) {
      directory = await acquire(`/proc/self/fd/${directory.fd}/${part}`, true);
    }
    const base = `/proc/self/fd/${directory.fd}`;
    const pendingAbsent = async () => {
      try {
        await io.lstat(`${base}/journal.pending`);
        busy = true;
        throw new Error('BUSY');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      check();
    };
    const directoryBefore = await directory.stat({bigint: true});
    await pendingAbsent();
    const readSnapshot = async () => {
      const file = await acquire(`${base}/journal.json`);
      const before = await file.stat({bigint: true});
      assert(before.isFile() && before.size > 0n &&
        before.size <= BigInt(MAX_JOURNAL_BYTES));
      const chunks = [];
      let total = 0;
      while (true) {
        check();
        const buffer = Buffer.alloc(Math.min(64 * 1024, MAX_JOURNAL_BYTES + 1 - total));
        const {bytesRead} = await file.read(buffer, 0, buffer.length, null);
        check();
        if (bytesRead === 0) break;
        total += bytesRead;
        assert(total <= MAX_JOURNAL_BYTES);
        chunks.push(buffer.subarray(0, bytesRead));
      }
      const after = await file.stat({bigint: true});
      if (!sameStat(before, after)) { busy = true; throw new Error('BUSY'); }
      assert(BigInt(total) === before.size);
      return {bytes: Buffer.concat(chunks), stat: after};
    };
    const first = await readSnapshot();
    await pendingAbsent();
    const second = await readSnapshot();
    await pendingAbsent();
    const directoryAfter = await directory.stat({bigint: true});
    if (!sameStat(first.stat, second.stat) ||
        !first.bytes.equals(second.bytes) ||
        !sameStat(directoryBefore, directoryAfter)) {
      busy = true;
      throw new Error('BUSY');
    }
    const text = new TextDecoder('utf-8', {fatal: true}).decode(first.bytes);
    const progress = projectJournal(JSON.parse(text), expectedIdentity, now(), check);
    check();
    assert(progress);
    return {status: 'EXPORTED', progress};
  })();
  let timer;
  let abort;
  const cancelled = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('UNKNOWN')), timeoutMs);
    abort = () => reject(new Error('UNKNOWN'));
    signal?.addEventListener('abort', abort, {once: true});
  });
  try {
    return await Promise.race([task, cancelled]);
  } catch {
    return {status: busy ? 'BUSY' : 'UNKNOWN', progress: null};
  } finally {
    finished = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    // Late opens close themselves; close existing handles without extending the deadline.
    for (const handle of handles) void handle.close().catch(() => {});
  }
}
