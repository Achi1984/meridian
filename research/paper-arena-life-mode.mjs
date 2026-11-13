export const LIFE_MODE_SCHEMA = 'MERIDIAN_PAPER_ARENA_LIFE_MODE_V1';
export const LIFE_UNIT_CENTS = 100_000;

const MAX_SNAPSHOTS = 10_000;
const isInt = value => Number.isSafeInteger(value);
const fail = reason => ({ status: 'UNKNOWN', reason, authority: { paper: false, live: false, promotion: false } });

export function evaluateLifeMode(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('INVALID_INPUT');
  if (input.schemaVersion !== LIFE_MODE_SCHEMA || input.currency !== 'USD' ||
      input.monetaryUnit !== 'CENTS' || typeof input.runId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(input.runId) ||
      !Array.isArray(input.snapshots) || input.snapshots.length === 0 ||
      input.snapshots.length > MAX_SNAPSHOTS) return fail('INVALID_CONTRACT');

  let previousAt = -1;
  let peak = null;
  let maxDrawdown = 0;
  let minimum = null;
  let maximum = null;
  let previousLives = null;
  let transitions = 0;
  let gained = 0;
  let lost = 0;
  const lifeSeries = [];

  for (const snapshot of input.snapshots) {
    if (!snapshot || !isInt(snapshot.at) || snapshot.at < 0 ||
        snapshot.at <= previousAt || !isInt(snapshot.equityCents) ||
        snapshot.equityCents < 0) return fail('INVALID_SNAPSHOT');

    previousAt = snapshot.at;
    const equity = snapshot.equityCents;
    const lives = Math.floor(equity / LIFE_UNIT_CENTS);

    if (previousLives !== null) {
      if (lives > previousLives) gained += lives - previousLives;
      if (lives < previousLives) lost += previousLives - lives;
      if (lives !== previousLives) transitions++;
    }

    previousLives = lives;
    if (peak === null || equity > peak) peak = equity;
    const drawdown = peak - equity;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    if (minimum === null || equity < minimum) minimum = equity;
    if (maximum === null || equity > maximum) maximum = equity;
    lifeSeries.push({ at: snapshot.at, equityCents: equity, lives });
  }

  const startingLives = lifeSeries[0].lives;
  const currentLives = lifeSeries.at(-1).lives;
  const maxLives = Math.max(...lifeSeries.map(point => point.lives));
  const minLives = Math.min(...lifeSeries.map(point => point.lives));

  return {
    status: 'EVALUATED',
    schemaVersion: LIFE_MODE_SCHEMA,
    runId: input.runId,
    currency: 'USD',
    monetaryUnit: 'CENTS',
    lifeUnitCents: LIFE_UNIT_CENTS,
    startingLives,
    currentLives,
    maxLives,
    minLives,
    livesGained: gained,
    livesLost: lost,
    lifeTransitions: transitions,
    minimumEquityCents: minimum,
    maximumEquityCents: maximum,
    maxDrawdownCents: maxDrawdown,
    lifeSeries,
    authority: { paper: false, live: false, promotion: false }
  };
}
