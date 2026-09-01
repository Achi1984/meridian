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

const checks=[
  ['data holdings',/"holdings"\s*:\s*\[\s*\{/],
  ['snapshot values',/"snapshotValueUsd"\s*:/],
  ['pionex investment',/"investmentUSDT"\s*:/],
  ['pionex liquidation',/"liquidationPrice"\s*:\s*[0-9]/],
  ['inline active bot',/MERIDIAN_PIONEX_SNAPSHOT=\{[^<]*"activeBots"\s*:\s*\{\s*"/s]
];
const targets=["data.json","pionex-bot-snapshot.json","dynamic-liq-guard.json","index.html"];
for(const f of targets){
  const text=fs.readFileSync(path.join(root,f),"utf8");
  for(const [name,rex] of checks){
    if(rex.test(text)) throw new Error(`privacy check failed: ${name} in ${f}`);
  }
}
console.log("MERIDIAN public snapshot scrub complete");
