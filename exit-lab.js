// MERIDIAN v7.48 — Exit Lab V1
// Research-only exit policy simulator. No live/Paper execution effects.

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const round=(v,d=4)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;
const dir=side=>String(side).toUpperCase()==='SHORT'?-1:1;
const hit=(side,level,c)=>side==='LONG'?c.high>=level:c.low<=level;
const hitStop=(side,level,c)=>side==='LONG'?c.low<=level:c.high>=level;

export const EXIT_LAB_VERSION='7.48-EXIT-LAB-V1';
export const EXIT_MODELS=Object.freeze({
  A_CURRENT:{id:'A_CURRENT',label:'Current Full TP1',tp1ClosePct:100,runner:'NONE'},
  B_PROTECTED:{id:'B_PROTECTED',label:'Protected Runner',tp1ClosePct:50,runner:'TP2',beAfterTp1:true},
  C_ATR_RUNNER:{id:'C_ATR_RUNNER',label:'ATR Runner',tp1ClosePct:50,runner:'ATR',beAfterTp1:true,atrTrailMult:1.2},
  D_ADAPTIVE:{id:'D_ADAPTIVE',label:'Adaptive Runner',runner:'ADAPTIVE',beAfterTp1:true}
});

function adaptiveSpec(regime){
  const r=String(regime||'UNKNOWN').toUpperCase();
  if(['TREND_UP','TREND_DOWN','BULL','BEAR','EXPANSION'].includes(r))return{tp1ClosePct:30,atrTrailMult:1.5,protectR:.25};
  if(['RANGE'].includes(r))return{tp1ClosePct:65,atrTrailMult:.9,protectR:.5};
  if(['CHOP','TRANSITION'].includes(r))return{tp1ClosePct:60,atrTrailMult:.8,protectR:.5};
  return{tp1ClosePct:50,atrTrailMult:1.1,protectR:.35};
}

function costR(cfg,risk){
  const feeBps=Number(cfg.feeBps||0),slippageBps=Number(cfg.slippageBps||0);
  const entry=Number(cfg.entry),r=Math.abs(Number(risk)||0);
  if(!(entry>0&&r>0))return 0;
  return ((feeBps*2+slippageBps*2)/10000)*entry/r;
}

function priceAtR(entry,riskR,side,r){return entry+dir(side)*riskR*r;}
function rAtPrice(entry,riskR,side,price){return (price-entry)*dir(side)/riskR;}

function trailStop(side,peakFavorable,atr,mult,entry,bePrice){
  if(!(Number.isFinite(peakFavorable)&&atr>0))return bePrice;
  const raw=side==='LONG'?peakFavorable-atr*mult:peakFavorable+atr*mult;
  return side==='LONG'?Math.max(bePrice,raw):Math.min(bePrice,raw);
}

