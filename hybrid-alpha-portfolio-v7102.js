// MERIDIAN v7.102 — decision-time correlation-cluster portfolio allocator.
// RESEARCH ONLY. Frozen v7.97 opportunities remain; risk may only decrease.
export const HYBRID_ALPHA_V7102_PORTFOLIO=Object.freeze({clusterRiskBudget:1,signedCorrelationThreshold:.70});
const round=(v,d=6)=>Number.isFinite(v)?Math.round(v*10**d)/10**d:null;
const sideSign=s=>String(s).toUpperCase()==='SHORT'?-1:1;

export function applyCorrelationClusterBudget(rows=[],correlationFor=()=>null,config=HYBRID_ALPHA_V7102_PORTFOLIO){
  const bundles=new Map();
  for(const row of rows){const key=String(row.timestamp);if(!bundles.has(key))bundles.set(key,[]);bundles.get(key).push(row)}
  const transformed=new Map();
  for(const [timestamp,bundle] of bundles){
    const parent=bundle.map((_,i)=>i),find=i=>parent[i]===i?i:(parent[i]=find(parent[i])),join=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent[b]=a};
    const missing=new Set();
    for(let i=0;i<bundle.length;i++)for(let j=i+1;j<bundle.length;j++){
      const rawCorrelation=correlationFor(timestamp,bundle[i].symbol,bundle[j].symbol),corr=rawCorrelation==null?null:Number(rawCorrelation);
      if(!Number.isFinite(corr)){missing.add(i);missing.add(j);continue}
      if(sideSign(bundle[i].side)*sideSign(bundle[j].side)*corr>=config.signedCorrelationThreshold)join(i,j);
    }
    const unknown=[...missing];for(let i=1;i<unknown.length;i++)join(unknown[0],unknown[i]);
    const clusters=new Map();for(let i=0;i<bundle.length;i++){const root=find(i);if(!clusters.has(root))clusters.set(root,[]);clusters.get(root).push(i)}
    for(const members of clusters.values()){
      const incoming=members.reduce((a,i)=>a+Math.max(0,Number(bundle[i].riskMultiplier)||0),0);
      const scale=incoming>config.clusterRiskBudget?config.clusterRiskBudget/incoming:1;
      for(const i of members){const row=bundle[i],risk=Math.max(0,Number(row.riskMultiplier)||0);transformed.set(row,{...row,riskMultiplier:round(risk*scale,3),grossR:round(Number(row.grossR)*scale,3),costR:round(Number(row.costR)*scale,3),netR:round(Number(row.netR)*scale,3),portfolioClusterSize:members.length,portfolioClusterIncomingRisk:round(incoming),portfolioClusterOutgoingRisk:round(incoming*scale),portfolioRiskScale:round(scale),portfolioScaled:scale<1,portfolioCorrelationMissing:missing.has(i)})}
    }
  }
  return rows.map(row=>transformed.get(row));
}
