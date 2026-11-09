import {renderSpotPaperPaired} from './spot-paper-paired-view.js?v=B16-M11-FIX14';

export function mountSpotPaperPairedPanel(root, {
  dto = null,
  loading = false,
  state = 'idle',
  document = root?.ownerDocument
} = {}) {
  if (!root || !document) throw new TypeError('Paired paper panel container is required');
  let currentDto = dto;
  let currentLoading = loading === true;
  let currentState = state;
  let disposed = false;

  function render(nextDto = currentDto, nextState = currentState) {
    if (disposed) return null;
    currentDto = nextDto;
    currentState = nextState;
    return renderSpotPaperPaired(root, currentDto, document, {
      loading: currentLoading,
      state: currentState
    });
  }

  render();
  return Object.freeze({
    render,
    setLoading(value) {
      if (disposed) return;
      currentLoading = value === true;
      render();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.replaceChildren();
    }
  });
}
