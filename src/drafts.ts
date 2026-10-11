import { useEffect, useRef, useState } from "react";
import { api } from "./api";

export function useDraft<T>(key: string, initial: T) {
  const localKey = `zh-draft:${key}`;
  const [value, setValue] = useState<T>(() => {
    try { return JSON.parse(localStorage.getItem(localKey) || "null")?.data ?? initial; } catch { return initial; }
  });
  const [status, setStatus] = useState("正在恢复草稿…");
  const changed = useRef(false), latest = useRef(value);
  const savedVersion = useRef(0), generation = useRef(0);
  useEffect(() => {
    let live = true;
    void api<any>(`/drafts/${encodeURIComponent(key)}`).then(row => {
      if (!live || changed.current) return;
      let local: any; try { local = JSON.parse(localStorage.getItem(localKey) || "null"); } catch { /* server copy is still usable */ }
      const best = row?.value?.changedAt > (local?.changedAt || "") ? row.value : local;
      if (best) { setValue(best.data); latest.current = best.data; }
      setStatus(best ? "已恢复上次草稿" : "编辑后自动保存草稿");
    }).catch(() => { if (live) setStatus("离线：编辑将暂存在本机，恢复连接后请保存"); });
    return () => { live = false; };
  }, [key]);
  useEffect(() => {
    if (!changed.current) return;
    const v = generation.current;
    const timer = setTimeout(() => {
      if (!changed.current) return;
      void api(`/drafts/${encodeURIComponent(key)}`, { value: { data: latest.current, changedAt: new Date().toISOString() } }, "PUT").then(() => {
        if (generation.current === v) { savedVersion.current = v; setStatus("草稿已保存，可稍后继续"); }
      }).catch(() => setStatus("草稿尚未写入资料库，请保持本页并重试；本机暂存仍保留"));
    }, 400);
    return () => clearTimeout(timer);
  }, [value, key]);
  function update(next: T | ((old: T) => T)) {
    const data = typeof next === "function" ? (next as (old: T) => T)(latest.current) : next;
    latest.current = data; changed.current = true; generation.current++;
    try { localStorage.setItem(localKey, JSON.stringify({ data, changedAt: new Date().toISOString() })); setStatus("草稿已暂存在本机，正在保存…"); }
    catch { setStatus("本机暂存失败，请勿关闭，等待资料库保存完成"); }
    setValue(data);
  }
  async function clear() {
    changed.current = false;
    try { localStorage.removeItem(localKey); } catch { /* The committed record is already durable. */ }
    try { await api(`/drafts/${encodeURIComponent(key)}`, undefined, "DELETE"); }
    catch { setStatus("内容已提交，旧草稿清理失败；再次编辑时请核对恢复内容"); }
  }
  return [value, update, status, clear] as const;
}
