export const RETRACEMENTS=[0,0.236,0.382,0.5,0.559,0.618,0.667,0.786,1];
export const EXTENSIONS=[1.272,1.414,1.618,2];

const finite=n=>Number.isFinite(Number(n));
const n=v=>Number(v);
const normZone=(a,b,meta={})=>({low:Math.min(n(a),n(b)),high:Math.max(n(a),n(b)),...meta});

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
  const ext=EXTENSIONS.map(r=>({
    ratio:r,
    label:'EXT '+r.toFixed(3),
    kind:'extension',
    price:dir==='UP'?high+span*(r-1):low-span*(r-1)
  }));
  return [...retrace,...ext].sort((a,b)=>b.price-a.price);
}

export function buildSkZones(lowInput,highInput,direction='UP'){
  const low=n(lowInput),high=n(highInput),dir=String(direction||'UP').toUpperCase();
  if(!finite(low)||!finite(high)||!(high>low))throw new Error('Ungültige SK Swing-Spanne');
  const span=high-low;
  const bullTurn=normZone(high-span*.667,high-span*.5,{key:'BULL_TURN',side:'LONG',label:'BULL TURN',basis:'KL 0.500–0.667'});
  const bearTurn=normZone(low+span*.5,low+span*.667,{key:'BEAR_TURN',side:'SHORT',label:'BEAR TURN',basis:'KL 0.500–0.667'});
  const bullTarget=normZone(high+span*.618,high+span,{key:'BULL_TARGET',side:'SHORT_WATCH',label:'UP TARGET',basis:'EXT 1.618–2.000'});
  const bearTarget=normZone(low-span,low-span*.618,{key:'BEAR_TARGET',side:'LONG_WATCH',label:'DOWN TARGET',basis:'EXT 1.618–2.000'});
  const activeTurn=dir==='UP'?bullTurn:bearTurn,activeTarget=dir==='UP'?bullTarget:bearTarget;
  return{bullTurn,bearTurn,bullTarget,bearTarget,activeTurn,activeTarget,direction:dir};
}

export function zoneOverlap(a,b){
  if(!a||!b)return null;
  const low=Math.max(n(a.low),n(b.low)),high=Math.min(n(a.high),n(b.high));
  if(!(high>low))return null;
  const width=high-low,den=Math.max(1e-12,Math.min(n(a.high)-n(a.low),n(b.high)-n(b.low)));
  return{low,high,width,coverage:width/den};
}

export function buildSkConfluences(primary,contexts=[]){
  if(!primary)return[];
  const p=buildSkZones(primary.low,primary.high,primary.direction);
  const out=[];
  for(const c of Array.isArray(contexts)?contexts:[]){
    if(!c||!(n(c.high)>n(c.low)))continue;
    const distinct=Math.abs(n(c.low)-n(primary.low))/Math.max(n(primary.low),1e-9)>.0025||
      Math.abs(n(c.high)-n(primary.high))/Math.max(n(primary.high),1e-9)>.0025;
    if(!distinct)continue;
    const z=buildSkZones(c.low,c.high,c.direction);
    const checks=[
      ['BULL',p.bullTurn,z.bullTurn,'KL × KL'],
      ['BULL',p.bullTurn,z.bearTarget,'KL × OPP TARGET'],
      ['BEAR',p.bearTurn,z.bearTurn,'KL × KL'],
      ['BEAR',p.bearTurn,z.bullTarget,'KL × OPP TARGET']
    ];
    for(const [side,a,b,type] of checks){
      const ov=zoneOverlap(a,b);
      if(!ov||ov.coverage<.15)continue;
      out.push({...ov,side,type,contextWindow:c.window??null,contextDirection:c.direction,contextLow:c.low,contextHigh:c.high});
    }
  }
  return out.sort((a,b)=>b.coverage-a.coverage||b.width-a.width);
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
