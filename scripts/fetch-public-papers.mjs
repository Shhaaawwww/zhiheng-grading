import fs from 'node:fs';
import path from 'node:path';
const sources = [
 ['output/real-api/public-papers-20260908/national1-2024/source.pdf', 'https://static-gkcx.gaokao.cn/upload/zhenti/20240611/1718078152_5550.pdf'],
 ['output/real-api/public-papers-20260908/national2-2024/source.pdf', 'https://static-gkcx.gaokao.cn/upload/zhenti/20240609/1717916773_9867.pdf'],
 ['output/real-api/public-papers-20260908/haidian-2024/source.pdf', 'https://cdn.gaokzx.com/zixunzhan/202403/b67ffbbe-abee-4c7c-8630-5f73d5cde19d.pdf'],
 ['output/real-api/release-020/sources/national-a-2024.pdf', 'https://static-gkcx.gaokao.cn/upload/zhenti/20240826/1724667231_6668.pdf'],
];
for (const [file, url] of sources) {
 if (fs.existsSync(file) && fs.readFileSync(file).subarray(0, 5).toString() === '%PDF-') continue;
 const r = await fetch(url, { signal: AbortSignal.timeout(60000) }); if (!r.ok) throw Error(`${r.status}: ${url}`);
 const bytes = Buffer.from(await r.arrayBuffer()); if (bytes.subarray(0, 5).toString() !== '%PDF-') throw Error('Source no longer returns a PDF');
 fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); console.log('Downloaded public source', file);
}
console.log('Public sources ready. Source rights remain with their owners; do not bundle them into a public code release.');
