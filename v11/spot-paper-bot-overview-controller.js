import {renderSpotPaperBotOverview} from './spot-paper-bot-overview-view.js?v=B16-M11-FIX14';

export function mountSpotPaperBotOverview(root, {
  adapters = [],
  pairedReport = null,
  document = root?.ownerDocument
} = {}) {
  if (!root || !document) throw new TypeError('Paper bot overview container is required');
  let currentAdapters = adapters;
  let currentPairedReport = pairedReport;
  let disposed = false;

  function render(nextAdapters = currentAdapters, nextPairedReport = currentPairedReport) {
    if (disposed) return null;
    currentAdapters = nextAdapters;
    currentPairedReport = nextPairedReport;
    return renderSpotPaperBotOverview(root, currentAdapters, document, {
      pairedReport: currentPairedReport
    });
  }

  render();
  return Object.freeze({
    render,
    update(nextAdapters, nextPairedReport) {
      return render(nextAdapters, nextPairedReport);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.replaceChildren();
    }
  });
}
