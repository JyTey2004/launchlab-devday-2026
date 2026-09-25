"""Bounded archive handling; repository code is never run on the operator host."""
import json, pathlib, stat, sys, zipfile

LIMIT = 30_000_000
EXTENSIONS = {'.html', '.js', '.mjs', '.css', '.json', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.avif', '.woff', '.woff2', '.ttf', '.txt', '.wasm', '.webmanifest', '.mp4'}

def entries(z):
    items = z.infolist()
    if len(items) > 5000 or sum(i.file_size for i in items) > LIMIT:
        raise ValueError('Archive exceeds size or file limit')
    seen = set()
    for i in items:
        p = pathlib.PurePosixPath(i.filename)
        if p.is_absolute() or '..' in p.parts or '\\' in i.filename or '\x00' in i.filename or stat.S_ISLNK(i.external_attr >> 16):
            raise ValueError('Unsafe archive entry')
        if i.filename in seen:
            raise ValueError('Duplicate archive entry')
        seen.add(i.filename)
        if not i.is_dir(): yield i, p

def source(archive, output, root):
    out = pathlib.Path(output); out.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as z:
        values = list(entries(z))
        prefixes = {p.parts[0] for _, p in values}
        if len(prefixes) != 1: raise ValueError('Expected one GitHub archive root')
        count = 0
        for i, path in values:
            rel = pathlib.PurePosixPath(*path.parts[1:])
            if root != '.':
                try: rel = rel.relative_to(root)
                except ValueError: continue
            if any(part.startswith('.') or part in ['node_modules', 'dist'] for part in rel.parts): continue
            if rel.suffix.lower() in ['.pem', '.key', '.p12', '.pfx']: continue
            target = out.joinpath(*rel.parts); target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(z.read(i)); count += 1
        if not count: raise ValueError('Selected repository root is empty')

def artifact(archive, output):
    out = pathlib.Path(output); out.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as z:
        for i, p in entries(z):
            if p.parts[0] not in ['site', 'evidence']: raise ValueError('Unexpected build artifact root')
            if any(part.startswith('.') for part in p.parts) or len(p.parts) < 2: raise ValueError('Hidden build artifact')
            if p.parts[0] == 'site' and (p.suffix.lower() not in EXTENSIONS or p.name in ['package.json', 'package-lock.json'] or '__launchlab' in p.parts): raise ValueError('Unsupported public artifact')
            if p.parts[0] == 'evidence' and p.name not in ['build-report.json', 'package.patch', 'package-lock.json', 'instrumentation.json']: raise ValueError('Unexpected evidence file')
            dest = out.joinpath(*p.parts); dest.parent.mkdir(parents=True, exist_ok=True); dest.write_bytes(z.read(i))
    if not (out/'site/index.html').is_file(): raise ValueError('Build produced no index.html')

def pack(directory, output):
    root = pathlib.Path(directory)
    paths = list(root.rglob('*'))
    if len(paths) > 5000 or sum(p.stat().st_size for p in paths if p.is_file()) > LIMIT: raise ValueError('Package exceeds limits')
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as z:
        for p in sorted(paths):
            if p.is_symlink(): raise ValueError('Symlinks are not supported')
            if p.is_file(): z.write(p, p.relative_to(root))

if __name__ == '__main__':
    if sys.argv[1] == 'source': source(*sys.argv[2:])
    elif sys.argv[1] == 'artifact': artifact(*sys.argv[2:])
    elif sys.argv[1] == 'pack': pack(*sys.argv[2:])
    else: raise ValueError('Unknown archive action')
