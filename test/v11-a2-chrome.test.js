import assert from 'node:assert/strict';
import {test} from 'node:test';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {withMobileChrome} from './helpers/v11-cdp.mjs';

const chrome = [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && existsSync(p));
const page = process.env.V11_TEST_URL || 'file://' + fileURLToPath(new URL('../v11/index.html', import.meta.url));
const probe = `(() => {
  const nav = document.getElementById('nav');
  const tabs = [...nav.querySelectorAll('button[data-v]')];
  const views = [...document.querySelectorAll('.view')];
  const failures = [];
  const check = (ok, label) => { if (!ok) failures.push(label); };
  const fits = node => node.scrollWidth <= node.clientWidth + 1;
  const protectedNodes = [...document.querySelectorAll('[data-decision-owner],.portfolio-value,.trust-grid,.empty-state')];
  const baseline = protectedNodes.map(node => node.textContent);
  const contrast = (foreground, background) => {
    const luminance = color => {
      const channels = color.match(/[\\d.]+/g).slice(0, 3).map(Number).map(x => x / 255);
      return channels.map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4)
        .reduce((sum, x, i) => sum + x * [.2126, .7152, .0722][i], 0);
    };
    const a = luminance(foreground), b = luminance(background);
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  };
  for (let cycle = 0; cycle < 20; cycle++) {
    for (const tab of tabs) {
      tab.focus(); tab.click();
      const visible = views.filter(view => !view.hidden);
      check(visible.length === 1 && visible[0].id === 'view-' + tab.dataset.v, 'view ownership');
      check(document.activeElement === visible[0].querySelector('h1'), 'heading focus');
      check(tabs.filter(button => button.getAttribute('aria-current') === 'page').length === 1, 'current nav');
      check(document.body.scrollWidth <= innerWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1, 'page overflow');
      check([...visible[0].querySelectorAll('h1,h2,p,.card-head,.section-title')].every(fits), 'trust text clipping');
      const n = nav.getBoundingClientRect();
      check(n.left >= 0 && n.right <= innerWidth + 1 && n.bottom <= innerHeight + 1, 'nav viewport');
    }
  }
  tabs[0].click();
  const disclosure = document.querySelector('details');
  disclosure.open = true;
  const controls = [...document.querySelectorAll('button[data-preview-state]')];
  const status = document.getElementById('preview-data-status');
  const states = [];
  for (const control of [...controls, controls[0]]) {
    control.focus(); control.click();
    const title = status.querySelector('strong');
    const s = getComputedStyle(status), t = getComputedStyle(title);
    const ratio = contrast(t.color, s.backgroundColor);
    check(document.activeElement === control, 'state control focus');
    check(status.dataset.state === control.dataset.previewState, 'state selection');
    check(controls.filter(button => button.getAttribute('aria-pressed') === 'true').length === 1, 'pressed ownership');
    check(title.textContent.startsWith('Beispiel:'), 'example disclosure');
    check(protectedNodes.every((node, i) => node.textContent === baseline[i]), 'protected data parity');
    check(ratio >= 4.5, 'state contrast');
    check(fits(status) && fits(title) && fits(status.querySelector('p')), 'state clipping');
    check(controls.every(button => button.getBoundingClientRect().height >= 44 && button.getBoundingClientRect().width >= 44), 'state targets');
    check(document.body.scrollWidth <= innerWidth + 1, 'state overflow');
    states.push({state: status.dataset.state, contrast: Number(ratio.toFixed(2))});
  }
  const summary = disclosure.querySelector('summary');
  summary.focus();
  const skip = document.querySelector('.skip-link');
  skip.focus();
  check(skip.getBoundingClientRect().top >= 0 && fits(skip), 'skip link visibility');
  skip.click();
  check(document.activeElement.id === 'app-main', 'skip link target focus');
  const text = status.querySelector('p');
  text.textContent = 'UnverifizierteDatenquelle'.repeat(18);
  check(fits(status) && fits(text) && document.body.scrollWidth <= innerWidth + 1, 'long unknown source');
  text.textContent = 'Prüfung fehlgeschlagen. '.repeat(30);
  check(fits(status) && fits(text), 'long error text');
  const last = document.querySelector('.section-footer');
  window.scrollTo(0, document.documentElement.scrollHeight);
  check(last.getBoundingClientRect().bottom <= nav.getBoundingClientRect().top + 1, 'bottom content clearance');
  return {width: innerWidth, viewport: document.documentElement.clientWidth, cycles: 20, states, failures};
})()`;

