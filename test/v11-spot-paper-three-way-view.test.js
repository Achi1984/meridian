import assert from 'node:assert/strict';
import {test} from 'node:test';
import {renderSpotPaperThreeWay} from '../v11/spot-paper-three-way-view.js';
class Element {
  constructor(document, tag) { this.ownerDocument = document; this.tagName = tag.toUpperCase(); this.children = []; this.text = ''; this.attrs = {}; }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.text = ''; this.children = nodes; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
}
const document = {createElement: tag => new Element(document, tag)};
const arm = strategyId => ({strategyId, positionStatus: 'FLAT', finalNetEquityCents: {value: 100000}, realizedPnlCents: {value: 0}, unrealizedPnlCents: {value: 0}, fillCount: {value: 0}, completedRoundTripCount: {value: 0}, maxSampledEquityDrawdownCents: {value: 0}});
test('renders four read-only research arms with safety label and no controls', () => {
  const root = new Element(document, 'div');
  renderSpotPaperThreeWay(root, {available: true, status: 'COMPARISON_AVAILABLE', freshness: {status: 'WITHIN_DISPLAY_POLICY'}, arms: {baseline: arm('base'), challenger: arm('challenger'), rangePullback: arm('range'), cash: arm('cash')}} , document);
  assert.match(root.textContent, /Research-only · Profitabilität nicht bewertet/);
  assert.match(root.textContent, /Baseline/);
  assert.match(root.textContent, /Range-Pullback/);
  assert.match(root.textContent, /Cash/);
  assert.doesNotMatch(root.textContent, /Start|Stop|Promote|Provider/);
});
test('renders unavailable state without metrics or controls', () => {
  const root = new Element(document, 'div');
  assert.equal(renderSpotPaperThreeWay(root, {available: false}, document).status, 'UNKNOWN');
  assert.match(root.textContent, /unbekannt oder nicht verfügbar/);
});
