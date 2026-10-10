"""Inactive, pure deterministic product-packet adapter. No IO or execution CLI."""
import hashlib
import re
from types import MappingProxyType

PATH = 'v11/index.html'
PREIMAGE_BLOB = '5dc0fc4970f9c67a3c0d1a5e2467bf721566d5f3'
DESCRIPTOR_A = MappingProxyType({
    'id':'v11-terminal-entry-A', 'path':PATH, 'preimage_blob':PREIMAGE_BLOB,
    'control_base':'0e28cd177a3af0423092789647b439f60fed809f',
    'approval':None, 'deadline':None, 'active':False,
})
LABEL = 'Terminal öffnen'
HREF = '../v10/'
CSS_ANCHOR = '  </style>\n'
HTML_ANCHOR = '    <section id="version-panel" class="version-panel" aria-labelledby="version-history-heading" hidden>\n'
CSS = '''    /* Fixed packet A: visible terminal entry; no data or execution changes. */
    .terminal-entry{max-width:var(--container);margin:12px auto 0;display:flex;justify-content:flex-start;min-width:0}
    .terminal-entry-link{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;max-width:100%;padding:10px 14px;border:1px solid #44607b;border-radius:10px;background:#142235;color:#d7e6f6;font-size:13px;line-height:1.5;font-weight:650;text-underline-offset:3px;overflow-wrap:anywhere}
    .terminal-entry-link:focus-visible{outline:3px solid #9bc9ff;outline-offset:3px}
'''
HTML = '''    <nav class="terminal-entry" aria-label="Terminal-Zugang">
      <a class="terminal-entry-link" href="../v10/">Terminal öffnen</a>
    </nav>
'''


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def blob_sha(text):
    require(type(text) is str, 'Preimage must be UTF-8 text')
    raw = text.encode('utf-8')
    require(len(raw) <= 131072, 'Preimage exceeds packet bound')
    return hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()


def validate_preimage(preimage):
    require(blob_sha(preimage) == PREIMAGE_BLOB, 'Unreviewed preimage; packet re-review required')
    require(preimage.count(CSS_ANCHOR) == 1 and preimage.count(HTML_ANCHOR) == 1,
            'Packet insertion anchors must be unique')
    require('terminal-entry' not in preimage, 'Packet already applied or namespace occupied')
    require(preimage.count('<script>') == 1 and preimage.count('</script>') == 1,
            'Unexpected executable blocks')


def transform(preimage, modeldata):
    """Return exactly one candidate file, never apply it or authorize publication.

    Model data is a fixed acknowledgement, not generated HTML/CSS/JavaScript.
    Existing claim/artifact/publisher machinery must separately authorize a run.
    """
    validate_preimage(preimage)
    require(type(modeldata) is dict and set(modeldata) == {'label', 'href'}
            and type(modeldata['label']) is str and modeldata['label'] == LABEL
            and type(modeldata['href']) is str and modeldata['href'] == HREF,
            'Only the exact reviewed label and relative destination are allowed')
    output = preimage.replace(CSS_ANCHOR, CSS + CSS_ANCHOR, 1)
    output = output.replace(HTML_ANCHOR, HTML + HTML_ANCHOR, 1)
    require(re.findall(r'<script\b[^>]*>.*?</script>', output, re.S) ==
            re.findall(r'<script\b[^>]*>.*?</script>', preimage, re.S), 'Executable content changed')
    require(output.replace(CSS, '', 1).replace(HTML, '', 1) == preimage,
            'Changes exceed the two fixed insertions')
    return {PATH:output}