test('A2 Chrome: focus, fail-closed states, contrast and layout at 320/375/390/430', {timeout: 120000}, async () => {
  if (typeof WebSocket !== 'function') {
    const env = {...process.env};
    delete env.NODE_TEST_CONTEXT;
    const child = spawnSync(process.execPath, ['--experimental-websocket', fileURLToPath(import.meta.url)],
      {env, encoding: 'utf8', timeout: 115000});
    assert.equal(child.status, 0, String(child.stdout).slice(-2500) + String(child.stderr).slice(-1000));
    const measurements = child.stdout.split('\n').filter(line => line.includes('V11_A2_WIDTH'));
    assert.equal(measurements.length, 4, 'four real CDP width measurements required');
    measurements.forEach(line => console.log(line));
    return;
  }
  assert.ok(chrome, 'Chrome required; this test must not silently skip');
  for (const width of [320, 375, 390, 430]) {
    const result = await withMobileChrome(chrome, width, page, async call => {
      const evaluate = async expression => {
        const response = await call('Runtime.evaluate', {expression, returnByValue: true});
        assert.ok(!response.exceptionDetails, 'browser expression exception: ' + JSON.stringify(response.exceptionDetails));
        return response.result?.value;
      };
      const result = await evaluate(probe);
      const key = async (name, code) => {
        const text = name === 'Enter' ? '\r' : ' ';
        await call('Input.dispatchKeyEvent', {type: 'keyDown', key: name, code, text, unmodifiedText: text, windowsVirtualKeyCode: name === 'Enter' ? 13 : 32});
        await call('Input.dispatchKeyEvent', {type: 'keyUp', key: name, code, windowsVirtualKeyCode: name === 'Enter' ? 13 : 32});
      };
      for (const view of ['command', 'depot', 'bots', 'market', 'research']) {
        await evaluate(`document.querySelector('#nav button[data-v="${view}"]').focus()`);
        await key('Enter', 'Enter');
        assert.equal(await evaluate('document.activeElement.closest(".view").id'), 'view-' + view, 'native Enter navigation');
      }
      await evaluate('document.querySelector("#nav button").click(); document.querySelector("details").open = false; document.querySelector("summary").focus()');
      await key(' ', 'Space');
      assert.equal(await evaluate('document.querySelector("details").open'), true, 'native Space opens disclosure');
      assert.equal(await evaluate('getComputedStyle(document.querySelector("summary")).outlineStyle'), 'solid', 'keyboard disclosure focus indicator');
      await evaluate('document.querySelector("button[data-preview-state=loading]").focus()');
      await key(' ', 'Space');
      assert.equal(await evaluate('document.getElementById("preview-data-status").dataset.state'), 'loading', 'native Space selects loading example');
      assert.equal(await evaluate('document.activeElement.dataset.previewState'), 'loading', 'native state activation retains focus');
      const evidence = process.env.V11_A2_EVIDENCE_DIR;
      if (evidence) {
        mkdirSync(evidence, {recursive: true});
        for (const state of ['unknown', 'loading', 'error']) {
          await evaluate(`document.querySelector('button[data-preview-state=${state}]').focus(); document.querySelector('button[data-preview-state=${state}]').click(); document.getElementById('data-state-preview').scrollIntoView({block:'center'})`);
          const image = await call('Page.captureScreenshot', {format: 'png', captureBeyondViewport: false});
          writeFileSync(join(evidence, `v11-a2-${width}-${state}.png`), Buffer.from(image.data, 'base64'));
        }
        await evaluate('document.querySelector("details").open = false; window.scrollTo(0,0)');
        const image = await call('Page.captureScreenshot', {format: 'png', captureBeyondViewport: false});
        writeFileSync(join(evidence, `v11-a2-${width}-command.png`), Buffer.from(image.data, 'base64'));
      }
      await call('Emulation.setEmulatedMedia', {features: [{name: 'prefers-reduced-motion', value: 'reduce'}]});
      assert.equal(await evaluate('getComputedStyle(document.querySelector(".view.active")).animationName'), 'none', 'reduced motion');
      await call('Emulation.setEmulatedMedia', {features: [{name: 'forced-colors', value: 'active'}]});
      assert.equal(await evaluate('getComputedStyle(document.querySelector("#nav button.active")).outlineStyle'), 'solid', 'forced-colors selection');
      return {...result, keyboard: 'Enter navigation / Space disclosure and state: PASS', reducedMotion: true, forcedColors: true};
    });
    console.log('V11_A2_WIDTH', width, JSON.stringify(result));
    assert.equal(result.width, width);
    assert.equal(result.viewport, width);
    assert.deepEqual(result.failures, [], 'A2 quality failures at ' + width);
    assert.equal(result.cycles, 20);
    assert.deepEqual(result.states.map(state => state.state), ['unknown', 'loading', 'error', 'unknown']);
  }
});
