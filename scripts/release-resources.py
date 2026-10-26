#!/usr/bin/env python3
"""Stage and verify the configured Tauri file resources for raw-binary releases.

This is a content-integrity receipt, not permission or owner/spend authority.
No configured path is executed; the mapping is closed, and symlinks are refused.
"""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys

RESERVED = {'termfleet', 'manifest.env', 'resources.json'}

def digest(data):
    return hashlib.sha256(data).hexdigest()

def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)+'\n').encode('utf-8')

def unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError('duplicate JSON key')
        value[key] = item
    return value

def relative(value):
    if not isinstance(value, str) or not value or '\\' in value or '\x00' in value:
        raise ValueError('invalid relative resource path')
    p = PurePosixPath(value)
    if p.is_absolute() or any(x in {'.', '..'} for x in value.split('/')) or any(not x for x in value.split('/')):
        raise ValueError('resource path escape or unnormalized path')
    return p

def real_root(path):
    path = Path(os.path.abspath(path))
    if path.is_symlink() or not path.is_dir() or path.resolve() != path:
        raise ValueError('resource root or ancestor is redirected')
    return path

def open_parent(root, parts, create=False):
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in parts[:-1]:
            if create:
                try:
                    os.mkdir(part, 0o755, dir_fd=fd)
                    os.fsync(fd)
                except FileExistsError:
                    pass
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise

def read_file(root, rel):
    """Open beneath a directory using no-follow at every path component."""
    parts = relative(rel).parts
    fd = open_parent(root, parts)
    try:
        file_fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        try:
            before = os.fstat(file_fd)
            if not stat.S_ISREG(before.st_mode):
                raise ValueError('resource is not a regular file')
            data = bytearray()
            while True:
                chunk = os.read(file_fd, 65536)
                if not chunk:
                    break
                data.extend(chunk)
            after = os.fstat(file_fd)
            if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns) or len(data) != before.st_size:
                raise ValueError('resource changed while reading')
            return bytes(data), stat.S_IMODE(before.st_mode) & 0o777
        finally:
            os.close(file_fd)
    finally:
        os.close(fd)

def inventory(app):
    app = real_root(app)
    config, _ = read_file(app, 'src-tauri/tauri.conf.json')
    document = json.loads(config, object_pairs_hook=unique_object)
    if not isinstance(document, dict) or not isinstance(document.get('bundle'), dict):
        raise ValueError('invalid Tauri resource configuration')
    mapping = document.get('bundle', {}).get('resources')
    if not isinstance(mapping, dict) or not mapping:
        raise ValueError('bundle.resources must be a nonempty explicit file mapping')
    rows, contents, targets = [], {}, set()
    for source, target in mapping.items():
        dst = relative(target)
        if dst.parts[0] in RESERVED:
            raise ValueError('resource target collides with release metadata or binary')
        if not isinstance(source, str) or not source or '\\' in source or '\x00' in source or Path(source).is_absolute():
            raise ValueError('invalid configured resource source')
        src = Path(os.path.normpath(str(app/'src-tauri'/source)))
        if not src.is_relative_to(app):
            raise ValueError('configured resource source escapes public app root')
        src_rel = src.relative_to(app).as_posix()
        data, mode = read_file(app, src_rel)
        # Ordinary public release files: retain executable bits, remove group write.
        mode = 0o644 | (mode & 0o111)
        if target in targets or any(target.startswith(old+'/') or old.startswith(target+'/') for old in targets):
            raise ValueError('configured resource targets overlap')
        targets.add(target)
        rows.append({'source': src_rel, 'target': target, 'bytes': len(data), 'sha256': digest(data), 'mode': mode})
        contents[target] = data
    rows.sort(key=lambda item: item['target'])
    return {'version': 1, 'configSha256': digest(config), 'files': rows}, contents

