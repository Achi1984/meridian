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

  function render(nextDto = currentDto) {
    currentDto = nextDto;
    return renderSpotPaperPaired(root, currentDto, document, {
      projectReport, preview, loading
    });
  }

  render();
  return Object.freeze({
    render,
    dispose() {
      root.replaceChildren();
    }
  });
}
