import {renderSpotPaperPaired} from './spot-paper-paired-view.js?v=B17-M11';
import {presentSpotPaperPairedComparison} from
  './spot-paper-paired-model.js?v=B17-M11';

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
  let currentComparisonReports = null;
  let disposed = false;

  function render(nextDto = currentDto, nextState = currentState,
    nextProgressSnapshot = currentProgressSnapshot,
    nextExpectedIdentity = currentExpectedIdentity,
    nextComparisonReports = currentComparisonReports) {
    if (disposed) return null;
    currentDto = nextDto;
    currentState = nextState;
    currentProgressSnapshot = nextProgressSnapshot;
    currentExpectedIdentity = nextExpectedIdentity;
    currentComparisonReports = nextComparisonReports;
    return renderSpotPaperPaired(root, currentDto, document, {
      loading: currentLoading,
      state: currentState,
      progressSnapshot: currentProgressSnapshot,
      expectedIdentity: currentExpectedIdentity,
      comparison: currentComparisonReports ? presentSpotPaperPairedComparison(
        currentComparisonReports.first, currentComparisonReports.second, {
          firstLabel: currentComparisonReports.firstLabel,
          secondLabel: currentComparisonReports.secondLabel
        }) : null
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
    setComparisonReports(value) {
      if (disposed) return;
      currentComparisonReports = value;
      render();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.replaceChildren();
    }
  });
}
