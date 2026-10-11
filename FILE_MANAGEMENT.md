<!-- workspace-file-governance:v1 -->
# File Management

This file is the project-specific prompt and current file-governance record.
Git keeps its history. Keep this document short and update it only for important structural decisions.

## Working rules

- Search for an existing file with the same responsibility before creating another one.
- Prefer changing the current implementation over creating `v2`, `new`, `final`, `copy`, or backup files.
- Put experiments, generated output, and historical artifacts only in their declared areas.
- When a key responsibility moves, update the key file and record the replacement.
- Ordinary edits and ordinary helper/test files do not need lifecycle records.

<!-- ws:areas:start -->
## Managed areas

| Path | Purpose | Rule |
|---|---|---|
| `dist/` | Generated | Do not edit manually |
| `src/` | Production source | Current implementation only |
| `tests/` | Tests | Keep beside the responsibility under test |
| `docs/` | Maintained documentation | Current project documentation |
| `experiments/` | Experimental | Alternatives are not production |
| `archive/` | Archive | Reference only |
<!-- ws:areas:end -->

<!-- ws:keys:start -->
## Key files

| Role | Current file |
|---|---|
| Application entry | `src/main.tsx` |
| Package manifest | `package.json` |
| Project overview | `README.md` |
<!-- ws:keys:end -->

<!-- ws:transitions:start -->
## Active transitions

| Role | From | Candidate | Status |
|---|---|---|---|
|  |  |  |  |
<!-- ws:transitions:end -->

<!-- ws:replaced:start -->
## Replaced files

| Old file | Current replacement | Reason |
|---|---|---|
|  |  |  |
<!-- ws:replaced:end -->

## Project-specific notes

- Add only durable file-management guidance here.
- `docs/audit-open-source.md` 保存当前独立 API 能力、开源审核和验证边界；历史交付验收报告保留原口径，不覆盖为新结果。
- `.github/workflows/ci.yml` 为源码持续集成入口；`scripts/package-source.py` 与 `scripts/check-release-secrets.py` 为源码发布及凭据检查入口。发布物保存在已使用的 `release/`，核验产物保存在 `output/`，不加入公开源码。
- GitHub 发布从白名单源码同步到 `output/github-publication/repository/` 的独立 Git 仓库；推送前核对实际提交和版本历史，不把含正式资料的原工作区或历史输出目录直接推送。隐私检查与发布记录保存在 `output/github-publication/`，不随源码公开。

- `archive/historical-delivery/` 保存旧交付进度、设计方案、验收报告及历史实测工具，只作本机参考，不进入公开源码或当前维护流程。
- `scripts/release_safety.py` 明确列出当前公开脚本；运行、离线回归、桌面检查、指南生成和源码发布工具保留在 `scripts/`，新增公开工具需更新白名单并审核。
