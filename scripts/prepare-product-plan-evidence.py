from pathlib import Path
import json, sqlite3
root = Path(__file__).resolve().parents[1]
out = root / 'output/product-plan-20260908'
v = json.loads((root/'output/real-api/public-papers-20260908/verification.json').read_text(encoding='utf-8'))
conn = sqlite3.connect(':memory:')
conn.row_factory = sqlite3.Row
conn.execute('CREATE TABLE provider_responses(original_order INTEGER, context TEXT, input INTEGER, output INTEGER, seconds REAL, response_id TEXT, log_file TEXT)')
conn.executemany('INSERT INTO provider_responses VALUES(?,?,?,?,?,?,?)', [(i,c['context'],c['input'],c['output'],c['seconds'],c['id'],c['file']) for i,c in enumerate(v['calls'])])
query = (out/'chart-source-query.sql').read_text(encoding='utf-8')
rows = [dict(r) for r in conn.execute(query)]
assert [r['output'] for r in rows] == [8697,12233,12634,7267]
assert len(rows) == 4
(out/'chart-source-data.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(rows,ensure_ascii=False))

