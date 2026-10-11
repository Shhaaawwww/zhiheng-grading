import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { id, now, fail } from "./domain.mjs";

export class Store {
  constructor(dir) {
    mkdirSync(dir, { recursive: true });
    this.dir = dir;
    this.db = new DatabaseSync(path.join(dir, "zhiheng.sqlite"));
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(kind,id)); CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,json TEXT NOT NULL,bytes BLOB NOT NULL); CREATE TABLE IF NOT EXISTS settings(id TEXT PRIMARY KEY,json TEXT NOT NULL);",
    );
  }
  list(kind) {
    return this.db
      .prepare("SELECT json FROM records WHERE kind=? ORDER BY rowid DESC")
      .all(kind)
      .map((r) => JSON.parse(r.json));
  }
  get(kind, key, required = true) {
    const row = this.db
      .prepare("SELECT json FROM records WHERE kind=? AND id=?")
      .get(kind, key);
    if (!row && required) fail("记录不存在。", 404);
    return row ? JSON.parse(row.json) : null;
  }
  put(kind, value) {
    this.db
      .prepare(
        "INSERT INTO records(kind,id,json) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET json=excluded.json",
      )
      .run(kind, value.id, JSON.stringify(value));
    return value;
  }
  remove(kind, key) {
    this.db.prepare("DELETE FROM records WHERE kind=? AND id=?").run(kind, key);
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  audit(examId, action, before, after) {
    return this.put("audit", {
      id: id(),
      examId,
      action,
      before,
      after,
      createdAt: now(),
    });
  }
  attachment(meta, buffer) {
    this.db
      .prepare("INSERT INTO attachments(id,json,bytes) VALUES(?,?,?)")
      .run(meta.id, JSON.stringify(meta), buffer);
    return meta;
  }
  file(key) {
    const row = this.db
      .prepare("SELECT json,bytes FROM attachments WHERE id=?")
      .get(key);
    if (!row) fail("附件不存在。", 404);
    return { ...JSON.parse(row.json), bytes: Buffer.from(row.bytes) };
  }
  setting(key) {
    const row = this.db
      .prepare("SELECT json FROM settings WHERE id=?")
      .get(key);
    return row ? JSON.parse(row.json) : null;
  }
  saveSetting(key, value) {
    this.db
      .prepare(
        "INSERT INTO settings(id,json) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json",
      )
      .run(key, JSON.stringify(value));
  }
  dump() {
    return {
      format: "zhiheng-backup",
      version: 1,
      createdAt: now(),
      records: this.db.prepare("SELECT kind,id,json FROM records").all(),
      attachments: this.db
        .prepare("SELECT id,json,bytes FROM attachments")
        .all()
        .map((r) => ({ ...r, bytes: Buffer.from(r.bytes).toString("base64") })),
    };
  }
  close() {
    this.db.close();
  }
}
