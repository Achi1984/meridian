import fs from "node:fs";
import path from "node:path";

const root=process.cwd();

function readJson(p){return JSON.parse(fs.readFileSync(path.join(root,p),"utf8"))}
function writeJson(p,v){fs.writeFileSync(path.join(root,p),JSON.stringify(v,null,2)+"\n")}

const data=readJson("data.json");
data.appVersion="7.33";
data.publicDataPolicy="PRIVATE_BACKEND_REQUIRED";
data.portfolio={
  private:true,total:null,eurApprox:null,coveragePct:null,assetsCount:null,custodiansCount:null,
  largestPosition:null,byVenue:[],topPositions:[],performance24hPct:null,performance24hUsd:null,
  bestPerformer:null,worstPerformer:null,volatility24hPct:null,holdings:[],manualVenueBalances:[],
  snapshotAt:null,snapshotSpotValueUsd:null,snapshotTotalIncludingPionexUsd:null,
  snapshotPolicy:"Private portfolio data is served only by the authenticated MERIDIAN backend."
};
data.pionexRisk={
  private:true,status:"PRIVATE_BACKEND_REQUIRED",snapshotAt:null,activeCount:null,closedCount:null,
  bots:[],closedBots:[],note:"Private bot data removed from public repository."
};
data.exposure={
  private:true,status:"PRIVATE_BACKEND_REQUIRED",snapshotAt:null,
  note:"Private exposure data removed from public repository."
};
data.cashflows={
  private:true,status:"PRIVATE_BACKEND_REQUIRED",items:[],
  note:"Private cashflow data removed from public repository."
};
if(data.manualVenueBalances) data.manualVenueBalances=[];

// Remove historical user-specific trading/risk snapshots that accumulated in data.json.
// General model policies remain public; current/private state comes from /api/private/dashboard after unlock.
const privateLegacyKeys=[
  "botSnapshot","botCapitalUSDT","botRisk","rotationEngine","slInvalidationEngine",
  "pionexCanonicalBots","pionexBotSnapshot","botRiskDistribution","dualBotHedge","dualBtcHedge",
  "pionexRealityCalibration","realitySSOT","pionexReality","singleBtcHedge",
  "btcRiskSnapshot","futuresRiskIntelligence"
];
for(const k of privateLegacyKeys) delete data[k];

if(data.gridModule&&typeof data.gridModule==="object") data.gridModule.activeBots=[];
if(data.decisionQuality&&typeof data.decisionQuality==="object"){
  delete data.decisionQuality.btcLong;
  delete data.decisionQuality.btcShort;
}
if(data.capitalReleaseEngine&&typeof data.capitalReleaseEngine==="object"){
  data.capitalReleaseEngine.theoreticalLongCapacityUSD=null;
}
if(data.beProtectionVisual&&typeof data.beProtectionVisual==="object"){
  data.beProtectionVisual.protectedBots=[];
  data.beProtectionVisual.closedProtectedBots=[];
}
if(data.recoveryIntelligence&&typeof data.recoveryIntelligence==="object") data.recoveryIntelligence.bot=null;
if(data.vision2?.portfolioRead){
  data.vision2.portfolioRead={private:true,note:"Private portfolio context is available only after authenticated unlock."};
}
if(data.ssot&&typeof data.ssot==="object") data.ssot.legacyBotIdsRemoved=[];

writeJson("data.json",data);

writeJson("pionex-bot-snapshot.json",{
  version:"7.33",private:true,status:"PRIVATE_BACKEND_REQUIRED",
  activeCount:null,activeBots:{},priority:[],
  sourcePolicy:"Private bot snapshots are stored only in the authenticated MERIDIAN backend."
});

const guard=readJson("dynamic-liq-guard.json");
guard.version="7.33";
guard.private=true;
guard.activeBotInputs={};
guard.note="Private live bot inputs removed from public repository. Policy-only module remains public.";
writeJson("dynamic-liq-guard.json",guard);

const indexPath=path.join(root,"index.html");
let html=fs.readFileSync(indexPath,"utf8");
const replacement='window.MERIDIAN_PIONEX_SNAPSHOT={"version":"7.33","private":true,"status":"PRIVATE_BACKEND_REQUIRED","activeCount":null,"activeBots":{},"priority":[],"sourcePolicy":"Authenticated backend only"};</script>';
const re=/window\.MERIDIAN_PIONEX_SNAPSHOT=\{.*?\};<\/script>/s;
if(!re.test(html)) throw new Error("MERIDIAN_PIONEX_SNAPSHOT marker not found");
html=html.replace(re,replacement);
fs.writeFileSync(indexPath,html);

const valueChecks=[
  ['data holdings',/"holdings"\s*:\s*\[\s*\{/],
  ['snapshot values',/"snapshotValueUsd"\s*:/],
  ['pionex investmentUSDT',/"investmentUSDT"\s*:/],
  ['pionex investment',/"investment"\s*:\s*[0-9]/],
  ['pionex dynamic margin',/"dynamicMargin(?:USDT)?"\s*:\s*[0-9]/],
  ['pionex liquidation',/"liquidationPrice"\s*:\s*[0-9]/],
  ['pionex break even',/"breakEven"\s*:\s*[0-9]/],
  ['inline active bot',/MERIDIAN_PIONEX_SNAPSHOT=\{[^<]*"activeBots"\s*:\s*\{\s*"/s]
];
const jsonIdentityChecks=[
  ['private bot id',/"(?:BTC-S30|BTC-L100|HBAR-L3|XRP-L5)"/],
  ['pionex screenshot marker',/PIONEX SCREENSHOT/i]
];
const targets=["data.json","pionex-bot-snapshot.json","dynamic-liq-guard.json","index.html"];
for(const f of targets){
  const text=fs.readFileSync(path.join(root,f),"utf8");
  for(const [name,rex] of valueChecks){
    if(rex.test(text)) throw new Error(`privacy check failed: ${name} in ${f}`);
  }
  if(f!=="index.html"){
    for(const [name,rex] of jsonIdentityChecks){
      if(rex.test(text)) throw new Error(`privacy check failed: ${name} in ${f}`);
    }
  }
}
console.log("MERIDIAN public snapshot scrub complete");
