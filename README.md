# Acceptance Pack

`paneforge-acceptance-pack` 是 PaneForge Companion 的**文件优先、只读交付证据投影器**。
它接收 workflow index、verification summary 或 Hooks 原生 acceptance evidence /
verification，以及可选 audit 引用，逐个检查路径、SHA-256、身份、隐私字段和检查
结果，输出可审查的 `paneforge.acceptance.pack.v1`。

它解决的是“把多个已存在的证据放进一个可交接包”，不是“重新判断系统是否完成”。
Hooks 仍是 scope、permission、hard gate、audit 和 completion truth 的权威；
本项目不会制造第二套 acceptance authority。

## 权威边界

| 内容 | 权威组件 | 本仓库责任 |
|---|---|---|
| 权限、范围、硬门禁、completionAllowed | Hooks Governance Layer | 原样保留规范化结果，不覆盖 |
| task/run/evidence/handoff | Method Layer | 只校验引用身份 |
| Workflow index | `paneforge-workflow-adapter` | 校验 digest 并消费 |
| PaneForge Session/Worker 状态 | 官方 PaneForge + Companion Coordinator | 不连接、不控制 |
| acceptance pack | 本仓库 | 只做可追溯组合输出 |

明确不执行命令、不启动进程、不控制 Session/Worker、不决定权限、不存储 transcript、
不写入 Skills/AGENTS/hooks/config/memory/远端仓库，也不读取用户项目未声明文件。

## 输入合同

请求 schema 为 `paneforge.acceptance.request.v1`：

```json
{
  "schema": "paneforge.acceptance.request.v1",
  "taskId": "task-example",
  "runId": "run-example",
  "workspaceId": "workspace-example",
  "sources": [
    { "kind": "workflow-index", "path": "fixtures/workflow-index.json",
      "sha256": "sha256:<64 hex>", "required": true },
    { "kind": "verification-summary", "path": "fixtures/verification.json",
      "sha256": "sha256:<64 hex>", "required": true },
    { "kind": "audit", "path": "fixtures/hook-audit.jsonl",
      "sha256": "sha256:<64 hex>", "required": false }
  ]
}
```

source kind 必须唯一（audit 可多次出现），且必须同时存在 workflow-index 与
verification-summary、acceptance-evidence 或 acceptance-verification 之一。

## 输出合同与判定语义

输出 schema 为 `paneforge.acceptance.pack.v1`，核心字段包括：

- `status`: `ready`、`partial`、`blocked`；
- `workflowStatus`: 来自 workflow index，不由 pack 重写；
- `checks`: 规范化的 `pass`、`fail`、`blocked`、`not-run`；
- `completionAllowed`、`truthLayers`、`artifactResults`：仅在原生 Hooks 来源存在时保留；
- `blockingReasons`：每一项都能追溯到源文件、身份、隐私或检查失败；
- `missingOptional`：缺失的非必需来源；
- `advisoryOnly: true`：明确本项目不是 completion authority。

组合规则：

1. 必需源缺失、digest 漂移、JSON/schema/身份错误、隐私键出现时进程失败；
2. 任意必需 check 为 `fail`、`blocked` 或 `not-run` 时，pack 为 `blocked`；
3. workflow 为 `blocked` 或 `unknown` 时，pack 为 `blocked`；
4. workflow ready 且没有缺失可选源时为 `ready`；
5. 其它可解释的不完整情况为 `partial`；
6. `explain` 只生成人类可读摘要，不添加新的事实。

隐私扫描拒绝 `token`、`secret`、`password`、`credential`、API key 和 raw transcript
等字段；上游若确需表明某字段已存储，应使用既定的 `Stored` 后缀合同，而不是写入值。

## 目录结构

```text
src/index.ts       请求校验、来源解析、隐私/身份检查、pack 组合与原子写入
src/cli.ts         validate-request / compose / validate / explain CLI
schemas/           request 与 pack JSON Schema
tests/             Node test runner 合同测试
fixtures/          合成请求、证据和 audit
docs/              方法计划、设计与交付说明
scripts/            lint 与 schema 检查
```

## 安装与验收

```powershell
pnpm install
pnpm run typecheck
pnpm run build
pnpm test
pnpm run lint
pnpm run schema:check
pnpm run smoke:production
```

常用操作：

```powershell
node dist/src/cli.js validate-request fixtures/request.json --root .
node dist/src/cli.js compose fixtures/request.json --root . --output out/acceptance-pack.json
node dist/src/cli.js validate out/acceptance-pack.json --root .
node dist/src/cli.js explain out/acceptance-pack.json --root .
```

所有 source path 必须位于 `--root` 内；输出使用临时文件加 rename 的原子写入，
写入后再次执行结构校验。`dist/`、`out/`、`node_modules/` 是本地生成物，不纳入
源码交付。

## 版本、兼容性与贡献

当前包版本为 `0.1.0`。合同变更优先新增 schema 后缀版本；保留旧 schema 的解析
和测试，避免把审计历史解释成新状态。新增 source kind 必须同步 TypeScript 类型、
JSON Schema、隐私规则、身份规则、CLI smoke 和 README。

贡献提交至少包含：权威边界说明、失败/partial/blocked 语义、隐私影响、schema
变更、测试命令和与 workflow-adapter 的兼容说明。不得通过“补字段”绕过 Hooks 的
completion gate，也不得把 pack 的 `ready` 当作产品发布许可。

## License

Original project materials are licensed under the MIT License; see [`LICENSE`](./LICENSE).
Third-party dependencies remain under their respective licenses. The npm package
is marked `private` and is not currently published to the npm registry.

## Usage

```powershell
pnpm install
pnpm run build
pnpm test
pnpm run lint
pnpm run schema:check
pnpm run smoke:production
```

The production smoke covers both the local verification-summary path and the
native hooks acceptance/verification paths, then checks the published JSON
Schema against both generated outputs.

Compose a pack from a request manifest:

```powershell
node dist/src/cli.js compose fixtures/request.json `
  --root . `
  --output out/acceptance-pack.json
```

Validate a request manifest without reading any referenced source files:

```powershell
node dist/src/cli.js validate-request fixtures/request.json --root .
```

Validate a pack:

```powershell
node dist/src/cli.js validate out/acceptance-pack.json --root .
```

Generate a stable human-readable handoff:

```powershell
node dist/src/cli.js explain out/native-acceptance-pack.json --root .
```

Required sources are the workflow index plus one of verification summary,
native acceptance evidence, or native acceptance verification. Audit
references may be required or optional. Missing optional sources produce a
`partial` pack; failed checks, failed truth layers, or blocked workflow state
produce `blocked`. When native hooks evidence is present, the pack also
preserves normalized `completionAllowed`, `truthLayers`, and `artifactResults`
fields for review without storing raw evidence.
