// Pure offline arithmetic only. No imports, I/O, state, orders or authorization.
const COST_KEYS = ['fee', 'spread', 'slippage', 'fundingBorrow'];
const PLAN_KEYS = ['schemaVersion', 'instrument', 'direction', 'quantity', 'entryPrice', 'stopPrice', 'exits', 'targetCosts', 'stopCosts'];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const exact = (value, keys) => plain(value)
  && Reflect.ownKeys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key) && Object.getOwnPropertyDescriptor(value, key)?.get === undefined
    && Object.getOwnPropertyDescriptor(value, key)?.set === undefined);
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

// Exact decimal comparison from each validated Number's canonical serialization.
// Finite Number exponents and at most ten portions bound the BigInt work.
const decimal = value => {
  const [mantissa, exponent = '0'] = value.toString().split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  return {n:BigInt(whole + fraction), e:Number(exponent) - fraction.length};
};
const add = (a,b) => {
  const e = Math.min(a.e,b.e);
  return {n:a.n * 10n ** BigInt(a.e-e) + b.n * 10n ** BigInt(b.e-e),e};
};
const negate = a => ({n:-a.n,e:a.e});
const multiply = (a,b) => ({n:a.n*b.n,e:a.e+b.e});
function exactQualification(plan, sign) {
  const entry = decimal(plan.entryPrice), quantity = decimal(plan.quantity);
  const signedQuantity = {n:quantity.n * BigInt(sign),e:quantity.e};
  let reward = {n:0n,e:0};
  for (const exit of plan.exits) {
    const change = add(decimal(exit.price),negate(entry));
    const weightedQuantity = multiply(signedQuantity,{n:BigInt(exit.portionBps),e:-4});
    reward = add(reward,multiply(weightedQuantity,change));
  }
  let risk = multiply(signedQuantity,add(entry,negate(decimal(plan.stopPrice))));
  for (const key of COST_KEYS) {
    reward = add(reward,negate(decimal(plan.targetCosts[key])));
    risk = add(risk,decimal(plan.stopCosts[key]));
  }
  return risk.n > 0n && add(reward,negate(multiply(risk,{n:3n,e:0}))).n >= 0n;
}

export function evaluateTradePlan(plan) {
  const result = {
    valid:false, errors:[], executionAuthorized:false, qualifiesPlannedCRV:false,
    grossReward:null, targetCostTotal:null, netReward:null, grossStopLoss:null,
    stopCostTotal:null, netRisk:null, plannedNetRewardRisk:null
  };
  const reject = message => { result.errors.push(message); return result; };
  if (!exact(plan, PLAN_KEYS)) return reject('plan must have exactly the declared JSON object fields');
  if (plan.schemaVersion !== 'MERIDIAN_LINEAR_TRADE_PLAN_V1') return reject('unsupported schemaVersion');
  if (!['LINEAR_SPOT', 'LINEAR_PERPETUAL'].includes(plan.instrument)) return reject('unsupported instrument');
  if (!['LONG', 'SHORT'].includes(plan.direction)) return reject('direction must be LONG or SHORT');
  if (plan.instrument === 'LINEAR_SPOT' && plan.direction !== 'LONG') return reject('spot short is unsupported');
  if (![plan.quantity, plan.entryPrice, plan.stopPrice].every(positive)) return reject('quantity and prices must be finite positive numbers');
  const sign = plan.direction === 'LONG' ? 1 : -1;
  const stopDistance = sign * (plan.entryPrice - plan.stopPrice);
  if (!positive(stopDistance)) return reject('stop must be strictly adverse to entry');
  if (!Array.isArray(plan.exits) || plan.exits.length < 1 || plan.exits.length > 10
    || Reflect.ownKeys(plan.exits).length !== plan.exits.length + 1) return reject('exits must be a dense array of 1..10 declared portions');
  let portions = 0;
  for (let index = 0; index < plan.exits.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(plan.exits, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return reject('exits must contain data values');
    const exit = descriptor.value;
    if (!exact(exit, ['price', 'portionBps']) || !positive(exit.price)
      || !Number.isInteger(exit.portionBps) || exit.portionBps <= 0 || exit.portionBps > 10000) return reject('each exit needs a positive price and integer portionBps in 1..10000');
    portions += exit.portionBps;
  }
  if (portions !== 10000) return reject('exit portions must total exactly 10000 bps including residual');
  for (const costs of [plan.targetCosts, plan.stopCosts]) {
    if (!exact(costs, COST_KEYS) || !COST_KEYS.every(key => nonnegative(costs[key]))) return reject('each scenario needs explicit finite nonnegative fee/spread/slippage/fundingBorrow');
  }

  let grossReward = 0;
  for (const exit of plan.exits) {
    const portionQuantity = plan.quantity * (exit.portionBps / 10000);
    if (!positive(portionQuantity)) return reject('portion quantity overflow or underflow');
    const priceChange = sign * (exit.price - plan.entryPrice);
    const portionPnl = portionQuantity * priceChange;
    if (!Number.isFinite(portionPnl) || (priceChange !== 0 && portionPnl === 0)) return reject('target arithmetic overflow or underflow');
    grossReward += portionPnl;
    if (!Number.isFinite(grossReward)) return reject('target total overflow');
  }
  const targetCostTotal = COST_KEYS.reduce((sum,key) => sum + plan.targetCosts[key], 0);
  const stopCostTotal = COST_KEYS.reduce((sum,key) => sum + plan.stopCosts[key], 0);
  const grossStopLoss = plan.quantity * stopDistance;
  const netReward = grossReward - targetCostTotal;
  const netRisk = grossStopLoss + stopCostTotal;
  if (![targetCostTotal,stopCostTotal,grossStopLoss,netReward,netRisk].every(Number.isFinite)
    || !positive(grossStopLoss) || !positive(netRisk)) return reject('payoff totals overflow or nonpositive finite risk');
  const requiredReward = 3 * netRisk;
  const plannedNetRewardRisk = netReward / netRisk;
  if (![requiredReward,plannedNetRewardRisk].every(Number.isFinite)) return reject('ratio or threshold arithmetic overflow');
  return {...result, valid:true, qualifiesPlannedCRV:exactQualification(plan,sign),
    grossReward,targetCostTotal,netReward,grossStopLoss,stopCostTotal,netRisk,plannedNetRewardRisk};
}
