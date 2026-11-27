import {createSpotPaperThreeWayAdapter, presentSpotPaperThreeWayReport} from './spot-paper-three-way-model.js?v=B20-M11-FIX3';
import {createOfflineThreeWayReportReader} from './spot-paper-three-way-reader.js?v=B20-M11-FIX3';
import {renderSpotPaperThreeWay} from './spot-paper-three-way-view.js?v=B20-M11-FIX3';

export function mountSpotPaperThreeWayResearch(root, document = root?.ownerDocument,
  {readReport, readText, now = () => Date.now(), staleAfterMs = 15 * 60 * 1000} = {}) {
  let injectedReader = readReport;
  if (!injectedReader && readText) {
    const reader = createOfflineThreeWayReportReader({readText});
    injectedReader = () => reader.readReport();
  }
  const adapter = createSpotPaperThreeWayAdapter({readReport: injectedReader});
  let active = true;
  let current = presentSpotPaperThreeWayReport(null);
  const render = () => renderSpotPaperThreeWay(root, current, document);
  render();
  return Object.freeze({
    setActive(value) { active = value === true; if (!active) return; render(); },
    async refresh() {
      if (!active) return current;
      current = await adapter.read({now: now(), staleAfterMs});
      render();
      return current;
    },
    getModel() { return current; }
  });
}
