import { chapters, faqs } from "../src/help-content.ts";
import { chromium } from "playwright-core";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const folder = path.resolve("public/help");
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
mkdirSync(folder, { recursive: true });
mkdirSync("release", { recursive: true });
const escape = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const pages = chapters.map(
  (chapter, index) =>
    `<section class="guide-page"><header><span>知衡 · 教师上手指南</span><span>${index + 1} / ${chapters.length + 1}</span></header><h1>${escape(chapter.title)}</h1><p class="subtitle">${escape(chapter.subtitle)}</p>${index === 0 ? '<div class="route"><b>建班级和考试</b><span>→</span><b>导入 PDF 自动识别</b><span>→</span><b>人工录分或 AI 预批</b><span>→</span><b>看学情与报告</b></div>' : ""}<ol>${chapter.steps.map((s) => `<li><h2>${escape(s.title)}</h2><p>${escape(s.text)}</p></li>`).join("")}</ol><aside>${escape(chapter.tip)}</aside>${chapter.image ? `<figure><img src="${escape(chapter.image)}" alt="${escape(chapter.caption)}"><figcaption>${escape(chapter.caption)} 图中班级与成绩均为虚构的验收或示例数据。</figcaption></figure>` : '<div class="service-note"><strong>不需要先学 AI 知识</strong><p>日常使用的中心仍是教师确认的题目、分数和备注。连接服务可以请人协助，是否采用建议由教师决定。</p></div>'}<footer>对应软件 ${escape(version)} · 软件内可随时点击“使用帮助”或“本页怎么用”查看同样的操作说明。</footer></section>`,
);
pages.push(
  `<section class="guide-page"><header><span>知衡 · 教师上手指南</span><span>${chapters.length + 1} / ${chapters.length + 1}</span></header><h1>常见问题</h1><p class="subtitle">遇到问题时，先按这里的方法检查。</p><div class="faq-list">${faqs.map((f) => `<article><h2>${escape(f.q)}</h2><p>${escape(f.a)}</p></article>`).join("")}</div><footer>本指南与软件内帮助来自同一份说明。实际智能识别及评分质量仍需结合所用服务和匿名样卷核对。</footer></section>`,
);
const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>知衡 · 教师上手指南</title><style>
@page{size:A4;margin:14mm 16mm}*{box-sizing:border-box}body{font:14px/1.75 "Microsoft YaHei","Segoe UI",sans-serif;color:#243e4b;margin:0;background:#edf2f4}.guide-page{max-width:740px;background:#fff;padding:40px;margin:24px auto;break-after:page}.guide-page:last-child{break-after:auto}header{display:flex;justify-content:space-between;color:#19796e;font-size:11px;letter-spacing:1px;border-bottom:1px solid #d9e5e5;padding-bottom:9px}h1{font-size:26px;line-height:1.4;margin:18px 0 6px}h2{font-size:14px;margin:0;color:#254c57}p{margin:3px 0 0}.subtitle{color:#647e89;margin-bottom:18px}.route{display:flex;align-items:center;justify-content:space-between;font-size:12px;gap:7px;background:#eaf5f1;border-radius:8px;padding:13px;margin-bottom:18px}.route span{color:#337b71}ol{padding-left:23px;margin:16px 0}li{padding-left:5px;margin-bottom:13px;break-inside:avoid}li::marker{font-weight:bold;color:#188277}aside{background:#edf6f3;border-left:3px solid #188277;padding:12px 14px;font-size:12px;margin-top:17px;break-inside:avoid}figure{margin:18px 0 0;break-inside:avoid}img{display:block;width:100%;height:auto;border:1px solid #e0e8ec;border-radius:5px}.review-figure{margin-top:10px}.review-figure img{max-height:160px;object-fit:contain;object-position:left}figcaption{font-size:10px;color:#71858d;margin-top:6px}footer{font-size:10px;color:#71858d;border-top:1px solid #e0e8ec;padding-top:10px;margin-top:20px}.service-note{padding:24px;margin-top:28px;background:#f6f8f9;border-radius:8px}.faq-list article{break-inside:avoid;border-bottom:1px solid #e2ebef;padding:10px 0}.faq-list p{font-size:12px;line-height:1.8}.faq-list h2{font-size:13px}nav{max-width:740px;margin:20px auto;color:#4e6a74;font-size:13px}nav a{color:#147b71}@media print{body{background:white}.guide-page{padding:0;margin:0;max-width:none}nav{display:none}}@media(max-width:600px){.guide-page{padding:24px}.route{flex-wrap:wrap}h1{font-size:23px}}
</style></head><body><nav>可直接阅读本说明，或 <a href="知衡-教师上手指南.pdf" download>下载 PDF 打印</a>。首次使用先看“第一次使用”，AI 辅助阅卷请看新增章节。</nav>${pages.join("")}</body></html>`;
writeFileSync(path.join(folder, "guide.html"), html);
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(path.join(folder, "guide.html")).href);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images, (img) => img.decode()));
  });
  if (
    !(await page
      .locator("img")
      .evaluateAll((images) => images.every((img) => img.naturalWidth > 0)))
  )
    throw Error("Guide illustration missing");
  await page.pdf({
    path: path.join(folder, "知衡-教师上手指南.pdf"),
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
  });
  copyFileSync(
    path.join(folder, "知衡-教师上手指南.pdf"),
    "release/知衡-教师上手指南.pdf",
  );
  console.log(
    `Teacher guide created from ${chapters.length} chapters and ${faqs.length} questions.`,
  );
} finally {
  await browser.close();
}
