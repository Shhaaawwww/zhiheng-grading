# 可复现的验收

## 0.3.1 源码审核

使用 Node.js 24 和 Python 3.9 以上（本轮 Python 3.12）。`npm test` 使用隔离资料目录和本机模拟模型，不调用付费接口。新增回归检查英文表头的身份、零分与空白保护、未知题型的有效字段保留，以及发布脚本对未批准文件、合成凭据和失败覆盖的保护。

`python scripts/package-source.py` 在写包前核对文件路径、类型及凭据，写包后逐项校验 ZIP 内容与哈希清单；`python scripts/check-release-secrets.py --source-only` 单独核查当前源码，不依赖历史安装包或示例包。只允许源码、维护文档和明确批准的静态资源；资料库、成绩表、备份及接口日志不属于源码。

GitHub Actions 检查 Windows/Ubuntu 的依赖安装、隔离测试、构建及源码包。工作流无模型密钥，仅有仓库读取权限；它不能证明真实模型准确率或 Windows 安装器可用。完整模型盲评应保留原始建议与教师修订，按独立学生计算样本量，不能用本机 mock 代替。

2026-10-09 的审核记录见 [docs/audit-open-source.md](docs/audit-open-source.md)。

## 0.3 真实手写验证

先执行 `node scripts/fetch-handwritten-papers.mjs` 和 `python scripts/prepare-handwritten-fixtures.py`，从 College Board 官方材料中分离原卷、评分标准和真实考生作答，渲染为无文字层的 PDF。官方考生得分与点评单独留作核验，不进入批卷请求。

通过进程环境提供 `DEEPSEEK_API_KEY` 后，运行 `node scripts/assessment-live.mjs prepare`。独立核对评分标准后再运行 `node scripts/assessment-live.mjs grade`。测试保留原始识别和标准提案；教师对标准的修正单独记录，不能伪称模型原始结果。脚本在真实浏览器操作班级、考试、上传和预批，不替换模型响应。

同题 A/B/C 为官方独立样例；不同题的 A 不代表同一学生。构造的“班级”只用于检验统计流程。退化、旋转、缺页属于对同一真实样本的扰动，不能当作新增独立考生计算样本量。付费结果、失败日志、用量和发送图片保留于 `output/real-api/release-030`，不进入源码包。

本地回归覆盖评分点与技能分离、未知不记零分、来源绑定、旧诊断失效、教师分数保护和分批断点恢复。名称含 fault injection 的测试只检验程序故障处理，不能计入真实模型有效性。

后续真实流程：`assessment-live.mjs review` 在界面中按留出的官方评分修正，并选择性确认具体技能证据；`reports` 生成全班与个人报告。`variants` 检查退化、横转、缺页；`scan-repair` 复测整页保护；`recover` 针对本轮真实失败的最后一批验证继续处理。用 `ZHIHENG_CASE` 限定案例，`ZHIHENG_ROUND` 标记日志。`fast` 为开发者对照实验，本轮表现不佳，教师端没有入口，不用于默认验收。

准备无答案场景时，在独立的 `ZHIHENG_TEST_OUT` 下复制或重新生成 `fixtures.json`，设置 `ZHIHENG_WITHOUT_REFERENCE=1` 再执行 `prepare`。该流程只检验无参考解答的生成；不能把建议步骤分当成官方分值。

`review` 的知识点复核策略、`grade` 读取的本地 `teacher-rubric-corrections.json` 与本轮模型提案对应。新一次模型若输出不同结构，应先人工核对、调整测试策略；不要强行套用数组索引。原始提案和教师修正必须分开保存。

本轮先将稳定备份复制为 `before-scan-variants.zhb`；扰动测试设置 `ZHIHENG_VARIANT_RECOVERY=backup`，省去每轮重复付费批原卷，最后由 `assessment-backup-check.mjs after-variants` 在教师界面恢复原始数据。脚本只操作专用测试目录，恢复前另存完整备份。用 `upgrade-check-030.mjs` 检查本机历史 0.2 备份，用 `verify-assessment-release.mjs` 独立验算官方分数、教师改分、Excel、报告引用及所有实测用量。

## 不收费的回归

运行 `npm ci`、`npm test`、`npm run build`。测试名称中的 fault injection 为本地故障注入，不是真实模型评测。浏览器脚本需要已安装 Chrome。

运行 `node scripts/release-ui.mjs` 验证编辑、恢复、批量草稿确认及结构迁移。生成使用指南的脚本 `node scripts/build-teacher-guide.mjs` 需要 Node.js 24 及以上。建议统一使用本轮验证过的 Node.js 24 系列。

## 真实接口全流程

先安装Python测试依赖：`python -m pip install -r requirements-test.txt`。

依次执行：

```text
node scripts/fetch-public-papers.mjs
python scripts/prepare-public-papers.py
python scripts/prepare-release-papers.py
```

通过进程环境设置 `DEEPSEEK_API_KEY` 和 `ZHIHENG_TEST_OUT=output/real-api/release-020-round2`，不要将密钥写入文件。以下命令会调用官方服务并计费：

```text
node scripts/release-live.mjs extract
node scripts/release-live.mjs workflow
node scripts/release-live.mjs final-reports
```

历史实测配置为 `deepseek-v4-flash-vision-exp`；该旧别名对应模型已改变，重测前应核对服务商当前文档并明确记录本次实际模型。每次进程最多40次外部请求；服务设置中另有每日100次限制。不要启动两个测试进程访问同一资料目录。输出保存原始响应、发送图片的哈希、模拟录分来源、教师修正、截图和导出文件，凭据不写入输出。

学生数据为确定性的模拟录分，不能当成真实班级的教学效果证据。全国甲卷场景模拟全班统一选择第22题，第23题取消计分。

流程脚本会检查识别题号；若模型产生额外行、漏题或新错误，测试应当失败并保留现场。请先审阅来源和真实响应，修复或通过教师编辑处理，再重新运行。不要为了测试变绿而修改原始模型响应或删除失败日志。

安装包与便携包需单独验证启动、旧版资料恢复、导出PDF、文件校验和内容白名单。真实教师试用、签名、课堂效果与维护流程是推广前的独立验收，不能由自动化替代。

打包后运行 `node scripts/check-package.mjs`。Windows 脚本 `scripts/desktop-smoke.ps1` 支持便携版、解包版或已安装版本，以独立资料目录隐藏启动。`scripts/installer-smoke.ps1` 仅允许在没有既有知衡安装及快捷方式时测试安装；卸载仅接受它自己记录的工作区测试目录，默认保留应用资料。请在专用 Windows 测试账号中运行；受限运行环境可能阻止图形子进程，不能据此直接判定产品启动失败。

`node scripts/verify-release.mjs` 独立核对本轮小分、Excel、报告和复测；`python scripts/verify-release-pdfs.py` 检查并渲染 PDF。历史 0.1.3 备份不随源码分发，缺少该备份时升级检查会明确跳过；不能把跳过视为通过。完整本机验收已单独验证过这份旧备份。

运行 `python scripts/package-source.py` 生成白名单源码包；源码不包含网络下载的试卷、学生资料或接口日志。公开发布前请再次检查许可证、敏感信息与校验和。
