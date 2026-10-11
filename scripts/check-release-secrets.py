"""Inspect release artifacts or current source; never print matched credentials."""
from pathlib import Path
import argparse, json, os, zipfile
from release_safety import ReleaseSafetyError, inspect, package_version, source_snapshot


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-only', action='store_true', help='Validate current source without requiring desktop or example packages')
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    root = args.root.resolve()
    secret = os.environ.pop('KNOWN_RELEASE_SECRET', '').encode()
    matches, checked = [], []
    try:
        source = source_snapshot(root, secret)
        checked.extend(source)
    except ReleaseSafetyError as error:
        matches.extend(error.findings)
        source = None
    if not args.source_only and source is not None:
        version = package_version(source)
        for name in [f'Zhiheng-Source-{version}.zip', f'Zhiheng-{version}-示例报告与录分表.zip']:
            file = root / 'release' / name
            if not file.is_file():
                matches.append({'file': name, 'rule': 'release-artifact-missing'})
                continue
            try:
                with zipfile.ZipFile(file) as archive:
                    if archive.testzip() is not None:
                        matches.append({'file': name, 'rule': 'zip-integrity'})
                    for entry in archive.infolist():
                        if not entry.is_dir():
                            location = name + '/' + entry.filename
                            checked.append(location)
                            matches.extend(inspect(location, archive.read(entry), secret))
            except (OSError, zipfile.BadZipFile):
                matches.append({'file': name, 'rule': 'release-artifact-unreadable'})
        file = root / 'release/win-unpacked/resources/app.asar'
        if not file.is_file():
            matches.append({'file': 'app.asar', 'rule': 'release-artifact-missing'})
        else:
            checked.append('app.asar')
            matches.extend(inspect('app.asar', file.read_bytes(), secret))
    result = {'ok': not matches, 'filesChecked': len(checked), 'sourceOnly': args.source_only, 'providedCredentialChecked': bool(secret), 'matches': matches}
    # Source-only checks are read-only and usable in a clean checkout or CI.
    if not args.source_only:
        folder = root / 'output'
        folder.mkdir(exist_ok=True)
        (folder / 'release-secrets-check.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())

