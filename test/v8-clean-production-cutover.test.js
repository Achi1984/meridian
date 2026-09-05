import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const clean=fs.readFileSync(new URL('../v8-clean/index.html',import.meta.url),'utf8');

test('production root redirects only to clean v8 shell',()=>{
  assert.match(root,/location\.replace\(target\+q\+h\)/);
  assert.match(root,/var target='\.\/v8-clean\/'/);
  assert.match(root,/8\.0-clean-r8-production/);
  assert.doesNotMatch(root,/app-v6\.06|app-v7\.|app-v8\.0-navigation|primaryBottomNav|legacy\.click/);
});

test('production target remains the five-view canonical v8 shell',()=>{
  for(const key of ['center','depot','trade','paper','more']){
    assert.match(clean,new RegExp(`id="view-${key}"`));
    assert.match(clean,new RegExp(`data-route="${key}"`));
  }
  assert.match(clean,/r8-polish\.css\?v=8\.0-r9/);
  assert.match(clean,/app\.js\?v=8\.0-r9/);
  assert.match(clean,/more-runtime\.js\?v=8\.0-r9/);
  assert.match(clean,/v8\.0 · PROD/);
  assert.match(clean,/MERIDIAN v8 · CUSTOMER VIEW/);
});
