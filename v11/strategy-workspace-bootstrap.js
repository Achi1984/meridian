import {CAMPAIGN_SOURCE, renderStrategyCatalog} from './strategy-catalog.js?v=B16-M11-FIX14';
import {createStrategyArenaView} from './strategy-arena.js?v=B16-M11-FIX14';
import {mountPaperCockpit} from './paper-cockpit-controller.js?v=B16-M11-FIX14';
import {mountSpotPaperCockpit} from './spot-paper-cockpit-controller.js?v=B16-M11-FIX14';
import {mountSpotPaperHost8hDashboard} from './spot-paper-host8h-controller.js?v=B16-M11-FIX14';
import {renderPaperReadiness} from './paper-readiness-view.js?v=B16-M11-FIX14';

const catalogRoot = document.getElementById('strategy-catalog');
const catalogStatus = document.getElementById('strategy-load-status');
const arenaRoot = document.getElementById('strategy-arena-root');
const arena = createStrategyArenaView(arenaRoot);
let paperCockpit = null;
let spotPaperCockpit = null;
let spotPaperHost8hDashboard = null;
if(catalogRoot?.parentNode){
  const workspace=catalogRoot.parentNode;
  const host8hRoot=document.createElement('section');
  host8hRoot.id='spot-paper-host8h-root';
  workspace.insertBefore(host8hRoot,catalogStatus || catalogRoot);
  spotPaperHost8hDashboard=mountSpotPaperHost8hDashboard(host8hRoot,document,window);

  function collapsedSection(id,label){
    const section=document.createElement('details');
    section.id=id;
    section.className='card';
    const summary=document.createElement('summary');
    summary.textContent=label;
    summary.setAttribute('style','min-height:44px;padding:10px 0;box-sizing:border-box;cursor:pointer');
    section.append(summary);
    workspace.insertBefore(section,catalogRoot);
    return section;
  }
  const history=collapsedSection('paper-history-section','Frühere Paper-Berichte');
  const spotPaperRoot=document.createElement('section');
  spotPaperRoot.id='spot-paper-cockpit-root';
  history.append(spotPaperRoot);
  spotPaperCockpit=mountSpotPaperCockpit(spotPaperRoot,document,window);
  const paperRoot=document.createElement('section');
  paperRoot.id='paper-cockpit-root';
  history.append(paperRoot);
  paperCockpit=mountPaperCockpit(paperRoot,document,window);

  const research=collapsedSection('paper-research-section','Strategieforschung und weitere Paper-Modelle');
  const readinessRoot=document.createElement('section');
  readinessRoot.id='paper-readiness-root';
  research.append(readinessRoot);
  renderPaperReadiness(readinessRoot);
  if(catalogStatus)research.append(catalogStatus);
  research.append(catalogRoot);
  if(arenaRoot)research.append(arenaRoot);
}
let loaded = false;
let loading = false;

async function loadWorkspace() {
  if (loaded || loading) return;
  loading = true;
  catalogStatus.textContent = 'Das lokale Strategieregister wird geladen. Keine Marktdaten werden abgerufen.';
  catalogRoot.setAttribute('aria-busy','true');
  try {
    const response = await fetch(new URL(CAMPAIGN_SOURCE,import.meta.url).href,{cache:'no-store'});
    if (!response.ok) throw Error('Das Quellregister ist nicht verfügbar.');
    const campaign = await response.json();
    const catalog = renderStrategyCatalog(catalogRoot,campaign);
    if (catalog.status !== 'PRESENT_UNVERIFIED') throw Error(catalog.reason);
    loaded = true;
    catalogStatus.textContent = 'Zwölf Hypothesen aus dem lokalen Entwurfsregister; Entwicklungsstufen bleiben quellengebunden.';
  } catch (error) {
    renderStrategyCatalog(catalogRoot,null);
    catalogStatus.textContent = String(error?.message || 'Das Strategieregister ist unbekannt.').slice(0,220);
    catalogStatus.setAttribute('role','alert');
  } finally {
    loading = false;
    catalogRoot.removeAttribute('aria-busy');
  }
}

document.getElementById('nav')?.addEventListener('click',event=>{
  const button=event.target.closest?.('button[data-v]');
  if(button) paperCockpit?.setActive(button.dataset.v==='strategies');
  if(button) spotPaperCockpit?.setActive(button.dataset.v==='strategies');
  if(button) spotPaperHost8hDashboard?.setActive(button.dataset.v==='strategies');
  if (button?.dataset.v==='strategies') loadWorkspace();
});

document.addEventListener('click',event=>{
  const link = event.target.closest?.('[data-open-strategies]');
  if (!link) return;
  event.preventDefault();
  document.querySelector('#nav button[data-v="strategies"]')?.click();
  loadWorkspace();
});

if (document.querySelector('#nav button[data-v="strategies"][aria-current="page"]')) {
  paperCockpit?.setActive(true);
  spotPaperCockpit?.setActive(true);
  spotPaperHost8hDashboard?.setActive(true);
  loadWorkspace();
}
