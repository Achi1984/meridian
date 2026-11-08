import {renderSpotPaperPaired} from './spot-paper-paired-view.js?v=B16-M11-FIX14';

export function mountSpotPaperPairedPanel(root, {
  dto = null,
  projectReport,
  preview = false,
  loading = false,
  document = root?.ownerDocument
} = {}) {
  if (!root || !document) throw new TypeError('Paired paper panel container is required');
  let currentDto = dto;
let currentLoading = loading;
let disposed = false;

function render(nextDto = currentDto) {
  if (disposed) return null;
  currentDto = nextDto;
  return renderSpotPaperPaired(root, currentDto, document, {
    projectReport, preview, loading: currentLoading
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
