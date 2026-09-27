export const RETRACEMENTS=[0,0.236,0.382,0.5,0.618,0.786,1];

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

export function buildFibLevels(lowInput,highInput,direction='UP'){
  const low=n(lowInput),high=n(highInput),dir=String(direction||'UP').toUpperCase();
  if(!finite(low)||!finite(high)||!(high>low))throw new Error('Swing High muss über Swing Low liegen');
  if(!['UP','DOWN'].includes(dir))throw new Error('Fib-Richtung muss UP oder DOWN sein');
  const span=high-low;
  const retrace=RETRACEMENTS.map(r=>({
    ratio:r,
    label:r===0?'0.000':r===1?'1.000':r.toFixed(3),
    kind:'retracement',
    price:dir==='UP'?high-span*r:low+span*r
  }));
  const ext=[1.272,1.414,1.618].map(r=>({
    ratio:r,
    label:'EXT '+r.toFixed(3),
    kind:'extension',
    price:dir==='UP'?high+span*(r-1):low-span*(r-1)
  }));
  return [...retrace,...ext].sort((a,b)=>b.price-a.price);
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
