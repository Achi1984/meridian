import {renderSpotPaperBotOverview} from './spot-paper-bot-overview-view.js?v=B16-M11-FIX14';

export function mountSpotPaperBotOverview(root, {
  adapters = [],
  document = root?.ownerDocument
} = {}) {
  if (!root || !document) throw new TypeError('Paper bot overview container is required');
  let currentAdapters = adapters;
  let disposed = false;

  function render(nextAdapters = currentAdapters) {
    if (disposed) return null;
    currentAdapters = nextAdapters;
    return renderSpotPaperBotOverview(root, currentAdapters, document);
  }

  render();
  return Object.freeze({
    render,
    update(nextAdapters) {
      return render(nextAdapters);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.replaceChildren();
    }
  });
}
