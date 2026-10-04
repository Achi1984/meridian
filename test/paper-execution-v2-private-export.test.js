import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const src=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
test('V2 private export is bearer protected before data access',()=>{assert.match(src,/paper-execution-v2\/export"\)\{if\(!authorized\(req\)\)return send\(res,401/);});
test('V2 private export refuses non-Postgres runtime',()=>{assert.match(src,/PAPER_EXECUTION_V2_REQUIRES_POSTGRES/);assert.match(src,/if\(!pool\)throw new Error\("PAPER_EXECUTION_V2_REQUIRES_POSTGRES"\)/);});
test('V2 export uses full state getter and immutable exporter',()=>{assert.match(src,/buildPaperExecutionAuditExport\(getState\)/);});
test('V2 endpoint is not advertised as public root endpoint',()=>{const root=src.match(/endpoints:\[(.*?)\]/s)?.[1]||'';assert.doesNotMatch(root,/paper-execution-v2/);});
