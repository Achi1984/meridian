import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const helper = fileURLToPath(new URL('../scripts/meridian-nav-packet.py', import.meta.url));
const source = fileURLToPath(new URL('./fixtures/v11-terminal-preimage.html', import.meta.url));
function python(body) {
  const result = spawnSync('python3', ['-c', `import importlib.util\nspec=importlib.util.spec_from_file_location('packet',${JSON.stringify(helper)})\np=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(p)\nimport pathlib, re, unittest.mock as mock\nsource=pathlib.Path(${JSON.stringify(source)}).read_bytes().decode('utf-8')\n${fixture}\n${body}`], {encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
const fixture=String.raw`
data={'label':'Terminal öffnen','href':'../v10/'}
def reject(fn):
    try:fn()
    except (ValueError,UnicodeError,TypeError):pass
    else:raise AssertionError('invalid packet accepted')
`;

test('candidate emits only fixed product path and preserves every pre-existing byte and script', () => {
  python(String.raw`
assert p.blob_sha(source)=='5dc0fc4970f9c67a3c0d1a5e2467bf721566d5f3'
packet=p.transform(source,data)
assert set(packet)=={'v11/index.html'}
result=packet[p.PATH]
assert result.count(p.CSS)==result.count(p.HTML)==1
assert result.replace(p.CSS,'',1).replace(p.HTML,'',1)==source
scripts=re.findall(r'<script\b[^>]*>.*?</script>',source,re.S)
assert len(scripts)==1 and re.findall(r'<script\b[^>]*>.*?</script>',result,re.S)==scripts
assert source==pathlib.Path(${JSON.stringify(source)}).read_bytes().decode('utf-8')
` .replace('${JSON.stringify(source)}', JSON.stringify(source)));
});

test('data schema rejects alternate paths, markup, script URLs and extra instructions', () => {
  python(String.raw`
for value in [None,[],{},dict(data,path='v11/index.html'),dict(data,files={'../escape':'bad'}),
    dict(data,href='javascript:alert(1)'),dict(data,href='https://evil.test'),dict(data,href='../v10/?token=x'),
    dict(data,label='<script>alert(1)</script>'),dict(data,label='Terminal öffnen" onclick="alert(1)'),
    dict(data,label='Terminal öffnen\n'),dict(data,label=1),dict(data,html='<a>link</a>')]:
    reject(lambda:p.transform(source,value))
`);
});

test('wrong base, duplicate anchors, inserted script or already applied packet fail closed', () => {
  python(String.raw`
for bad in [source+'\n',source.replace('MERIDIAN','changed',1),source+p.HTML_ANCHOR,
    source+p.CSS_ANCHOR,source.replace('<script>','<script>alert(1);',1),p.transform(source,data)[p.PATH]]:
    reject(lambda:p.transform(bad,data))
reject(lambda:p.transform(b'x',data));reject(lambda:p.transform('x'*131073,data))
# Independently exercise unique-anchor guard even if a future reviewed hash is supplied.
for bad in [source+p.HTML_ANCHOR,source+p.CSS_ANCHOR,source.replace(p.HTML_ANCHOR,''),source.replace(p.CSS_ANCHOR,'')]:
    with mock.patch.object(p,'PREIMAGE_BLOB',p.blob_sha(bad)):
        reject(lambda:p.transform(bad,data))
`);
});

test('native visible link has fixed touch and focus styles without dynamic execution', () => {
  python(String.raw`
from html.parser import HTMLParser
class Parser(HTMLParser):
    def __init__(self):super().__init__();self.tags=[];self.text=[]
    def handle_starttag(self,tag,attrs):self.tags.append((tag,dict(attrs)))
    def handle_data(self,text):self.text.append(text)
html=Parser();html.feed(p.HTML)
assert html.tags==[('nav',{'class':'terminal-entry','aria-label':'Terminal-Zugang'}),
                   ('a',{'class':'terminal-entry-link','href':'../v10/'})]
assert ''.join(html.text).strip()=='Terminal öffnen'
assert 'min-height:44px' in p.CSS and 'min-width:44px' in p.CSS
assert 'max-width:100%' in p.CSS and 'overflow-wrap:anywhere' in p.CSS
assert ':focus-visible{outline:3px solid' in p.CSS
assert not any(value in p.CSS for value in ('url(', 'position:fixed','width:100vw'))
result=p.transform(source,data)[p.PATH]
assert result.index(p.HTML)<result.index(p.HTML_ANCHOR)
# Outside the hidden history panel; no new script, event handlers or target window.
assert '<script' not in p.HTML and 'onclick' not in p.HTML and 'target=' not in p.HTML
`);
});

test('descriptor stays immutable and inactive with no chosen approval or live window', () => {
  python(String.raw`
assert p.DESCRIPTOR_A['active'] is False and p.DESCRIPTOR_A['approval'] is None and p.DESCRIPTOR_A['deadline'] is None
assert p.DESCRIPTOR_A['control_base']=='0e28cd177a3af0423092789647b439f60fed809f'
try:p.DESCRIPTOR_A['active']=True
except TypeError:pass
else:raise AssertionError('descriptor is mutable')
`);
});
