"""Validate a source-only release before atomically replacing the current package."""
from pathlib import Path
import argparse, hashlib, json, os, tempfile, zipfile
from release_safety import ReleaseSafetyError, package_version, source_snapshot


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    root = args.root.resolve()
    secret = os.environ.pop('KNOWN_RELEASE_SECRET', '').encode()
    try:
        files = source_snapshot(root, secret)
    except ReleaseSafetyError as error:
        print(json.dumps({'ok': False, 'matches': error.findings}, ensure_ascii=False))
        return 1
    version = package_version(files)
    manifest = {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}
    release = root / 'release'
    if release.is_symlink() or (release.exists() and not release.resolve().is_relative_to(root)):
        raise ValueError('Release output directory must stay inside the source root')
    release.mkdir(exist_ok=True)
    output = release / f'Zhiheng-Source-{version}.zip'
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(prefix='.source-release-', suffix='.tmp', dir=release, delete=False) as handle:
            temporary = Path(handle.name)
        with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for name, data in files.items():
                archive.writestr(f'Zhiheng-{version}/{name}', data)
            archive.writestr(f'Zhiheng-{version}/SOURCE_MANIFEST.json', json.dumps(manifest, ensure_ascii=False, indent=2))
        with zipfile.ZipFile(temporary) as archive:
            if archive.testzip() is not None:
                raise ValueError('Source release failed ZIP integrity validation')
            for name, digest in manifest.items():
                if hashlib.sha256(archive.read(f'Zhiheng-{version}/{name}')).hexdigest() != digest:
                    raise ValueError('Source release failed manifest validation: ' + name)
        os.replace(temporary, output)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    checks = root / 'output'
    checks.mkdir(exist_ok=True)
    (checks / 'source-package-check.json').write_text(json.dumps({'ok': True, 'files': len(files), 'runtimeDataExcluded': True, 'credentialsChecked': True, 'manifestVerified': True, 'zip': output.name}, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'ok': True, 'files': len(files), 'output': str(output)}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

