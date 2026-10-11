# 测试与源码发布

当前版本使用 Node.js 24；完整回归另外需要 Python 3.9 以上，仅使用标准库。应用运行无需 Python。测试资料与正式资料隔离，不调用付费模型。

## 本机回归

```text
npm ci --ignore-scripts
npm test
npm run build
```

`PYTHON` 环境变量可指定发布安全测试使用的解释器。测试覆盖计分与统计、导入导出、草稿和恢复、评分标准与作答证据关联、教师分数保护、断点续批、缺页保护信号及源码发布校验。

需要浏览器工作流回归时，先完成构建并安装 Chrome，再执行：

```text
node scripts/release-ui.mjs
```

该脚本使用独立资料目录，检查草稿确认、报告恢复、未保存导出保护、数据失效和计分结构预览撤销，不配置模型密钥。帮助页面与 PDF 来自 `src/help-content.ts`，可在安装 Chrome 后用 `node scripts/build-teacher-guide.mjs` 重新生成；更新公开图片或指南后须人工核对是否包含身份、密钥和个人目录。

## CI

[GitHub Actions](https://github.com/Shhaaawwww/zhiheng-grading/actions/workflows/ci.yml) 在 Windows 与 Ubuntu 执行依赖安装、隔离回归、构建、依赖审核及源码包检查。工作流仅有仓库读取权限，不配置模型密钥。该检查验证软件工程行为；模型评分准确率需另外进行教师核对与盲评。

## 源码发布

```text
python scripts/package-source.py
python scripts/check-release-secrets.py --source-only
npm audit --omit=dev --audit-level=moderate
npm audit --audit-level=high
```

发布策略在 `scripts/release_safety.py`：源码目录和资源受限制，公开脚本使用明确白名单，意外文件会拒绝打包。写 ZIP 前扫描凭据，写包后核对 ZIP 完整性及逐文件 SHA-256；失败保留先前发布包。`SOURCE_MANIFEST.json` 记录实际源码清单；发布下载包另附 `SHA256SUMS.txt`。

公开源码只包含当前应用、测试、构建与发布工具、许可证和维护文档。`archive/`、`output/`、`release/`、`.data/`、本机配置、真实卷子、成绩表、备份及接口日志均不属于源码快照。常规 Git 版本历史保留，提交前应核对完整历史和新增资源，不仅扫描当前文件。

历史实测与交付工具在维护者本机归档，不随当前源码分发。既有验证的摘要和边界保留在 [审核记录](docs/audit-open-source.md)，不能把旧模型结果当作当前模型准确率。

## Windows 桌面构建

安装依赖时须允许 Electron 二进制下载，再执行：

```text
npm ci
npm run dist
node scripts/check-package.mjs
```

`desktop-smoke.ps1` 支持便携版、解包版或已安装版，使用独立资料目录隐藏启动。需要验证指定报告时，通过 `-Report` 显式传入获授权的测试报告；默认仅检查启动。

`installer-smoke.ps1` 仅适用于没有既有安装和快捷方式的专用测试账号，卸载只接受它记录的工作区测试目录。桌面二进制需要另外完成启动、安装、备份恢复和 PDF/Excel 导出验收；源码 CI 不能代替这些步骤。当前源码发布不附已签名的 Windows 安装包。

## 模型效果评测

模型或提示词变更后，使用公开或获授权的匿名样卷，保留原始模型建议、教师修订、缺页与误读记录。按独立学生统计总分偏差、误判和复核耗时；模拟接口、同卷扰动和重复评分点不能扩充为独立样本。当前版本没有宣称全学科、全布局自动评分准确率。
