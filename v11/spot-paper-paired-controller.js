import {renderSpotPaperPaired} from './spot-paper-paired-view.js?v=B16-M11-FIX16';

export function mountSpotPaperPairedPanel(root, {
  dto = null,
  progressSnapshot = null,
  expectedIdentity = null,
  loading = false,
  state = 'idle',
  document = root?.ownerDocument
} = {}) {
  if (!root || !document) throw new TypeError('Paired paper panel container is required');
  let currentDto = dto;
  let currentProgressSnapshot = progressSnapshot;
  let currentExpectedIdentity = expectedIdentity;
  let currentLoading = loading === true;
  let currentState = state;
  let disposed = false;

  function render(nextDto = currentDto, nextState = currentState,
    nextProgressSnapshot = currentProgressSnapshot,
    nextExpectedIdentity = currentExpectedIdentity) {
    if (disposed) return null;
    currentDto = nextDto;
    currentState = nextState;
    currentProgressSnapshot = nextProgressSnapshot;
    currentExpectedIdentity = nextExpectedIdentity;
    return renderSpotPaperPaired(root, currentDto, document, {
      loading: currentLoading,
      state: currentState,
      progressSnapshot: currentProgressSnapshot,
      expectedIdentity: currentExpectedIdentity
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
