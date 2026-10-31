import {CAMPAIGN_SOURCE, renderStrategyCatalog} from './strategy-catalog.js?v=B16-M11-FIX3';
import {createStrategyArenaView} from './strategy-arena.js?v=B16-M11-FIX3';

const catalogRoot = document.getElementById('strategy-catalog');
const catalogStatus = document.getElementById('strategy-load-status');
const arenaRoot = document.getElementById('strategy-arena-root');
const arena = createStrategyArenaView(arenaRoot);
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
  if (event.target.closest?.('button[data-v="strategies"]')) loadWorkspace();
});

document.addEventListener('click',event=>{
  const link = event.target.closest?.('[data-open-strategies]');
  if (!link) return;
  event.preventDefault();
  document.querySelector('#nav button[data-v="strategies"]')?.click();
  loadWorkspace();
});
