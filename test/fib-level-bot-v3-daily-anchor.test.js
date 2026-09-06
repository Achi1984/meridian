import test from 'node:test';
import assert from 'node:assert/strict';
import {FIB_LEVEL_BOT_V3,evaluateFibV3,runFibDailyAnchorBot} from '../fib-level-bot-v3-daily-anchor.js';

const H4=4*3600000,DAY=86400000;
function fourHourly(days,price){const out=[];for(let d=0;d<days;d++)for(let h=0;h<6;h++){const p=price[d];out.push({t:d*DAY+h*H4,o:p,c:p,h:p+0.1,l:p-0.1})}return out}

test('V3 freezes pure FIB levels and daily pivot width',()=>{assert.equal(FIB_LEVEL_BOT_V3.pivotDays,2);assert.deepEqual(FIB_LEVEL_BOT_V3.ratios,[.382,.5,.618,.786]);assert.equal(FIB_LEVEL_BOT_V3.weight,.25);assert.equal(FIB_LEVEL_BOT_V3.costRate,.001)});
test('V3 is research-only with no execution impact',()=>{const x=runFibDailyAnchorBot([]);assert.equal(x.researchOnly,true);assert.equal(x.executionImpact,false)});
test('daily pivot cannot create a setup before two right days close',()=>{const bars=fourHourly(8,[10,9,8,9,12,11,10,9]);const before=runFibDailyAnchorBot(bars.filter(x=>x.t<7*DAY));const after=runFibDailyAnchorBot(bars);assert.equal(before.setups.length,0);assert.equal(after.setups.length,1);assert.ok(after.setups[0].createdAt>=7*DAY)});
test('V3 exposes all seven locked assets and excludes prospective period by contract',()=>{assert.equal(FIB_LEVEL_BOT_V3.symbols.length,7);assert.ok(Date.parse(FIB_LEVEL_BOT_V3.primaryStart)<Date.parse(FIB_LEVEL_BOT_V3.secondaryStart));assert.ok(Date.parse(FIB_LEVEL_BOT_V3.secondaryStart)<Date.parse(FIB_LEVEL_BOT_V3.holdoutStart))});
test('even a complete historical pass cannot permit promotion',()=>{const good={closedBaskets:40,profitFactor:1.2,expectancy:.1},primary={summary:{...good,closedBaskets:150},walkForward:[1,2,3].map(()=>({summary:good})),bySide:{LONG:good,SHORT:good},bySymbol:Object.fromEntries(FIB_LEVEL_BOT_V3.symbols.map(s=>[s,good])),byUniverseGroup:{CORE:good,EXPANSION:good},positiveNetRConcentrationPct:Object.fromEntries(FIB_LEVEL_BOT_V3.symbols.map(s=>[s,100/7]))},x=evaluateFibV3(primary,[{summary:good},{summary:good}],{summary:good});assert.equal(x.historicallyRobust,true);assert.equal(x.promotionPermitted,false)});
