/** Confirmed pivot/swing helpers. Confirmation occurs only after rightBars candles. */
export function confirmedSwings(candles,{leftBars=3,rightBars=3}={}){
  const out=[];
  for(let i=leftBars;i<candles.length-rightBars;i++){
    const c=candles[i];
    let hi=true,lo=true;
    for(let j=i-leftBars;j<=i+rightBars;j++){
      if(j===i) continue;
      if(candles[j].high>=c.high) hi=false;
      if(candles[j].low<=c.low) lo=false;
    }
    if(hi) out.push({type:"high",index:i,confirmedAt:i+rightBars,ts:c.ts,price:c.high});
    if(lo) out.push({type:"low",index:i,confirmedAt:i+rightBars,ts:c.ts,price:c.low});
  }
  return out.sort((a,b)=>a.confirmedAt-b.confirmedAt);
}

export function bullishFibCycles(candles,opts={}){
  const swings=confirmedSwings(candles,opts), cycles=[];
  let lastLow=null;
  for(const s of swings){
    if(s.type==="low"){ lastLow=s; continue; }
    if(s.type==="high" && lastLow && s.index>lastLow.index && s.price>lastLow.price){
      cycles.push({swingLow:lastLow.price,swingHigh:s.price,startIndex:s.confirmedAt+1,lowTs:lastLow.ts,highTs:s.ts,confirmedAt:candles[s.confirmedAt]?.ts});
      lastLow=null;
    }
  }
  return cycles;
}