export function simulateExitModel(trade,candles,modelId='B_PROTECTED',opts={}){
  const side=String(trade.side||'').toUpperCase();
  if(!['LONG','SHORT'].includes(side))throw new Error('Exit Lab requires LONG or SHORT');
  const entry=Number(trade.entry),sl0=Number(trade.sl),tp1=Number(trade.tp1),tp2=Number(trade.tp2);
  const initialRisk=Math.abs(entry-sl0);
  if(!(entry>0&&initialRisk>0&&tp1>0))throw new Error('Exit Lab invalid entry/sl/tp1');
  const model=EXIT_MODELS[modelId];if(!model)throw new Error('Unknown Exit Lab model '+modelId);
  const cfg={feeBps:Number(opts.feeBps??5),slippageBps:Number(opts.slippageBps??3),entry};
  const costsR=costR(cfg,initialRisk);
  const beR=costsR;
  const bePrice=priceAtR(entry,initialRisk,side,beR);
  const spec=modelId==='D_ADAPTIVE'?{...model,...adaptiveSpec(trade.regimeType||trade.regime||trade.challengerRegime)}:model;
  let remaining=1,realizedR=0,tp1Hit=false,tp1At=null,stop=sl0,peakFavorable=entry,maxOpenR=0,runnerExit=null,runnerReason=null;
  let tp1ThenBe=false,runnerTp2AfterBe=false;

  const rows=Array.isArray(candles)?candles:[];
  for(let i=0;i<rows.length&&remaining>1e-9;i++){
    const c=rows[i];if(!(Number(c.high)>0&&Number(c.low)>0))continue;
    const fav=side==='LONG'?Number(c.high):Number(c.low);
    peakFavorable=side==='LONG'?Math.max(peakFavorable,fav):Math.min(peakFavorable,fav);
    maxOpenR=Math.max(maxOpenR,rAtPrice(entry,initialRisk,side,peakFavorable));

    // Conservative same-candle ordering: active stop is checked before targets.
    if(hitStop(side,stop,c)){
      const r=rAtPrice(entry,initialRisk,side,stop)-costsR;
      realizedR+=remaining*r;runnerExit=stop;runnerReason=tp1Hit?'BE_OR_TRAIL':'SL';
      if(tp1Hit&&Math.abs(r)<=Math.max(.15,costsR+.05))tp1ThenBe=true;
      remaining=0;break;
    }

    if(!tp1Hit&&hit(side,tp1,c)){
      tp1Hit=true;tp1At=c.ts??i;
      const closePct=clamp(Number(spec.tp1ClosePct||100),0,100)/100;
      const closeQty=Math.min(remaining,closePct);
      realizedR+=closeQty*(rAtPrice(entry,initialRisk,side,tp1)-costsR);
      remaining-=closeQty;
      if(remaining<=1e-9){runnerReason='TP1_FULL';runnerExit=tp1;break;}
      stop=bePrice;
    }

    if(tp1Hit&&remaining>1e-9){
      if(spec.runner==='TP2'&&tp2>0&&hit(side,tp2,c)){
        realizedR+=remaining*(rAtPrice(entry,initialRisk,side,tp2)-costsR);runnerExit=tp2;runnerReason='TP2';remaining=0;break;
      }
      if(['ATR','ADAPTIVE'].includes(spec.runner)){
        const atr=Number(c.atr||trade.atr||initialRisk/1.6);
        const mult=Number(spec.atrTrailMult||1.2);
        const tr=trailStop(side,peakFavorable,atr,mult,entry,bePrice);
        stop=side==='LONG'?Math.max(stop,tr):Math.min(stop,tr);
        if(tp2>0&&hit(side,tp2,c))runnerTp2AfterBe=true;
      }
    }
  }

  if(remaining>1e-9&&rows.length){
    const c=rows[rows.length-1],px=Number(c.close||entry);
    realizedR+=remaining*(rAtPrice(entry,initialRisk,side,px)-costsR);runnerExit=px;runnerReason='END_OF_SAMPLE';remaining=0;
  }
  const givebackR=Math.max(0,maxOpenR-realizedR);
  return{modelId,label:model.label,realizedR:round(realizedR,4),maxOpenR:round(maxOpenR,4),givebackR:round(givebackR,4),tp1Hit,tp1At,beAfterTp1:!!spec.beAfterTp1,bePrice:round(bePrice,8),costBufferR:round(costsR,4),runnerReason,runnerExit:round(runnerExit,8),tp1ThenBe,runnerTp2Touched:runnerTp2AfterBe,remaining:0,researchOnly:true,executionImpact:false};
}

export function compareExitModels(trade,candles,opts={}){
  const models=Object.keys(EXIT_MODELS).map(id=>simulateExitModel(trade,candles,id,opts));
  const byId=Object.fromEntries(models.map(x=>[x.modelId,x]));
  const best=models.reduce((a,b)=>b.realizedR>a.realizedR?b:a,models[0]);
  return{version:EXIT_LAB_VERSION,researchOnly:true,executionImpact:false,models:byId,bestByRealizedR:best.modelId};
}

export function aggregateExitLab(rows=[]){
  const ids=Object.keys(EXIT_MODELS),out={};
  for(const id of ids){
    const xs=rows.map(x=>x?.models?.[id]).filter(Boolean),n=xs.length;
    const sum=k=>xs.reduce((a,x)=>a+Number(x[k]||0),0);
    out[id]={trades:n,avgR:n?round(sum('realizedR')/n,3):null,totalR:round(sum('realizedR'),3),avgGivebackR:n?round(sum('givebackR')/n,3):null,tp1Rate:n?round(xs.filter(x=>x.tp1Hit).length/n*100,1):null,tp1ToBeStopRate:n?round(xs.filter(x=>x.tp1ThenBe).length/n*100,1):null,tp2TouchAfterTp1Rate:n?round(xs.filter(x=>x.runnerTp2Touched||x.runnerReason==='TP2').length/n*100,1):null};
  }
  return{version:EXIT_LAB_VERSION,researchOnly:true,executionImpact:false,models:out};
}
