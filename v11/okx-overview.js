import {okxStatus} from './paper-status.js?v=B20-M11-FIX6';

const source='https://api.github.com/repos/Achi1984/meridian/contents/';
const amount=new Intl.NumberFormat('de-AT',{maximumFractionDigits:6,signDisplay:'exceptZero'});
const localTime=new Intl.DateTimeFormat('de-AT',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Vienna'});
const phases={planned:'Geplant',running:'Läuft',final:'Beendet'};

function number(value){
  if((typeof value!=='number' && typeof value!=='string') || String(value).trim()==='' || !Number.isFinite(Number(value)))throw Error('number');
  return Number(value);
}
function count(value){
  if(!Number.isSafeInteger(value)||value<0)throw Error('count');
  return value;
}
function row(name,pnl,currency,detail){
  const div=document.createElement('div');
  div.style.cssText='display:flex;flex-wrap:wrap;justify-content:space-between;gap:1px 8px;padding:6px 0;border-bottom:1px solid var(--line,#334155)';
  const title=document.createElement('strong');
  title.textContent=name;
  const value=document.createElement('strong');
  value.textContent=amount.format(pnl)+' '+currency;
  value.className=pnl>0?'paper-gain':pnl<0?'paper-loss':'';
  const note=document.createElement('small');
  note.style.flexBasis='100%';
  note.textContent=detail;
  div.append(title,value,note);
  return div;
}
function demoRows(report){
  const sessions=Object.values(report.sessions);
  return ['LONG','SHORT'].map(side=>{
    const trades=sessions.filter(t=>t.signal===side);
    const closed=trades.filter(t=>t.state==='closed'&&t.demoFilled);
    const pendingFunding=closed.some(t=>t.demoNetUSDC==null);
    const pnl=closed.reduce((s,t)=>s+number(pendingFunding?t.demoAfterFees:t.demoNetUSDC),0);
    const open=trades.filter(t=>t.state!=='closed'&&t.demoFilled).length;
    const pending=trades.some(t=>t.state==='reserved'||t.state==='exit_due');
    const completed=trades.filter(t=>t.state==='closed');
    const modelResult=field=>amount.format(completed.reduce((sum,t)=>sum+number(t[field]),0));
    return row(side==='LONG'?'Long':'Short',pnl,'USDC',
      (pending?'Orderabgleich · ':'')+open+' offen · '+closed.length+' geschlossen'+(pendingFunding?' · vor Funding':'')+
      (completed.length?' · Paper Basis '+modelResult('modelBase')+' / Filter '+modelResult('modelFiltered')+' USDC':''));
  });
}
function gridRows(report){
  return [['fixed','Fest'],['adaptive','Adaptiv'],['model','KI-Filter']].map(([key,name])=>{
    const a=report.accounts[key];
    return row(name,number(a.equity)-1000,'USDT',count(a.fills)+' Ausführungen'+
      (Number.isFinite(a.vsHold)?' · '+amount.format(a.vsHold)+' USDT ggü. Halten':''));
  });
}
function shortRows(report){
  return [['historyFilter','Mit Historienfilter'],['control','Ohne Historienfilter']].map(([key,name])=>{
    const a=report[key];
    return row(name,number(a.equity)-1000,'USDT',count(a.open)+' offen · '+count(a.closed)+' geschlossen');
  });
}

export function createOkxOverview(fibonacci){
  const root=document.createElement('section');
  root.id='okx-overview';
  root.setAttribute('aria-label','OKX-Tradingübersicht');
  const heading=document.createElement('h2');
  heading.textContent='OKX-Tradingübersicht';
  root.append(heading,fibonacci);
  const groups=[
    ['BTC Long/Short · Demo','okx-filter-demo',demoRows,90],
    ['BTC-Grid · Paper','btc-grid-paper',gridRows,45],
    ['Short nach Fehlausbruch · Paper','okx-rejection-paper',shortRows,360]
  ];
  const updates=groups.map(([title,file,render,maxMinutes])=>{
    const section=document.createElement('section');
    section.className='card';
    const name=document.createElement('h3');
    name.textContent=title;
    const status=document.createElement('small');
    status.textContent='Daten werden geladen …';
    const rows=document.createElement('div');
    section.append(name,status,rows);
    root.append(section);
    return async()=>{
      try{
        const response=await fetch(source+file+'.json?ref=paper-dashboard-data',{
          credentials:'omit',cache:'no-store',headers:{Accept:'application/vnd.github.raw+json'},signal:AbortSignal.timeout(10000)
        });
        if(!response.ok)throw Error('response');
        const report=await response.json();
        const time=typeof report.asOf==='number'?report.asOf:Date.parse(report.asOf);
        if(!Number.isFinite(time)||time>Date.now()+60000)throw Error('timestamp');
        let label,light;
        if(render===demoRows){
          const [tone,state,detail]=okxStatus(report);
          light={on:'🟢',warn:'🟡',off:'🔴',unknown:'⚪'}[tone]||'⚪';
          label=state==='Aktiv'?detail:state;
        }else{
          label=phases[report.phase];
          if(!label)throw Error('phase');
          light=report.phase==='running'?'🟢':report.phase==='final'?'🔴':'🟡';
          if(report.phase!=='final' && Date.now()-time>maxMinutes*60000){light='🟡';label='Stand veraltet';}
        }
        rows.replaceChildren(...render(report));
        status.textContent=light+' '+label+' · '+localTime.format(time)+' Wien';
      }catch{
        status.textContent='⚪ Daten derzeit nicht verfügbar';
        rows.replaceChildren();
      }
    };
  });
  let busy=false;
  async function refresh(){
    if(busy||document.hidden||!root.getClientRects().length)return;
    busy=true;
    try{await Promise.all(updates.map(update=>update()));}finally{busy=false;}
  }
  new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))void refresh();}).observe(root);
  setInterval(refresh,60000);
  return root;
}
