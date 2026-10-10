import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../v11/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const keys = ['command', 'depot', 'bots', 'market', 'research'];

function fixture() {
  let focused = null;
  const element = (dataset = {}) => {
    const attributes = new Map();
    const classes = new Set();
    return {dataset, attributes, textContent: '',
      classList: {toggle: (name, on) => on ? classes.add(name) : classes.delete(name)},
      setAttribute: (name, value) => attributes.set(name, value),
      removeAttribute: name => attributes.delete(name),
      focus() { focused = this; }, scrollIntoView() {},
      listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; }};
  };
  const headings = keys.map(() => element());
  const buttons = keys.map(v => element({v}));
  const views = keys.map((v, i) => Object.assign(element(), {
    hidden: i !== 0, querySelector: selector => selector === 'h1' ? headings[i] : null
  }));
  const nav = element();
  nav.querySelectorAll = () => buttons;
  nav.contains = button => buttons.includes(button);
  const controls = ['unknown', 'loading', 'error'].map(previewState => element({previewState}));
  const preview = element();
  preview.querySelectorAll = () => controls;
  preview.contains = button => controls.includes(button);
  const title = element(), description = element(), status = element({state: 'unknown'});
  status.querySelector = selector => selector === 'strong' ? title : description;
  const all = new Map([['nav', nav], ['data-state-preview', preview], ['preview-data-status', status],
    ...keys.map((v, i) => ['view-' + v, views[i]])]);
  vm.runInNewContext(script, {document: {getElementById: id => all.get(id)}}, {timeout: 250});
  const click = (owner, target) => owner.listeners.click({target: {closest: () => target}});
  return {headings, buttons, views, controls, nav, preview, status, title, description, click,
    focused: () => focused};
}

test('A2: 20 navigation cycles move focus into exactly one named view', () => {
  const f = fixture();
  for (let cycle = 0; cycle < 20; cycle++) {
    keys.forEach((key, i) => {
      f.click(f.nav, f.buttons[i]);
      assert.deepEqual(f.views.map(v => v.hidden), keys.map(v => v !== key));
      assert.deepEqual(f.buttons.map(b => b.attributes.get('aria-current')), keys.map(v => v === key ? 'page' : undefined));
      assert.equal(f.focused(), f.headings[i]);
      assert.equal(f.headings[i].attributes.get('tabindex'), '-1');
    });
  }
});

test('A2: presentation states announce explicit examples and preserve control focus', () => {
  const f = fixture();
  for (const control of f.controls) {
    control.focus();
    f.click(f.preview, control);
    assert.equal(f.status.dataset.state, control.dataset.previewState);
    assert.match(f.title.textContent, /^Beispiel:/);
    assert.match(f.description.textContent, /unbestimmt|unbekannt|kein Ersatzwert/);
    assert.equal(f.focused(), control);
    assert.equal(f.controls.filter(c => c.attributes.get('aria-pressed') === 'true').length, 1);
    assert.deepEqual(f.views.map(v => v.hidden), [false, true, true, true, true]);
  }
});

test('A2: foreign clicks and unsupported example states cannot create verified data', () => {
  const f = fixture();
  f.click(f.preview, f.controls[2]);
  f.click(f.preview, {dataset: {previewState: 'verified'}});
  assert.equal(f.status.dataset.state, 'error', 'foreign control ignored');
  f.controls[2].dataset.previewState = 'verified';
  f.click(f.preview, f.controls[2]);
  assert.equal(f.status.dataset.state, 'unknown', 'unsupported state fails closed');
  assert.match(f.title.textContent, /Daten unbekannt/);
  assert.equal(f.controls[0].attributes.get('aria-pressed'), 'true');
  f.click(f.nav, {dataset: {v: 'invalid'}});
  assert.deepEqual(f.views.map(v => v.hidden), [false, true, true, true, true]);
});

test('A2: examples stay in the single source disclosure; skip link and live-region semantics exist', () => {
  assert.equal((html.match(/<details\b/g) || []).length, 1);
  assert.match(html, /<details class="command-source-details">[\s\S]*id="data-state-preview"[\s\S]*<\/details>/);
  assert.match(html, /href="#app-main">Zum Inhalt/);
  assert.match(html, /<main[^>]*id="app-main"[^>]*tabindex="-1"/);
  assert.match(html, /id="preview-data-status"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.match(html, /Nur Ansichtsmuster ohne Kontozugriff/);
  assert.match(html, /@media\(forced-colors:active\)/);
  assert.match(html, /@media\(prefers-reduced-motion:reduce\)/);
});

test('A2: local examples never write portfolio, risk, sources or any privileged surface', () => {
  const examples = script.slice(script.indexOf('const preview ='));
  assert.doesNotMatch(examples, /portfolio-value|data-decision-owner|trust-cell|MERIDIAN|\.innerHTML|\.outerHTML/);
  assert.doesNotMatch(script, /\b(fetch|XMLHttpRequest|WebSocket|EventSource|localStorage|sessionStorage|indexedDB|setTimeout|setInterval)\s*\(/);
  assert.doesNotMatch(html, /<script[^>]*src=|<iframe|<form|rel="manifest"/);
  assert.match(html, /data-preview-mode="static-no-live-data"/);
  assert.match(html, /data-execution-impact="false"/);
});
