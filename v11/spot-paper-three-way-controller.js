import {createSpotPaperThreeWayAdapter, presentSpotPaperThreeWayReport} from './spot-paper-three-way-model.js?v=B16-M11-FIX16';
import {renderSpotPaperThreeWay} from './spot-paper-three-way-view.js?v=B16-M11-FIX16';

export function mountSpotPaperThreeWayResearch(root, document = root?.ownerDocument,
  {readReport, now = () => Date.now(), staleAfterMs = 15 * 60 * 1000} = {}) {
  const adapter = createSpotPaperThreeWayAdapter({readReport});
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
