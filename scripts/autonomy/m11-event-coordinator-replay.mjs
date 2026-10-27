import {createSyntheticReplay, simulateReplay} from './m11-event-coordinator.mjs';

const scenario = createSyntheticReplay();
const replay = simulateReplay(scenario.events, {initialState: scenario.initialState});
console.log(JSON.stringify({
  result: replay.outcome,
  stopReason: replay.stopReason,
  phase: replay.state.phase,
  nextAllowedAction: replay.state.nextAllowedAction,
  events: replay.inputEvents,
  transitions: replay.state.transitionCount,
  payloadBytes: replay.payloadBytes,
  offlineOnly: replay.offlineOnly,
  externalEffects: replay.externalEffects
}, null, 2));
if (replay.outcome !== 'REPLAY_COMPLETE' || replay.state.phase !== 'COMPLETE') process.exitCode = 1;
