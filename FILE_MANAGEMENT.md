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
- GitHub 发布从白名单源码生成 `output/github-publication/repository/` 的独立 Git 仓库；只推送经审核的源码与初始提交，不把含正式资料的原工作区或历史输出目录直接推送。发布前的隐私检查记录保存在 `output/github-publication/`，不随源码公开。
