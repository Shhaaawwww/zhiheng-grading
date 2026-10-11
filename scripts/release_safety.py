"""Fail-closed source release policy; diagnostics never include matched values."""
from pathlib import Path
import json, re

ROOT_FILES = frozenset({
    '.gitignore', 'package.json', 'package-lock.json', 'tsconfig.json',
    'vite.config.ts', 'index.html', 'README.md', 'LICENSE',
    'THIRD_PARTY_NOTICES.md', 'CONTRIBUTING.md', 'SECURITY.md',
    'CHANGELOG.md', 'TESTING.md', 'FILE_MANAGEMENT.md',
    '教师操作指南-0.3.md',
})
PUBLIC_SCRIPTS = frozenset({
    'scripts/dev.mjs', 'scripts/build-teacher-guide.mjs',
    'scripts/check-package.mjs', 'scripts/desktop-smoke.ps1',
    'scripts/installer-smoke.ps1', 'scripts/release-ui.mjs',
    'scripts/package-source.py', 'scripts/check-release-secrets.py',
    'scripts/release_safety.py',
})
SOURCE_DIRECTORIES = ('server', 'src', 'electron', 'public', 'tests', 'scripts', 'docs', '.github')
ASSETS = frozenset({
    'electron/main.cjs', 'electron/preload.cjs',
    'electron/assets/icon.ico', 'electron/assets/icon.png',
    'public/favicon.svg', 'public/help/guide.html',
    'public/help/classes.png', 'public/help/grade.png', 'public/help/prepare.png',
    'public/help/reports.png', 'public/help/review.png', 'public/help/settings.png',
    'public/help/welcome.png', 'public/help/知衡-教师上手指南.pdf',
    '.github/workflows/ci.yml',
})
EXTENSIONS = {
    'server': frozenset({'.mjs'}),
    'src': frozenset({'.ts', '.tsx', '.css'}),
    'docs': frozenset({'.md'}),
}
PATTERNS = (
    ('api-key-token', re.compile(rb'\bsk-[A-Za-z0-9_-]{20,}\b')),
    ('google-api-key', re.compile(rb'\bAIza[A-Za-z0-9_-]{30,}\b')),
    ('aws-access-key', re.compile(rb'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b')),
    ('github-token', re.compile(rb'\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}\b')),
    ('slack-token', re.compile(rb'\bxox[baprs]-[A-Za-z0-9-]{20,}\b')),
    ('bearer-token', re.compile(rb'\bBearer[ \t]+[A-Za-z0-9._~+/=-]{20,}', re.I)),
    ('private-key', re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----')),
    ('credential-literal', re.compile(
        rb'''\b(?:api[_-]?key|access[_-]?token|client[_-]?secret)["']?\s*[:=]\s*["'][A-Za-z0-9_./+=-]{24,}["']''', re.I)),
    ('quiz-student-id', re.compile(rb'\b11552[0-9]{5}\b')),
)

class ReleaseSafetyError(ValueError):
    def __init__(self, findings):
        self.findings = findings
        details = '; '.join(f"{f['file']} [{f['rule']}]" for f in findings)
        super().__init__('Release validation rejected source: ' + details)

def inspect(name, data, secret=b''):
    findings = []
    if secret and secret in data:
        findings.append({'file': name, 'rule': 'provided-credential'})
    for rule, pattern in PATTERNS:
        if pattern.search(data):
            findings.append({'file': name, 'rule': rule})
    return findings

def package_version(files):
    version = json.loads(files['package.json'].decode('utf-8'))['version']
    if not isinstance(version, str) or not version or not re.fullmatch(r'[A-Za-z0-9.-]+', version):
        raise ValueError('Invalid package version for release filename')
    return version

def approved_path(name):
    p = Path(name)
    parts = p.parts
    if not parts or p.is_absolute() or '..' in parts:
        return False
    if name in ROOT_FILES or name in ASSETS or name in PUBLIC_SCRIPTS:
        return True
    if any(part.startswith('.') for part in parts):
        return False
    if parts[0] == 'tests':
        return p.name.endswith('.test.mjs')
    return p.suffix in EXTENSIONS.get(parts[0], ())

def source_snapshot(root, secret=b''):
    """Validate and read each selected file once before any output is written."""
    root = Path(root).resolve()
    findings, files = [], {}
    for name in sorted(ROOT_FILES):
        if not (root / name).is_file():
            findings.append({'file': name, 'rule': 'required-file-missing'})
    candidates = [root / name for name in ROOT_FILES if (root / name).is_file()]
    for directory in SOURCE_DIRECTORIES:
        base = root / directory
        if base.is_symlink():
            findings.append({'file': directory, 'rule': 'symbolic-link'})
            continue
        if base.exists():
            candidates.extend(p for p in base.rglob('*') if p.is_file() or p.is_symlink())
    for p in sorted(set(candidates)):
        name = p.relative_to(root).as_posix()
        if '__pycache__' in p.parts and p.suffix in {'.pyc', '.pyo'}:
            continue
        if p.is_symlink() or any(parent.is_symlink() for parent in p.parents if parent != root):
            findings.append({'file': name, 'rule': 'symbolic-link'})
            continue
        if not approved_path(name):
            findings.append({'file': name, 'rule': 'unapproved-source-file'})
            continue
        if not p.is_file() or not p.resolve().is_relative_to(root):
            findings.append({'file': name, 'rule': 'source-path-outside-root'})
            continue
        data = p.read_bytes()
        findings.extend(inspect(name, data, secret))
        files[name] = data
    if findings:
        raise ReleaseSafetyError(findings)
    return dict(sorted(files.items()))
