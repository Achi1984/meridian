#!/usr/bin/env python3
"""In-memory structural check of pages-activation.patch. Writes nothing."""
import hashlib
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
OLD = "docs/operations/pages-publication.yml.disabled"
NEW = ".github/workflows/pages-publication.yml"
OLD_BLOB = "20002686c294ba7099ec56705618dc3891584d6b"
NEW_BLOB = "1dd11512cec3d9a8dd5dfd93fae3b7c8ccbfa74c"


def blob(text):
    data = text.encode()
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def main():
    patch_path = ROOT / "docs/operations/pages-recovery-20261101/pages-activation.patch"
    patch = patch_path.read_text()
    old = (ROOT / OLD).read_text()
    lines = patch.splitlines(True)
    header = [f"diff --git a/{OLD} b/{NEW}\n", f"rename from {OLD}\n", f"rename to {NEW}\n"]
    assert lines[:3] == header, "unexpected rename header"
    match = re.fullmatch(r"index ([0-9a-f]{40})\.\.([0-9a-f]{40}) 100644\n", lines[3])
    assert match and match.group(1) == OLD_BLOB == blob(old), "template blob mismatch"
    assert match.group(2) == NEW_BLOB, "activation result blob mismatch"
    assert lines[4:6] == [f"--- a/{OLD}\n", f"+++ b/{NEW}\n"], "unexpected file header"
    assert sum(line.startswith("diff --git") for line in lines) == 1, "patch must touch one file"

    source, output, index, position = old.splitlines(True), [], 6, 0
    while index < len(lines):
        header_match = re.match(r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", lines[index])
        assert header_match, f"bad hunk header at line {index + 1}"
        start = int(header_match.group(1)) - 1
        output += source[position:start]
        position, index = start, index + 1
        while index < len(lines) and not lines[index].startswith("@@"):
            tag, text = lines[index][0], lines[index][1:]
            if tag in " -":
                assert source[position] == text, f"context mismatch at template line {position + 1}"
                position += 1
            if tag in " +":
                output.append(text)
            index += 1
    updated = "".join(output + source[position:])
    assert blob(updated) == NEW_BLOB, "result blob mismatch"
    changed = [(before, after) for before, after in zip(old.splitlines(), updated.splitlines())
               if before != after]
    assert len(old.splitlines()) == len(updated.splitlines()) and len(changed) == 3
    assert all(before.startswith("#") and after.startswith("#") for before, after in changed), \
        "non-comment change"
    print(f"OK in-memory: {OLD_BLOB} -> {NEW_BLOB}; 3 comment lines changed; "
          "YAML body byte-identical; git apply/workflow validation NOT PERFORMED")


if __name__ == "__main__":
    sys.exit(main())
