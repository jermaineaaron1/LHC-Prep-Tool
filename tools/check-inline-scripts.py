#!/usr/bin/env python3
"""Extract every inline <script> block from a single-file HTML app and, with
--check, run `node --check` over each one.

Index.html has no build step, so a syntax error in any of its inline scripts is
only found at runtime in the browser -- and a broken block silently disables
every function defined in it. This is the cheap guard: run it after editing
Index.html and before committing.

Blocks with a src= attribute are skipped (nothing local to check).

Usage
  python tools/check-inline-scripts.py --check          # ../Index.html
  python tools/check-inline-scripts.py path/to.html --check
  python tools/check-inline-scripts.py --out DIR        # just extract

Exit code 0 = all blocks parsed, 1 = at least one syntax error (with --check).
"""

import argparse
import os
import re
import subprocess
import sys
import tempfile

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# <script ...>...</script>, non-greedy, dot matches newline.
SCRIPT_RE = re.compile(r'<script(?P<attrs>[^>]*)>(?P<body>.*?)</script\s*>', re.S | re.I)


def extract(src, outdir):
    with open(src, encoding='utf-8') as fh:
        html = fh.read()

    os.makedirs(outdir, exist_ok=True)
    for name in os.listdir(outdir):
        if name.endswith('.js'):
            os.remove(os.path.join(outdir, name))

    blocks = []
    for match in SCRIPT_RE.finditer(html):
        if 'src=' in match.group('attrs').lower():
            continue  # external script, nothing local to check
        body = match.group('body')
        line = html.count('\n', 0, match.start()) + 1
        path = os.path.join(outdir, 'block_%02d_line%d.js' % (len(blocks) + 1, line))
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(body)
        blocks.append((path, line, len(body)))
    return blocks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src', nargs='?', default=os.path.join(REPO_ROOT, 'Index.html'))
    ap.add_argument('--out', help='where to write the extracted .js files')
    ap.add_argument('--check', action='store_true', help='run node --check on each block')
    args = ap.parse_args()

    if not os.path.isfile(args.src):
        sys.exit('No such file: ' + args.src)

    outdir = args.out or os.path.join(tempfile.gettempdir(), 'lhc-inline-scripts')
    blocks = extract(args.src, outdir)

    print('%s: %d inline block(s) -> %s' % (os.path.basename(args.src), len(blocks), outdir))
    if not args.check:
        for path, line, size in blocks:
            print('  %-28s line %-6d %d bytes' % (os.path.basename(path), line, size))
        return 0

    failed = 0
    for path, line, _ in blocks:
        proc = subprocess.run(['node', '--check', path],
                              capture_output=True, text=True)
        if proc.returncode == 0:
            print('  OK    %s (line %d)' % (os.path.basename(path), line))
        else:
            failed += 1
            print('  FAIL  %s (line %d)' % (os.path.basename(path), line))
            print(proc.stderr.rstrip())

    print('-' * 32)
    if failed:
        print('%d of %d block(s) FAILED' % (failed, len(blocks)))
        return 1
    print('all %d block(s) pass node --check' % len(blocks))
    return 0


if __name__ == '__main__':
    sys.exit(main())
