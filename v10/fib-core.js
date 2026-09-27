export const RETRACEMENTS=[0,0.236,0.382,0.5,0.559,0.618,0.667,0.786,0.882,1];
export const EXTENSIONS=[1.272,1.414,1.618,1.809,2];
export const SK_CORRECTION=[0.5,0.559,0.618,0.667];
export const SK_TARGET=[1.618,1.809,2];

const finite=n=>Number.isFinite(Number(n));
const n=v=>Number(v);

export function detectSwing(rows,windowSize=90){
  const clean=(Array.isArray(rows)?rows:[]).filter(r=>finite(r?.high)&&finite(r?.low));
  const win=Math.max(10,Math.min(Number(windowSize)||90,clean.length));
  const slice=clean.slice(-win);
  if(slice.length<2)throw new Error('Zu wenige 4h-Kerzen für Swing-Erkennung');
  let low=Infinity,high=-Infinity,lowIndex=-1,highIndex=-1,lowTime=null,highTime=null;
  slice.forEach((r,i)=>{
    const lo=n(r.low),hi=n(r.high);
    if(lo<low){low=lo;lowIndex=i;lowTime=r.openTime??r.closeTime??null}
    if(hi>high){high=hi;highIndex=i;highTime=r.openTime??r.closeTime??null}
  });
  if(!(high>low))throw new Error('Ungültige Swing-Spanne');
  return{low,high,lowIndex,highIndex,lowTime,highTime,direction:lowIndex<highIndex?'UP':'DOWN',bars:slice.length};
}

export function detectOpposingChildSwing(rows,parent,windowSize=90){
  if(!parent)return null;
  const clean=(Array.isArray(rows)?rows:[]).filter(r=>finite(r?.high)&&finite(r?.low));
  const win=Math.max(10,Math.min(Number(windowSize)||90,clean.length));
  const slice=clean.slice(-win);
  const endIndex=parent.direction==='UP'?parent.highIndex:parent.lowIndex;
  const tail=slice.slice(Math.max(0,endIndex));
  if(tail.length<4)return null;
  try{
    const child=detectSwing(tail,tail.length);
    const expected=parent.direction==='UP'?'DOWN':'UP';
    if(child.direction!==expected)return null;
    return child;
  }catch{return null}
}

export function buildFibLevels(lowInput,highInput,direction='UP'){
  const low=n(lowInput),high=n(highInput),dir=String(direction||'UP').toUpperCase();
  if(!finite(low)||!finite(high)||!(high>low))throw new Error('Swing High muss über Swing Low liegen');
  if(!['UP','DOWN'].includes(dir))throw new Error('Fib-Richtung muss UP oder DOWN sein');
  const span=high-low;
  const retrace=RETRACEMENTS.map(r=>({
    ratio:r,
    label:r===0?'0.000':r===1?'1.000':r.toFixed(3),
    kind:'retracement',
    skCorrection:SK_CORRECTION.includes(r),
    price:dir==='UP'?high-span*r:low+span*r
  }));
  const ext=EXTENSIONS.map(r=>({
    ratio:r,
    label:'EXT '+r.toFixed(3),
    kind:'extension',
    skTarget:SK_TARGET.includes(r),
    price:dir==='UP'?high+span*(r-1):low-span*(r-1)
  }));
  return [...retrace,...ext].sort((a,b)=>b.price-a.price);
}

export function zoneForRatios(levels,ratios,label,side,kind){
  const rows=ratios.map(r=>(Array.isArray(levels)?levels:[]).find(x=>Math.abs(x.ratio-r)<1e-9)).filter(Boolean);
  if(!rows.length)return null;
  const prices=rows.map(x=>n(x.price)).filter(finite);
  if(!prices.length)return null;
  return{label,side,kind,low:Math.min(...prices),high:Math.max(...prices),levels:rows};
}

export function skCorrectionZone(low,high,direction){
  const dir=String(direction).toUpperCase(),levels=buildFibLevels(low,high,dir);
  return zoneForRatios(levels,SK_CORRECTION,dir==='UP'?'BULLISH TRENDWENDE':'BEARISH TRENDWENDE',dir==='UP'?'LONG':'SHORT','correction');
}

export function skTargetZone(low,high,direction){
  const dir=String(direction).toUpperCase(),levels=buildFibLevels(low,high,dir);
  return zoneForRatios(levels,SK_TARGET,dir==='UP'?'BULLISH TARGET':'BEARISH TARGET',dir==='UP'?'LONG':'SHORT','target');
}

export function skLongShortZones(low,high){
  return{
    long:skCorrectionZone(low,high,'UP'),
    short:skCorrectionZone(low,high,'DOWN')
  };
}

export function zoneOverlap(a,b){
  if(!a||!b)return null;
  const low=Math.max(n(a.low),n(b.low)),high=Math.min(n(a.high),n(b.high));
  if(!(high>=low))return null;
  const width=Math.max(0,high-low),small=Math.max(1e-12,Math.min(n(a.high)-n(a.low),n(b.high)-n(b.low)));
  return{low,high,width,overlapPct:width/small*100};
}

export function skDoubleAdvantage(parent,child){
  if(!parent||!child)return{candidate:false,side:null,parentZone:null,childTarget:null,overlap:null};
  const parentZone=skCorrectionZone(parent.low,parent.high,parent.direction);
  const childTarget=skTargetZone(child.low,child.high,child.direction);
  const overlap=zoneOverlap(parentZone,childTarget);
  const opposing=(parent.direction==='UP'&&child.direction==='DOWN')||(parent.direction==='DOWN'&&child.direction==='UP');
  return{
    candidate:!!(opposing&&overlap),
    side:parent.direction==='UP'?'LONG':'SHORT',
    parentZone,childTarget,overlap,
    label:opposing&&overlap?'DOPPELTER VORTEIL · KANDIDAT':'KEIN DOPPELTER VORTEIL'
  };
}

export function adjacentFibLevels(levels,currentInput){
  const current=n(currentInput);
  if(!finite(current))return{above:null,below:null};
  const rows=(Array.isArray(levels)?levels:[]).filter(x=>finite(x?.price));
  const above=rows.filter(x=>x.price>current).sort((a,b)=>a.price-b.price)[0]||null;
  const below=rows.filter(x=>x.price<current).sort((a,b)=>b.price-a.price)[0]||null;
  return{above,below};
}

export function fibDistancePct(level,currentInput){
  const current=n(currentInput);
  if(!level||!finite(level.price)||!(current>0))return null;
  return (n(level.price)-current)/current*100;
}

export function fibPlotPosition(priceInput,levels,currentInput){
  const price=n(priceInput),current=n(currentInput),vals=(Array.isArray(levels)?levels:[]).map(x=>n(x.price)).filter(finite);
  if(finite(current))vals.push(current);
  if(!finite(price)||!vals.length)return 50;
  let min=Math.min(...vals),max=Math.max(...vals);
  const span=Math.max(max-min,Math.abs(max)*0.001,1e-9),pad=span*0.06;
  min-=pad;max+=pad;
  return Math.max(0,Math.min(100,(max-price)/(max-min)*100));
}