def stage(app, destination, expected):
    receipt, contents = inventory(app)
    encoded = canonical(receipt)
    checksum = digest(encoded)
    if expected is not None and checksum != expected:
        raise ValueError('configured resources changed after inventory')
    root = real_root(destination)
    for row in receipt['files']:
        parts = relative(row['target']).parts
        parent_fd = open_parent(root, parts, create=True)
        try:
            fd = os.open(parts[-1], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, row['mode'], dir_fd=parent_fd)
            with os.fdopen(fd, 'wb') as stream:
                stream.write(contents[row['target']])
                stream.flush()
                os.fchmod(stream.fileno(), row['mode'])
                os.fsync(stream.fileno())
            os.fsync(parent_fd)
        finally:
            os.close(parent_fd)
    parent_fd = open_parent(root, ('resources.json',))
    try:
        fd = os.open('resources.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644, dir_fd=parent_fd)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        os.fsync(parent_fd)
    finally:
        os.close(parent_fd)
    verify(root, checksum)
    return checksum

def verify(root, expected):
    root = real_root(root)
    encoded, _ = read_file(root, 'resources.json')
    if digest(encoded) != expected:
        raise ValueError('resource inventory checksum mismatch')
    receipt = json.loads(encoded, object_pairs_hook=unique_object)
    if not isinstance(receipt, dict) or canonical(receipt) != encoded or set(receipt) != {'version', 'configSha256', 'files'} or type(receipt['version']) is not int or receipt['version'] != 1 or not isinstance(receipt['files'], list) or not receipt['files']:
        raise ValueError('invalid resource inventory schema')
    if not isinstance(receipt['configSha256'], str) or len(receipt['configSha256']) != 64 or any(x not in '0123456789abcdef' for x in receipt['configSha256']):
        raise ValueError('invalid resource configuration receipt')
    expected_files, expected_dirs = set(), set()
    for row in receipt['files']:
        if not isinstance(row, dict) or set(row) != {'source', 'target', 'bytes', 'sha256', 'mode'}:
            raise ValueError('invalid resource row')
        relative(row['source'])
        p = relative(row['target'])
        if p.parts[0] in RESERVED or row['target'] in expected_files:
            raise ValueError('resource target is duplicate or reserved')
        if type(row['bytes']) is not int or row['bytes'] < 0 or type(row['mode']) is not int or not 0 <= row['mode'] <= 0o777:
            raise ValueError('invalid resource size or mode')
        data, mode = read_file(root, row['target'])
        if len(data) != row['bytes'] or digest(data) != row['sha256'] or mode != row['mode']:
            raise ValueError('installed resource bytes or mode drifted: '+row['target'])
        expected_files.add(row['target'])
        expected_dirs.update(parent.as_posix() for parent in p.parents if parent.as_posix() != '.')
    actual_files, actual_dirs = set(), set()
    for path in root.rglob('*'):
        name = path.relative_to(root).as_posix()
        shape = path.lstat().st_mode
        if name in RESERVED and stat.S_ISREG(shape):
            continue
        if stat.S_ISDIR(shape):
            actual_dirs.add(name)
        elif stat.S_ISREG(shape):
            actual_files.add(name)
        else:
            raise ValueError('installed resource contains symlink or special entry')
    if actual_files != expected_files or actual_dirs != expected_dirs:
        raise ValueError('installed resource tree has missing or unexpected entries')
    return expected

def manifest_checksum(root):
    """Distinguish a genuinely absent field from malformed declarations."""
    root = real_root(root)
    encoded, _ = read_file(root, 'manifest.env')
    declaration = re.compile(r'^\s*(?:export\s+)?TERMFLEET_RESOURCES_SHA256(?:\s|=|$)')
    fields = [line for line in encoded.decode('utf-8').split('\n') if declaration.match(line)]
    if not fields:
        return 'absent'
    if len(fields) != 1 or not re.fullmatch(r'TERMFLEET_RESOURCES_SHA256=[0-9a-f]{64}', fields[0]):
        raise ValueError('resource checksum declaration must be unique, exact and nonempty')
    return fields[0].split('=', 1)[1]

def main():
    if len(sys.argv) == 3 and sys.argv[1] == 'inventory':
        receipt, _ = inventory(sys.argv[2]); print(digest(canonical(receipt)))
    elif len(sys.argv) in {4, 5} and sys.argv[1] == 'stage':
        print(stage(sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) == 5 else None))
    elif len(sys.argv) == 4 and sys.argv[1] == 'verify':
        print(verify(sys.argv[2], sys.argv[3]))
    elif len(sys.argv) == 3 and sys.argv[1] == 'manifest-checksum':
        print(manifest_checksum(sys.argv[2]))
    else:
        raise ValueError('usage: release-resources.py inventory APP | stage APP RELEASE [SHA] | verify RELEASE SHA | manifest-checksum RELEASE')

if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, TypeError, KeyError) as error:
        print('FAIL: release resources: '+str(error), file=sys.stderr)
        sys.exit(1)
