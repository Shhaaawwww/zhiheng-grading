import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const python = process.env.PYTHON || 'python';
const packager = path.join(root, 'scripts/package-source.py');
const checker = path.join(root, 'scripts/check-release-secrets.py');
const inventory = spawnSync(python, ['-c', 'import json,sys; sys.path.insert(0,sys.argv[1]); from release_safety import ROOT_FILES; print(json.dumps(sorted(ROOT_FILES)))', path.join(root, 'scripts')], { encoding: 'utf8' });
assert.equal(inventory.status, 0, inventory.stderr);
const required = JSON.parse(inventory.stdout);

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'zhiheng-source-safety-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const name of required) writeFileSync(path.join(directory, name), name.endsWith('.json') ? JSON.stringify({ version: '0.0.0-test' }) : 'Release fixture\n');
  for (const folder of ['server', 'src', 'tests', 'scripts', 'public/help', 'electron/assets', 'docs', '.github/workflows']) mkdirSync(path.join(directory, folder), { recursive: true });
  writeFileSync(path.join(directory, 'server/example.mjs'), 'export const example = 1;\n');
  return directory;
}
function run(script, directory, extra = [], env = process.env) {
  return spawnSync(python, ['-O', script, '--root', directory, ...extra], { encoding: 'utf8', env });
}

test('source checks allow approved docs and CI without requiring paid or desktop artifacts', t => {
  const directory = fixture(t);
  writeFileSync(path.join(directory, 'docs/audit-open-source.md'), 'Public audit\n');
  writeFileSync(path.join(directory, '.github/workflows/ci.yml'), 'name: checks\n');
  const result = run(checker, directory, ['--source-only']);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(JSON.parse(result.stdout).sourceOnly, true);
});

test('unapproved tables, private configuration, databases and PDFs fail before replacing a package', t => {
  const directory = fixture(t);
  const target = path.join(directory, 'release/Zhiheng-Source-0.0.0-test.zip');
  mkdirSync(path.dirname(target));
  const original = Buffer.from('previous reviewed package');
  writeFileSync(target, original);
  for (const name of ['src/roster.xlsx', 'server/.env.local', 'server/private.sqlite-wal', 'scripts/network.json', 'scripts/legacy-runner.mjs', 'public/help/student.pdf']) {
    const file = path.join(directory, name);
    writeFileSync(file, 'Private fixture');
    const result = run(packager, directory);
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.ok(JSON.parse(result.stdout).matches.some(f => f.file === name && f.rule === 'unapproved-source-file'));
    assert.deepEqual(readFileSync(target), original);
    rmSync(file);
  }
});

test('local archives stay out of source packages even when they contain private material', t => {
  const directory = fixture(t);
  mkdirSync(path.join(directory, 'archive/historical-delivery'), { recursive: true });
  const token = ['sk', 'proj', 'F'.repeat(40)].join('-');
  writeFileSync(path.join(directory, 'archive/historical-delivery/private-notes.md'), token);
  const result = run(packager, directory);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const validation = spawnSync(python, ['-c', 'import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); names=z.namelist(); data=b"".join(z.read(n) for n in names); safe=not any("/archive/" in n for n in names) and sys.argv[2].encode() not in data; print(json.dumps({"archiveExcluded":safe})); sys.exit(0 if safe else 1)', JSON.parse(result.stdout).output, token], { encoding: 'utf8' });
  assert.equal(validation.status, 0, validation.stderr + validation.stdout);
  assert.equal(JSON.parse(validation.stdout).archiveExcluded, true);
});

test('provider tokens and private keys are blocked without printing their values, including with Python optimization', t => {
  const directory = fixture(t);
  const samples = [
    ['sk', 'proj', 'A'.repeat(40)].join('-'),
    ['sk', 'ant', 'B'.repeat(40)].join('-'),
    ['Bearer', 'C'.repeat(32)].join(' '),
    ['AKIA', 'D'.repeat(16)].join(''),
    ['-----BEGIN', 'PRIVATE KEY-----'].join(' '),
  ];
  for (const token of samples) {
    writeFileSync(path.join(directory, 'server/example.mjs'), `export const example = ${JSON.stringify(token)};\n`);
    const result = run(packager, directory);
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.ok(JSON.parse(result.stdout).matches.length > 0);
    assert.ok(!result.stdout.includes(token));
    assert.ok(!result.stderr.includes(token));
  }
});

test('provided arbitrary credentials are checked and approved package integrity is independently readable', t => {
  const directory = fixture(t);
  const token = ['custom', 'credential', 'E'.repeat(40)].join('-');
  writeFileSync(path.join(directory, 'server/example.mjs'), `export const example = ${JSON.stringify(token)};\n`);
  const denied = run(checker, directory, ['--source-only'], { ...process.env, KNOWN_RELEASE_SECRET: token });
  assert.equal(denied.status, 1, denied.stderr + denied.stdout);
  assert.ok(JSON.parse(denied.stdout).matches.some(f => f.rule === 'provided-credential'));
  assert.ok(!denied.stdout.includes(token));
  writeFileSync(path.join(directory, 'server/example.mjs'), 'export const example = 1;\n');
  const accepted = run(packager, directory);
  assert.equal(accepted.status, 0, accepted.stderr + accepted.stdout);
  const zip = JSON.parse(accepted.stdout).output;
  const validation = spawnSync(python, ['-c', 'import hashlib,json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); m=json.loads(z.read("Zhiheng-0.0.0-test/SOURCE_MANIFEST.json")); valid=z.testzip() is None and all(hashlib.sha256(z.read("Zhiheng-0.0.0-test/"+p)).hexdigest()==h for p,h in m.items()); print(json.dumps({"valid":valid,"entries":len(m)})); sys.exit(0 if valid else 1)', zip], { encoding: 'utf8' });
  assert.equal(validation.status, 0, validation.stderr + validation.stdout);
  assert.equal(JSON.parse(validation.stdout).valid, true);
});
