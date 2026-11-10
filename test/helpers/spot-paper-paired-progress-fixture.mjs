import {createHash} from 'node:crypto';
import {syntheticPairedEvaluatorFixture} from './spot-paper-paired-evaluator-fixture.mjs';

export function progressJournalFixture() {
  const {expectedIdentity, journal, report} =
    syntheticPairedEvaluatorFixture({modelPair: true});
  journal.events = journal.events.slice(0, 3);
  journal.sequence = journal.events.length;
  for (const event of journal.events.filter(item => item.type === 'shared_observation')) {
    event.valuations = report.arms.map(arm => ({
      role: arm.role, ...structuredClone(arm.valuation)
    }));
    for (const [index, group] of event.fills.entries()) {
      group.fills.forEach((fill, fillIndex) => Object.assign(fill, {
        id: `synthetic-${index}-${fillIndex}`,
        quantitySat: 1_000_000, priceNano: '1000000000000',
        quoteReceivedAt: event.observedAt, signalAt: event.decisionAt
      }));
    }
  }
  return {expectedIdentity, journal, report, now: 181_000};
}

export function journalEnvelope(payload) {
  return JSON.stringify({payload, sha256: createHash('sha256')
    .update(JSON.stringify(payload)).digest('hex')});
}
