import { useEffect, useState } from "react";
import {
  KeyRound,
  Database,
  Download,
  Upload,
  FolderOpen,
  Save,
  ShieldCheck,
  Copy,
} from "lucide-react";
import { api, base64, download, dateTime } from "./api";
import {
  Button,
  Field,
  Notice,
  ErrorBox,
  SectionTitle,
  Badge,
  Modal,
} from "./components";
import type { Boot, Settings } from "./types";
import { setupRequest } from "./help-content";
export function SettingsPage({
  boot,
  onRefresh,
  notify,
  initialAI = false,
}: {
  boot: Boot;
  onRefresh: () => Promise<void>;
  notify: (s: string) => void;
  initialAI?: boolean;
}) {
  const [aiOpen, setAIOpen] = useState(initialAI);
  const [c, setC] = useState<Settings>(boot.settings),
    [key, setKey] = useState(""),
    [clearKey, setClearKey] = useState(false),
    [sameModel, setSameModel] = useState(
      new Set([
        boot.settings.visionModel,
        boot.settings.gradingModel,
        boot.settings.reportModel,
      ]).size === 1,
    ),
    [savedConfig, setSavedConfig] = useState(false),
    [copied, setCopied] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [usage, setUsage] = useState<any>({ entries: [] }),
    [restore, setRestore] = useState<{ base64: string; preview: any } | null>(
      null,
    ),
    [confirmation, setConfirmation] = useState("");
  useEffect(() => {
    api("/usage")
      .then(setUsage)
      .catch((e) => setError(e.message));
  }, []);
  const set = (k: keyof Settings, v: any) => {
    setSavedConfig(false);
    setC((x) => ({ ...x, [k]: v }));
  };
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const next = await api<Settings>(
        "/settings",
        { ...c, apiKey: key, clearKey },
        "PUT",
      );
      setC(next);
      setKey("");
      setClearKey(false);
      await onRefresh();
      setSavedConfig(true);
      notify("智能辅助连接信息已保存");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function preview(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      if (file.size > 180 * 1024 * 1024)
        throw Error("此版本支持导入不超过 180 MB 的压缩备份。");
      const data = await base64(file);
      const p = await api("/backup/preview", { base64: data });
      setRestore({ base64: data, preview: p });
      setConfirmation("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function recover() {
    setBusy(true);
    setError("");
    try {
      await api("/backup/restore", {
        base64: restore!.base64,
        confirm: confirmation,
      });
      setRestore(null);
      await onRefresh();
      notify("备份已恢复，原数据另存为恢复前备份");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">资料管理 · 按需设置</span>
          <h1>设置与数据</h1>
          <p>
            首次连接识卷服务，以后选 PDF 即可自动整理题目。考试资料请定期备份。
          </p>
        </div>
        <Badge tone="teal">
          <ShieldCheck size={13} />
          本机存储
        </Badge>
      </div>
      <ErrorBox error={error} />
      <section className="panel settings-panel">
        <SectionTitle
          title="数据备份与恢复"
          subtitle="一份文件保存全部班级、试卷、成绩和报告。换电脑前请先导出完整备份。"
          action={<Database size={21} />}
        />
        <details>
          <summary>查看资料保存位置</summary>
          <Field label="本机数据目录">
            <input readOnly value={boot.dataDir} />
          </Field>
        </details>
        <div className="toolbar">
          <Button
            variant="secondary"
            onClick={() =>
              download(
                "/backup",
                `知衡备份-${new Date().toLocaleDateString("sv-SE")}.zhb`,
              ).catch((e) => setError(e.message))
            }
          >
            <Download size={16} />
            导出完整备份
          </Button>
          <label className="btn secondary file-button">
            <Upload size={16} />
            选择备份恢复
            <input
              type="file"
              accept=".zhb"
              disabled={busy}
              onChange={(e) => {
                void preview(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          {window.desktop && (
            <Button
              variant="ghost"
              onClick={() =>
                window
                  .desktop!.openDataFolder()
                  .catch((e) => setError(e.message))
              }
            >
              <FolderOpen size={16} />
              打开数据文件夹
            </Button>
          )}
        </div>
        <p className="muted">
          备份文件以 .zhb
          结尾，可复制到学校允许的存储位置。恢复会替换当前资料，确认前会先显示预览，并自动保留恢复前备份。只复制程序文件不会迁移考试资料。
        </p>
      </section>
      <details
        className="panel settings-panel optional-ai"
        open={aiOpen}
        onToggle={(e) => setAIOpen(e.currentTarget.open)}
      >
        <summary>
          <span>
            智能识卷与辅助功能
            <small>
              {c.hasKey && c.baseUrl
                ? "已填写连接信息 · 可展开修改"
                : "还未设置 · 人工录分和基础报告照常使用"}
            </small>
          </span>
          <Badge tone={c.hasKey && c.baseUrl ? "teal" : "neutral"}>
            {c.hasKey && c.baseUrl ? "已配置" : "可以跳过"}
          </Badge>
        </summary>
        <form onSubmit={save}>
          <SectionTitle
            title="连接智能服务"
            subtitle="请向学校信息老师或服务提供方索取下面三项信息，不需要自行理解技术参数。"
            action={<KeyRound size={21} />}
          />
          <div className="setup-assist">
            <p>
              <strong>没有这些信息？可以先跳过。</strong>
              <br />
              自动识卷需要先连接服务。可复制以下说明，请协助人员配置一次。保存设置本身不会发起付费调用；实际识别可能产生服务商费用。
            </p>
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(setupRequest);
                  setCopied(true);
                } catch {
                  setError("未能自动复制。请展开下方说明，选中文字后复制。");
                }
              }}
            >
              <Copy size={16} />
              {copied ? "说明已复制" : "复制协助配置说明"}
            </Button>
            <details>
              <summary>查看可交给协助人员的说明</summary>
              <p className="pre-wrap">{setupRequest}</p>
            </details>
          </div>
          <Field
            label="1. 服务地址"
            hint="复制服务提供方给出的地址。只填写网址，不是登录账号。"
          >
            <input
              type="url"
              value={c.baseUrl}
              placeholder="https://…/v1"
              onChange={(e) => set("baseUrl", e.target.value)}
            />
          </Field>
          <Field
            label="2. 访问密钥"
            hint={
              c.keyPersistence === "encrypted"
                ? "桌面版使用 Windows 账户加密保存密钥；备份不包含密钥。"
                : "浏览器开发模式的密钥仅在服务运行期间保留，重启后需重新输入。"
            }
          >
            <input
              type="password"
              autoComplete="new-password"
              value={key}
              placeholder={
                c.hasKey
                  ? "已配置；留空保留现有密钥"
                  : "粘贴服务提供方给出的访问密钥"
              }
              onChange={(e) => {
                setSavedConfig(false);
                setKey(e.target.value);
              }}
            />
          </Field>
          {c.hasKey && (
            <label className="check-label">
              <input
                type="checkbox"
                checked={clearKey}
                onChange={(e) => {
                  setSavedConfig(false);
                  setClearKey(e.target.checked);
                }}
              />
              保存时清除已有密钥
            </label>
          )}
          <label className="check-label">
            <input
              type="checkbox"
              checked={sameModel}
              onChange={(e) => {
                const useOne = e.target.checked;
                setSavedConfig(false);
                setSameModel(useOne);
                if (useOne) {
                  const name = c.reportModel || c.visionModel || c.gradingModel;
                  setC((v) => ({
                    ...v,
                    reportModel: name,
                    visionModel: name,
                    gradingModel: name,
                  }));
                }
              }}
            />
            各项智能辅助使用同一个模型（通常选这一项）
          </label>
          {sameModel ? (
            <Field
              label="3. 模型名称"
              hint="照服务提供方给出的名称填写。如果要识别题面或作答，这个模型需要支持图片。"
            >
              <input
                value={c.reportModel}
                placeholder="粘贴提供方给出的模型名称"
                onChange={(e) => {
                  const name = e.target.value;
                  setSavedConfig(false);
                  setC((v) => ({
                    ...v,
                    reportModel: name,
                    visionModel: name,
                    gradingModel: name,
                  }));
                }}
              />
            </Field>
          ) : (
            <div className="form-grid three">
              <Field label="题面识别 / 知识点模型">
                <input
                  value={c.visionModel}
                  onChange={(e) => set("visionModel", e.target.value)}
                  placeholder="服务商模型标识"
                />
              </Field>
              <Field label="辅助阅卷模型">
                <input
                  value={c.gradingModel}
                  onChange={(e) => set("gradingModel", e.target.value)}
                  placeholder="支持图片的模型标识"
                />
              </Field>
              <Field label="学情解读 / 备注归类模型">
                <input
                  value={c.reportModel}
                  onChange={(e) => set("reportModel", e.target.value)}
                  placeholder="文本模型标识"
                />
              </Field>
            </div>
          )}
          <Notice>
            只有主动运行对应 AI
            功能时才会发送数据。题面识别发送所选页面；试批发送所选作答图像和评分规则；学情解读发送匿名编号、题目、最终得分与已采用备注。手写姓名或备注中自行写入的姓名仍可能随内容发送。
          </Notice>
          <details className="advanced">
            <summary>更多设置：使用上限与费用估算（可保持默认）</summary>
            <p className="muted">
              以下供协助配置人员使用。兼容 Chat Completions
              接口；服务地址后会追加 /chat/completions。
            </p>
            <div className="form-grid">
              <Field
                label="每日请求次数上限"
                hint="按 UTC 日计数，包含失败请求和重试。"
              >
                <input
                  type="number"
                  min="1"
                  max="10000"
                  value={c.dailyCalls}
                  onChange={(e) => set("dailyCalls", Number(e.target.value))}
                />
              </Field>
              <Field
                label="单次回复长度上限（token）"
                hint="一般保留默认值。token 是服务商衡量文字用量的单位。"
              >
                <input
                  type="number"
                  min="256"
                  max="24000"
                  value={c.maxTokens}
                  onChange={(e) => set("maxTokens", Number(e.target.value))}
                />
              </Field>
            </div>
            <div className="form-grid three">
              <Field label="输入价格 / 百万 token">
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={c.inputPrice}
                  onChange={(e) => set("inputPrice", Number(e.target.value))}
                />
              </Field>
              <Field label="输出价格 / 百万 token">
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={c.outputPrice}
                  onChange={(e) => set("outputPrice", Number(e.target.value))}
                />
              </Field>
              <Field label="价格币种">
                <select
                  value={c.currency}
                  onChange={(e) => set("currency", e.target.value)}
                >
                  <option value="CNY">人民币 CNY</option>
                  <option value="USD">美元 USD</option>
                </select>
              </Field>
            </div>
            <small className="muted">
              估算仅按服务商返回的 token
              数计算；零价格表示未设置价格，不代表免费。图片、缓存和失败请求的账单以服务商为准。
            </small>
          </details>
          {savedConfig && (
            <div role="status">
              <Notice tone="success">
                连接信息已保存，尚未验证服务是否可用。请到“试卷准备”导入一份样卷，点击“开始整卷识别”检查结果。
              </Notice>
            </div>
          )}
          <ErrorBox error={error} />
          <div className="panel-bottom">
            <Button type="submit" busy={busy}>
              <Save size={16} />
              保存设置
            </Button>
          </div>
        </form>
      </details>

      <details className="panel settings-panel usage-details">
        <summary>智能辅助使用记录（按需查看）</summary>
        <SectionTitle
          title="智能服务的用量记录"
          subtitle={`当前计数日 ${usage.counter?.day || "暂无"} · 已尝试 ${usage.counter?.count || 0} 次请求（UTC）`}
        />
        {usage.entries.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>模型 / 功能</th>
                  <th>输入 / 输出 token</th>
                  <th>估算费用</th>
                </tr>
              </thead>
              <tbody>
                {usage.entries.slice(0, 30).map((u: any) => (
                  <tr key={u.id}>
                    <td>{dateTime(u.createdAt)}</td>
                    <td>
                      {u.model}
                      <small className="block muted">
                        {
                          (
                            {
                              extract: "题面识别", rubric: "整理评分标准", locate: "定位作答区域", assess: "逐点预批",
                              tag: "知识点建议",
                              grade: "辅助阅卷",
                              report: "学情解读",
                              classify: "备注归类",
                            } as any
                          )[u.kind]
                        }
                      </small>
                    </td>
                    <td>
                      {u.reported
                        ? `${u.input} / ${u.output}`
                        : "服务商未返回用量"}
                    </td>
                    <td>
                      {u.estimatedCost == null ? (u.reported ? "未配置单价，按服务商账单核对" : "用量未知，请核对服务商账单") : `${u.estimatedCost.toFixed(4)} ${u.currency}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">尚无模型返回的用量记录。</p>
        )}
      </details>
      {restore && (
        <Modal
          title="恢复备份预览"
          onClose={() => {
            if (!busy) setRestore(null);
          }}
        >
          <Notice tone="warn">
            备份含 {restore.preview.classes} 个班级、{restore.preview.exams}{" "}
            场考试、{restore.preview.attachments}{" "}
            个附件。恢复将替换当前数据，原数据会先自动备份。
          </Notice>
          <Field label="输入“恢复备份”以确认">
            <input
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </Field>
          <ErrorBox error={error} />
          <div className="modal-actions">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setRestore(null)}
            >
              取消
            </Button>
            <Button
              variant="danger"
              busy={busy}
              disabled={confirmation !== "恢复备份"}
              onClick={recover}
            >
              恢复并替换
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
