#!/usr/bin/env python3
"""In-memory structural check of pages-activation.patch. Writes nothing.

Reads the PR1092 template via `git show`, applies the patch hunks to that string,
and compares old/new blob IDs. It does not run git apply or touch workflow paths.
"""
import hashlib
import pathlib
import re
import subprocess
import sys

TEMPLATE_REV = "2e788edc522542d26e489d553be33fa44a680d62"
OLD = "docs/operations/pages-publication.yml.disabled"
NEW = ".github/workflows/pages-publication.yml"
OLD_BLOB = "20002686c294ba7099ec56705618dc3891584d6b"


def blob(text):
    data = text.encode()
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def main():
    patch = (pathlib.Path(__file__).parent / "pages-activation.patch").read_text()
    old = subprocess.run(["git", "show", f"{TEMPLATE_REV}:{OLD}"], check=True,
                         capture_output=True, text=True).stdout
    lines = patch.splitlines(True)
    header = [f"diff --git a/{OLD} b/{NEW}\n", f"rename from {OLD}\n", f"rename to {NEW}\n"]
    assert lines[:3] == header, "unexpected rename header"
    m = re.fullmatch(r"index ([0-9a-f]{40})\.\.([0-9a-f]{40}) 100644\n", lines[3])
    assert m and m.group(1) == OLD_BLOB == blob(old), "template blob mismatch"
    assert lines[4:6] == [f"--- a/{OLD}\n", f"+++ b/{NEW}\n"], "unexpected file header"
    assert sum(l.startswith("diff --git") for l in lines) == 1, "patch must touch one file"

    src, out, i, pos = old.splitlines(True), [], 6, 0
    while i < len(lines):
        h = re.match(r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", lines[i])
        assert h, f"bad hunk header at line {i + 1}"
        start = int(h.group(1)) - 1
        out += src[pos:start]
        pos, i = start, i + 1
        while i < len(lines) and not lines[i].startswith("@@"):
            tag, text = lines[i][0], lines[i][1:]
            if tag in " -":
                assert src[pos] == text, f"context mismatch at template line {pos + 1}"
                pos += 1
            if tag in " +":
                out.append(text)
            i += 1
    new = "".join(out + src[pos:])
    assert blob(new) == m.group(2), "result blob mismatch"
    changed = [(a, b) for a, b in zip(old.splitlines(), new.splitlines()) if a != b]
    assert len(old.splitlines()) == len(new.splitlines()) and len(changed) == 3
    assert all(a.startswith("#") and b.startswith("#") for a, b in changed), "non-comment change"
    print(f"OK in-memory: {OLD_BLOB} -> {m.group(2)}; 3 comment lines changed; "
          "YAML body byte-identical; git apply/workflow validation NOT PERFORMED")


if __name__ == "__main__":
    sys.exit(main())
