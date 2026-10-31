import {getPaperReadiness} from './paper-readiness.js?v=B16-M11-FIX10';

const statusLabels = Object.freeze({
  UNVERIFIED:'Noch zu prüfen',
  UNSPECIFIED:'Noch festzulegen',
  NOT_AUTHORIZED:'Freigabe offen',
  REQUIRED_UNSET:'Noch festzulegen'
});
const text = value => typeof value === 'string' && value.trim() ? value : 'Nicht belegt';

function add(document,parent,tag,value,className){
  const node=document.createElement(tag);
  node.textContent=text(value);
  if(className)node.className=className;
  if(tag==='summary')node.setAttribute('style','min-height:44px;box-sizing:border-box;padding:10px 0;cursor:pointer');
  parent.append(node);
  return node;
}

function rows(document,parent,entries,{showStatus=false}={}){
  const list=document.createElement('ul');
  for(const row of entries){
    const item=document.createElement('li');
    add(document,item,'strong',row.label);
    if(showStatus)add(document,item,'span',` · ${statusLabels[row.status] || 'Nicht belegt'}`);
    add(document,item,'p',row.detail);
    if(typeof row.evidencePath==='string'&&row.evidencePath.trim()){
      const evidence=document.createElement('details');
      add(document,evidence,'summary','Quellbeleg');
      add(document,evidence,'p',row.evidencePath);
      item.append(evidence);
    }
    list.append(item);
  }
  parent.append(list);
}

// Read-only source-preparation panel. It never grants or derives runtime authority.
export function renderPaperReadiness(root,model=getPaperReadiness(),document=root?.ownerDocument){
  if(!root||!document)return null;
  root.replaceChildren();
  root.className='card paper-readiness';
  root.setAttribute('aria-labelledby','paper-readiness-heading');
  root.setAttribute('style','min-width:0;overflow-wrap:anywhere');
  add(document,root,'h2','Paperbots vorbereiten').id='paper-readiness-heading';
  add(document,root,'p','Vorbereitung · kein laufender Paper-Betrieb','limited');
  const valid=model?.schemaVersion==='MERIDIAN_PAPER_READINESS/1'&&
    model.scope==='SOURCE_PREPARATION_ONLY'&&model.status==='NOT_READY'&&
    model.paperAuthorized===false&&model.liveAuthorized===false&&model.canStart===false&&
    ['prepared','gates','choices'].every(key=>Array.isArray(model[key])&&
      model[key].every(row=>row&&typeof row==='object'&&!Array.isArray(row)));
  if(!valid){
    add(document,root,'p','Vorbereitungsstand nicht verfügbar. Daraus folgt keine Freigabe.');
    return {status:'UNKNOWN'};
  }
  add(document,root,'p',model.summary);
  add(document,root,'p','Paperstart gesperrt · Echtgeldhandel nicht freigegeben.');
  const qualification=model.gates.find(row=>row.id==='qualification');
  if(qualification){
    add(document,root,'p',`${text(qualification.label)}${qualification.assessment?.sourceCheckedOn ? ` · Quellenstand ${text(qualification.assessment.sourceCheckedOn)}` : ''}`);
  }
  add(document,root,'h3','Nächster Schritt');
  add(document,root,'p',model.nextStep);
  const prepared=document.createElement('details');
  prepared.setAttribute('data-paper-readiness','prepared');
  add(document,prepared,'summary',`Technik vorhanden · ${model.prepared.length} Bausteine`);
  add(document,prepared,'p',model.evidenceNote);
  rows(document,prepared,model.prepared);
  root.append(prepared);
  const gates=document.createElement('details');
  gates.setAttribute('data-paper-readiness','gates');
  add(document,gates,'summary',`Noch zu bauen / prüfen · ${model.gates.length} offene Punkte`);
  rows(document,gates,model.gates,{showStatus:true});
  root.append(gates);
  const choices=document.createElement('details');
  choices.setAttribute('data-paper-readiness','choices');
  add(document,choices,'summary',`Betriebsparameter festlegen · ${model.choices.length} offene Gruppen`);
  add(document,choices,'p','Diese Übersicht speichert keine Auswahl. Die Parameter werden vor einer gesonderten Betriebsfreigabe gemeinsam festgelegt.');
  rows(document,choices,model.choices,{showStatus:true});
  root.append(choices);
  return {status:'NOT_READY'};
}
