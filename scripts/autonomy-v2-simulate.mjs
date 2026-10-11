// Offline-only synthetic Autonomy V2 simulation. No I/O, dispatch, GitHub writes or timers.
import { transition, STATES } from './autonomy-v2-state.mjs';

export function simulate(events, initial, limits = {}) {
  if (!Array.isArray(events) || !initial || !Number.isSafeInteger(limits.maxEvents ?? 100))
    throw Error('INVALID_SIMULATION');
  const maxEvents = limits.maxEvents ?? 100;
  if (maxEvents < 0 || events.length > maxEvents) throw Error('SIMULATION_BUDGET_EXHAUSTED');
  let task = structuredClone(initial);
  const journal = [];
  for (const event of events) {
    try {
      const next = transition(task, event);
      journal.push(Object.freeze({ opId: event.opId, from: task.state, to: next.state, revision: next.revision }));
      task = next;
    } catch (error) {
      journal.push(Object.freeze({ opId: event?.opId ?? null, from: task.state, rejected: String(error.message) }));
      return Object.freeze({ task: Object.freeze(task), journal: Object.freeze(journal), stopped: true });
    }
  }
  return Object.freeze({ task: Object.freeze(task), journal: Object.freeze(journal), stopped: false });
}
