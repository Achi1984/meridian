import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');
const json=p=>JSON.parse(read(p));
const must=(ok,msg)=>{if(!ok)throw new Error(msg)};

const data=json('data.json');
must(data.publicDataPolicy==='PRIVATE_BACKEND_REQUIRED','public data policy missing');
must(data.portfolio?.private===true,'portfolio must be private placeholder');
must(Array.isArray(data.portfolio?.holdings)&&data.portfolio.holdings.length===0,'public holdings must be empty');
must(Array.isArray(data.portfolio?.byVenue)&&data.portfolio.byVenue.length===0,'public venue balances must be empty');
must(data.pionexRisk?.private===true,'pionex risk must be private placeholder');
must(Array.isArray(data.pionexRisk?.bots)&&data.pionexRisk.bots.length===0,'public bot list must be empty');
must(data.exposure?.private===true,'exposure must be private placeholder');

const snapshot=json('pionex-bot-snapshot.json');
must(snapshot.private===true,'Pionex snapshot must be private placeholder');
must(Object.keys(snapshot.activeBots||{}).length===0,'public activeBots must be empty');
const guard=json('dynamic-liq-guard.json');
must(guard.private===true,'liquidation guard inputs must be private');
must(Object.keys(guard.activeBotInputs||{}).length===0,'public liquidation inputs must be empty');

const valuePatterns=[
  ['snapshotValueUsd',/"snapshotValueUsd"\s*:/],
  ['investmentUSDT',/"investmentUSDT"\s*:/],
  ['numeric investment',/"investment"\s*:\s*[0-9]/],
  ['dynamic margin',/"dynamicMargin(?:USDT)?"\s*:\s*[0-9]/],
  ['liquidation price',/"liquidationPrice"\s*:\s*[0-9]/],
  ['break even',/"breakEven"\s*:\s*[0-9]/],
  ['nonempty holdings',/"holdings"\s*:\s*\[\s*\{/],
  ['inline active Pionex bot',/MERIDIAN_PIONEX_SNAPSHOT=\{[^<]*"activeBots"\s*:\s*\{\s*"/s]
];
for(const file of ['data.json','pionex-bot-snapshot.json','dynamic-liq-guard.json','index.html']){
  const text=read(file);
  for(const [label,re] of valuePatterns)must(!re.test(text),`privacy leak candidate: ${label} in ${file}`);
}

console.log('MERIDIAN privacy check OK');
