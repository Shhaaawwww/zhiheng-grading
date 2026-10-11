export async function api<T = any>(
  url: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const res = await fetch("/api" + url, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: {
      "Content-Type": "application/json",
      "X-Zhiheng-Client": "desktop",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let data;
    try {
      data = await res.json();
    } catch {
      data = { error: "本地服务暂时不可用，请重试。" };
    }
    throw new Error(data.error || "操作失败。");
  }
  return res.json();
}
export const uid = () => crypto.randomUUID();
export const keyOf = (s: string, q: string) => `${s}:${q}`;
export const fmt = (v: number | null | undefined, d = 1) =>
  v == null ? "—" : Number.isInteger(v) ? String(v) : v.toFixed(d);
export const pct = (v: number | null | undefined) =>
  v == null ? "暂无数据" : `${fmt(v)}%`;
export const dateTime = (s: string) =>
  new Date(s).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
export async function base64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("文件读取失败。"));
    reader.readAsDataURL(file);
  });
}
export async function download(url: string, name: string) {
  const res = await fetch("/api" + url);
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.error || "导出失败。");
  }
  const blob = await res.blob(),
    href = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 30000);
}
export const leafQuestions = (e: {
  questions: import("./types").Question[];
}) => {
  const parents = new Set(e.questions.map((q) => q.parentId).filter(Boolean));
  return e.questions.filter((q) => q.type !== "group" && !parents.has(q.id));
};
