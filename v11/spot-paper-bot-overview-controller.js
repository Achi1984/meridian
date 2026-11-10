import {renderSpotPaperBotOverview} from './spot-paper-bot-overview-view.js?v=B16-M11-FIX15';

export function mountSpotPaperBotOverview(root, {
  adapters = [],
  pairedReport = null,
  pairedProgress = null,
  expectedIdentity = null,
  document = root?.ownerDocument
} = {}) {
  if (!root || !document) throw new TypeError('Paper bot overview container is required');
  let currentAdapters = adapters;
  let currentPairedReport = pairedReport;
  let currentPairedProgress = pairedProgress;
  let currentExpectedIdentity = expectedIdentity;
  let disposed = false;

  function render(nextAdapters = currentAdapters, nextPairedReport = currentPairedReport,
    nextPairedProgress = currentPairedProgress,
    nextExpectedIdentity = currentExpectedIdentity) {
    if (disposed) return null;
    currentAdapters = nextAdapters;
    currentPairedReport = nextPairedReport;
    currentPairedProgress = nextPairedProgress;
    currentExpectedIdentity = nextExpectedIdentity;
    return renderSpotPaperBotOverview(root, currentAdapters, document, {
      pairedReport: currentPairedReport,
      pairedProgress: currentPairedProgress,
      expectedIdentity: currentExpectedIdentity
    });
  }

  render();
  return Object.freeze({
    render,
    update(nextAdapters, nextPairedReport, nextPairedProgress, nextExpectedIdentity) {
      return render(nextAdapters, nextPairedReport, nextPairedProgress,
        nextExpectedIdentity);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.replaceChildren();
    }
  });
}
