import { useEffect, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  FileText,
  LoaderCircle,
} from "lucide-react";
import { Button, ErrorBox } from "./components";
import type { Attachment, Question, AnswerRegion } from "./types";
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const docs = new Map<string, Promise<pdfjs.PDFDocumentProxy>>();
async function pdf(url: string) {
  let p = docs.get(url);
  if (!p) {
    p = pdfjs.getDocument({ url }).promise;
    docs.set(url, p);
    p.catch(() => docs.delete(url));
  }
  return p;
}
export async function documentPageCount(file: Attachment) {
  return file.mime === 'application/pdf' ? (await pdf('/api/files/' + file.id)).numPages : 1;
}
// Render the source region directly; do not enlarge a previously downscaled page.
export async function regionImage(file: Attachment, region: AnswerRegion, targetWidth = 1800) {
  const r = region.box, canvas = document.createElement('canvas');
  if (file.mime === 'application/pdf') {
    const doc = await pdf('/api/files/' + file.id);
    if (region.page < 1 || region.page > doc.numPages) throw Error('作答区域页码超出原卷范围。');
    const p = await doc.getPage(region.page), initial = p.getViewport({scale:1,rotation:region.rotation || 0});
    const scale = Math.min(targetWidth/(initial.width*r.w), Math.sqrt(5_000_000/(initial.width*r.w*initial.height*r.h)), 6);
    const viewport = p.getViewport({scale,rotation:region.rotation || 0});
    canvas.width = Math.max(1,Math.ceil(viewport.width*r.w));canvas.height = Math.max(1,Math.ceil(viewport.height*r.h));
    await p.render({canvas,viewport,transform:[1,0,0,1,-r.x*viewport.width,-r.y*viewport.height]}).promise;
  } else {
    if (region.page !== 1) throw Error('图片附件只有一页。');
    const img=new Image();img.src='/api/files/'+file.id;await img.decode();
    const source=document.createElement('canvas'), rotated=(region.rotation||0)%180!==0;
    source.width=rotated?img.naturalHeight:img.naturalWidth;source.height=rotated?img.naturalWidth:img.naturalHeight;
    const ctx=source.getContext('2d')!;ctx.translate(source.width/2,source.height/2);ctx.rotate((region.rotation||0)*Math.PI/180);ctx.drawImage(img,-img.naturalWidth/2,-img.naturalHeight/2);
    const width=source.width*r.w,height=source.height*r.h,scale=Math.min(1,targetWidth/width,Math.sqrt(5_000_000/(width*height)));
    canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
    canvas.getContext('2d')!.drawImage(source,r.x*source.width,r.y*source.height,width,height,0,0,canvas.width,canvas.height);
  }
  return canvas.toDataURL('image/jpeg',.92);
}
export async function pageImage(
  file: Attachment,
  page = 1,
  region: Question["region"] = null,
) {
  const canvas = document.createElement("canvas");
  let count = 1;
  if (file.mime === "application/pdf") {
    const doc = await pdf("/api/files/" + file.id);
    count = doc.numPages;
    if (page < 1 || page > count)
      throw new Error(`文件共 ${count} 页，无法读取第 ${page} 页。`);
    const p = await doc.getPage(page),
      original = p.getViewport({ scale: 1 }),
      scale = Math.min(
        1800 / original.width,
        8000 / original.height,
        Math.sqrt(12_000_000 / (original.width * original.height)),
      ),
      v = p.getViewport({ scale });
    canvas.width = Math.ceil(v.width);
    canvas.height = Math.ceil(v.height);
    await p.render({ canvas, viewport: v }).promise;
  } else {
    const img = new Image();
    img.src = "/api/files/" + file.id;
    await img.decode();
    const ratio = Math.min(1, 1800 / img.naturalWidth);
    canvas.width = img.naturalWidth * ratio;
    canvas.height = img.naturalHeight * ratio;
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  }
  let result = canvas;
  if (region) {
    const r = region,
      crop = document.createElement("canvas");
    crop.width = Math.max(1, Math.round(r.w * canvas.width));
    crop.height = Math.max(1, Math.round(r.h * canvas.height));
    crop
      .getContext("2d")!
      .drawImage(
        canvas,
        r.x * canvas.width,
        r.y * canvas.height,
        r.w * canvas.width,
        r.h * canvas.height,
        0,
        0,
        crop.width,
        crop.height,
      );
    result = crop;
  }
  return { image: result.toDataURL("image/jpeg", 0.88), count };
}
export async function documentImages(
  file: Attachment,
  range: string,
  region: Question["region"] = null,
  options: {
    onProgress?: (done: number, total: number) => void;
    signal?: AbortSignal;
  } = {},
) {
  const count =
    file.mime === "application/pdf"
      ? (await pdf("/api/files/" + file.id)).numPages
      : 1;
  const indices = new Set<number>();
  if (range === "all" && count > 40)
    throw new Error(
      `这份文件有 ${count} 页，超过本版整卷识别的 40 页上限。未发送任何页面，请使用仅包含本次试题的 PDF。`,
    );
  for (const part of (range === "all" ? `1-${count}` : range).split(/[,，]/)) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) throw new Error("页码格式例如 1-3 或 1,3。");
    const start = Number(m[1]),
      end = Number(m[2] || m[1]);
    if (start < 1 || end > count || end < start)
      throw new Error(`页码超出范围，此文件共 ${count} 页。`);
    for (let i = start; i <= end; i++) indices.add(i);
  }
  if (range !== "all" && indices.size > 20)
    throw new Error("一次最多处理 20 页，请分批选择。");
  const images = [];
  options.onProgress?.(0, indices.size);
  for (const i of indices) {
    options.signal?.throwIfAborted();
    images.push((await pageImage(file, i, region)).image);
    options.onProgress?.(images.length, indices.size);
  }
  options.signal?.throwIfAborted();
  return { images, pages: [...indices] };
}
export function PdfViewer({
  file,
  initialPage = 1,
  region = null,
}: {
  file?: Attachment;
  initialPage?: number;
  region?: Question["region"];
}) {
  const [page, setPage] = useState(initialPage),
    [count, setCount] = useState(1),
    [image, setImage] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [zoom, setZoom] = useState(100);
  useEffect(() => setPage(initialPage), [file?.id, initialPage]);
  useEffect(() => {
    if (!file) return;
    let alive = true;
    setLoading(true);
    setError("");
    pageImage(file, page)
      .then((v) => {
        if (alive) {
          setImage(v.image);
          setCount(v.count);
        }
      })
      .catch((e) => {
        if (alive) {
          setError(e.message);
          setImage("");
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [file?.id, page]);
  if (!file)
    return (
      <div className="pdf-empty">
        <FileText size={42} strokeWidth={1} />
        <strong>原卷会显示在这里</strong>
        <p>可以关联 PDF 看卷，也可以直接录入已有成绩。</p>
      </div>
    );
  return (
    <div className="pdf-viewer">
      <div className="pdf-toolbar">
        <span title={file.name}>{file.name}</span>
        <div>
          <button
            className="icon-btn"
            aria-label="上一页"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft size={17} />
          </button>
          <small>
            {page} / {count}
          </small>
          <button
            className="icon-btn"
            aria-label="下一页"
            disabled={page >= count}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight size={17} />
          </button>
          <button
            className="icon-btn"
            aria-label="缩小原卷"
            onClick={() => setZoom((x) => Math.max(50, x - 25))}
          >
            <ZoomOut size={17} />
          </button>
          <button
            className="icon-btn"
            aria-label="放大原卷"
            onClick={() => setZoom((x) => Math.min(250, x + 25))}
          >
            <ZoomIn size={17} />
          </button>
        </div>
      </div>
      <ErrorBox error={error} />
      <div className="pdf-pages" aria-busy={loading}>
        {loading ? (
          <div className="loading">
            <LoaderCircle className="spin" />
            正在读取原卷…
          </div>
        ) : (
          image && (
            <div className="pdf-image" style={{ width: `${zoom}%` }}>
              <img src={image} alt={`${file.name} 第 ${page} 页`} />
              {region && (
                <div
                  className="region-overlay"
                  style={{
                    left: `${region.x * 100}%`,
                    top: `${region.y * 100}%`,
                    width: `${region.w * 100}%`,
                    height: `${region.h * 100}%`,
                  }}
                >
                  <span>设定的作答区域</span>
                </div>
              )}
            </div>
          )
        )}
      </div>
      {error && page !== 1 && (
        <Button variant="secondary" onClick={() => setPage(1)}>
          返回第一页
        </Button>
      )}
    </div>
  );
}
