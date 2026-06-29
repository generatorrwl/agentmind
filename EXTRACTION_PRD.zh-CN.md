# AgentMind 业务知识抽取与能力生成 PRD

## 1. 概述

本 PRD 专门定义 AgentMind 的核心主线：如何让 local agent 基于一个项目的源码、文档、历史对话、外部 reference、episodes 和 reward 信号，持续生成有用的中间知识文件和可复用能力。

目标不是让 AgentMind 自己变成 LLM，也不是写一个泛泛的“总结一下”prompt，而是提供一套可复用、可审计、跨 harness 的抽取系统：

```text
raw sources / scan / history / references / episodes
-> extraction packet
-> agentmind-extraction skill
-> schema / wiki / memory / skill / tool rule / proposal
-> future agents reuse
```

这一模块是 AgentMind 的核心价值之一。`setup`、`scan`、`history import`、`reference add` 只是前置操作层；真正的产品闭环必须让 agent 读懂业务上下文，并把理解沉淀为项目固定知识和固定能力。

## 2. 问题定义

当前 MVP 已经能创建 `.agent-context/`、记录 work/session、登记 scan sources、导入 history/reference，并生成 pending proposals。但它还没有真正完成：

- 系统性阅读 workspace 文件并生成项目 wiki。
- 从历史对话中抽取决策、gotchas、用户偏好、工作流和 skill 候选。
- 生成项目专用 schema 和 maintenance skill。
- 把重复成功流程沉淀为 canonical skill。
- 用 citations/evidence 证明抽取结果来自哪些 source。
- 验证下一轮 agent 是否能复用这些知识和能力。

因此，目前只能证明 AgentMind 的 plumbing 能跑通，不能证明它已经完成主要功能。

## 3. 产品原则

### 3.1 重要设定必须慢下来

项目 schema、项目目标、maintenance skill、skill promotion policy 和高影响 memory 这类设定，会长期影响 agent 的行为。它们不能由 agent 在一次输出里草率决定。

原则：**设定越准确，后续污染、返工和错误泛化越少。**

在创建或修改重要设定前，agent 必须：

1. 问用户是否已有 schema、目标、分类体系、团队约定或参考项目。
2. 阅读 workspace 的 README、docs、源码结构、历史对话、已有 wiki/skills/tools 和 open work。
3. 对项目业务/domain 做必要外部调研，参考类似项目的 wiki、docs、skills、runbooks 和 taxonomy。
4. 提出 2-3 个候选方案，说明适用场景、优点、代价、风险和迁移影响。
5. 与用户多轮讨论，记录用户决策和未决问题。
6. 只有在用户确认或配置允许后，才写入稳定 schema、objective、maintenance skill 或高影响 memory。

### 3.2 不依赖单一 harness 的内部机制

Codex 的 goal/plan、Claude Code 的 hooks/skills、Cursor rules 都可以作为 adapter 表面，但不能成为 AgentMind 的产品依赖。

AgentMind 需要自己的 durable artifacts：

- **Objective / Work Item**：为什么做，做到什么算完成。
- **Plan / Packet**：这一次抽取任务怎么做，做到哪一步。
- **Skill**：每次抽取都要遵守的可复用 SOP。
- **Decision Log**：用户确认过什么，哪些问题还没定。

这些都应以本地文件保存，并能被不同 local agent harness 读取。

### 3.3 抽取不是总结

Extraction 不是把 source 压缩成摘要。它要识别并沉淀：

- 稳定项目事实。
- 业务/domain 概念。
- 架构和模块边界。
- 决策和理由。
- 可重复工作流。
- 失败模式和 gotchas。
- 工具、命令、MCP 使用规则。
- 用户偏好和协作方式。
- 可复用 skill 候选。

抽取结果必须有 citations、confidence 和变更日志。

### 3.4 通用协议和项目判断必须分层

AgentMind 不能用一套完全通用的 extraction skill 去处理所有项目。研究型 repo、产品型 repo、代码库、课程作业、实验项目、客户项目需要沉淀的知识类型不同，source 权威性不同，Wiki schema 和 Skill 触发条件也不同。

因此，AgentMind 的抽取能力必须分成两层：

```text
AgentMind Core Skills：跨项目通用，负责协议、安全边界、review/apply 生命周期
Project-specific Skills：项目专用，负责内容判断、schema 规则、source priority、领域抽取标准
```

Core Skill 回答“怎么维护资产”：读哪些 packet、如何生成 proposal、如何 dedupe、什么不能直接 apply、accept/apply 的语义是什么。Project Skill 回答“这个项目里什么值得维护”：哪些事实是核心知识、Wiki 如何分类、哪些 workflow 应该沉淀成 Skill、哪些信息必须丢弃。

Worker 或 extraction packet 同时引用两类 Skill 时，使用顺序和优先级必须明确：

```text
用户当前明确要求
> AgentMind Core Safety / Review Protocol
> Project Profile
> Project Schema
> Project-specific Extraction / Workflow Skills
> Domain Template
> Agent 临场判断
```

具体规则：

- 每次 Worker / Extraction run 都先读 Core Skill，确定权限、输出格式、proposal-first 和 review/apply 规则。
- 如果存在 Project Profile，再读 Profile 中声明的 schema、source priority、Not Now、project skills。
- 内容分类、Wiki 页面选择、领域术语和沉淀标准由 Project-specific Skills 决定。
- 如果 Project Skill 和 Core Skill 冲突，例如 Project Skill 要求直接改 Wiki，但 Core Skill 要求高影响资产走 proposal，则以 Core Skill 为准。
- 如果 Core Skill 只给出通用规则，例如“抽取 durable knowledge”，则由 Project Skill 定义本项目里的 durable knowledge。

### 3.5 项目专属 Skills 是高影响资产

Project-specific extraction/workflow skills 会长期影响未来 agent 如何理解项目，因此它们和 Wiki schema 一样，不能由 agent 一次性凭空生成。

它们必须通过 Project Design 流程产生：

```text
AgentMind top-level project design skill
-> 与用户讨论项目目标、类型、知识结构和工作方式
-> 阅读 workspace、已有 wiki/skills、scan、history、references
-> 必要时调研类似项目的 schema / docs / runbook / skills
-> 生成候选 schema、profile、project skills
-> 用户确认
-> proposal/apply 到稳定资产
```

Memory 只能记录“用户偏好先讨论再改重要设定”这类长期偏好；它不应承担生成 Schema 或 Project Skills 的职责。真正的生成机制应是 Skill + Packet + Proposal。

### 3.6 显式授权，但不要求用户记 CLI

AgentMind 初始化和 Project Design 都会影响项目长期行为，因此必须由用户显式授权。AgentMind 不应在用户不知情时接管项目、写入入口指令、生成 schema 或启用 project skills。

但用户不应该被要求记住内部 CLI 或产品步骤。初始化之后，Agent 应在入口流程、`doctor`、`status` 或 Worker/Extraction packet 中主动发现缺失项，并把它翻译成自然语言建议。

推荐交互：

```text
用户：开始 / 初始化 AgentMind / 帮我建立这个项目的知识系统
Agent：当前项目还没有 Project Profile、Wiki Schema、Project Extraction Skill、Project Workflow Skill。
       这些会影响后续 Wiki 和 Skill 质量。建议先做 Project Design。
       是否开始？
用户：开始
Agent：运行 agentmind project design ...，并进入 discussion-first 流程。
```

不推荐：

```text
初始化后自动生成最终 schema 和 project skills。
要求用户自己记住并输入 agentmind project design。
把完整 CLI 手册写进 Memory。
```

因此，触发模型应是：

```text
用户显式授权 AgentMind 或某个维护目标
-> Agent 通过入口指令/doctor/status/packet 发现缺失资产
-> Agent 用自然语言建议 Project Design
-> 用户确认
-> Agent 调用 CLI 生成 packet
-> Skill-driven discussion-first 流程
```

Memory 只记录高层偏好，例如“重要设定必须用户确认”；具体 CLI 串联应存在于 `AGENT_MANUAL.md`、skills、packets 和 profile 中。

## 4. 核心对象

### 4.1 Raw Sources

Raw sources 是抽取输入，从 AgentMind 角度应只读或 append-only。

来源包括：

- Repository files：源码、README、docs、配置、测试、脚本。
- History：Codex/Claude/session JSONL、Markdown transcript、terminal logs。
- References：URL、论文、gist、外部 repo、issue、PR、设计文档。
- Episodes：AgentMind 记录的工作单元。
- Rewards：用户反馈、验证结果、自我反思、失败重试。

### 4.2 Extraction Packet

Extraction packet 是一次抽取任务的 durable workspace。它记录输入、目标、计划、用户决策、调研记录和输出要求。

推荐结构：

```text
.agent-context/extractions/<extract-id>/
  PACKET.md              # 给 agent 读的任务入口
  PLAN.md                # 本次抽取计划和进度
  sources.json           # 输入 source 列表、类型、路径、reason
  output-contract.md     # 必须产出的文件和验收标准
  schema-candidates.md   # schema discovery 候选方案
  research-notes.md      # workspace 调研 + 外部调研记录
  user-decisions.md      # 用户确认、偏好、未决问题
  extraction-log.md      # 本次抽取操作日志
```

Packet 的职责不是替代 skill，而是保存“这一次”的状态。Skill 定义方法，packet 记录实例。

### 4.2.1 Project Design Packet

Project Design Packet 是 Extraction Packet 的一个特殊类型，用来设计或修改高影响项目设定，包括 Project Profile、Wiki Schema、Project Extraction Skill 和 Project Workflow Skill。

它不是普通抽取任务，也不是执行一次总结；它是一次 discussion-first 的设计工作区。

推荐结构：

```text
.agent-context/project-design/<design-id>/
  PACKET.md                  # 本次 project design 入口
  PLAN.md                    # 阶段、检查点、当前状态
  workspace-sources.json      # 已阅读/待阅读的 repo/docs/history/source 列表
  research-notes.md           # workspace 调研和外部调研记录
  user-decisions.md           # 用户确认、偏好、反对点、未决问题
  profile-candidates.md       # 2-3 个 project profile 候选
  schema-candidates.md        # 2-3 个 wiki schema 候选
  skill-candidates.md         # project extraction/workflow skill 候选
  migration-preview.md        # 对现有 wiki/skills/proposals 的影响
  output-contract.md          # 最终应产生哪些 proposals / stable assets
  design-log.md               # 操作日志和决策历史
```

Project Design Packet 的状态机：

```text
draft -> asking_user -> reading_workspace -> researching -> proposing_options -> waiting_user -> ready_for_proposal -> complete
```

状态语义：

- `draft`：CLI 创建 packet，还没有足够信息。
- `asking_user`：需要先询问用户是否已有 schema、目标、参考项目或偏好。
- `reading_workspace`：Agent 正在阅读 README、docs、源码结构、现有 AgentMind artifacts。
- `researching`：必要时调研类似项目的 wiki/docs/skills/runbook/taxonomy。
- `proposing_options`：生成候选 profile/schema/skills 和 tradeoff。
- `waiting_user`：等待用户选择、修改或确认。
- `ready_for_proposal`：用户已确认方向，可以生成 pending proposals。
- `complete`：proposals 已生成，或用户明确决定暂不做。

Project Design Packet 必须记录“不确定性”和“用户没确认的内容”。Agent 不能把未确认候选写成稳定 schema 或 skill。

### 4.3 Project Schema

Project schema 定义 wiki 如何组织。它包括：

- Page types。
- Directory layout。
- Frontmatter fields。
- Source classes。
- Naming rules。
- Index/log 规则。
- Citation/confidence 规则。
- Ingest/query/lint/promote 规则。

默认 schema 可以很小：

```text
wiki/
  index.md
  log.md
  overview.md
  architecture.md
  workflows.md
  gotchas.md
  decisions.md
  tools.md
```

但业务项目应逐渐长出自己的 schema。例如课程/研究项目可能需要 `papers/ lectures/ concepts/ entities/ topics/`；SaaS 项目可能需要 `domains/ workflows/ APIs/ incidents/ customers/ decisions/`；数据产品可能需要 `datasets/ metrics/ pipelines/ models/ experiments/`。

稳定 schema 文件：

```text
.agent-context/wiki/schema.md
```

`schema.md` 至少应定义：

- Wiki 目录结构和页面类型。
- 每类页面的 frontmatter 字段。
- 文件命名规则和 index 维护规则。
- source classes 和 citation 规则。
- confidence/status 字段语义。
- 哪些内容不进入 Wiki。
- schema migration 规则。

### 4.4 Compiled Wiki

Compiled wiki 是 source-linked fixed knowledge layer。它不是 raw source 的摘要合集，而是 agent 维护的知识 codebase。

每个 wiki 页面应尽量包含：

```yaml
---
title: <title>
type: overview | architecture | workflow | gotcha | decision | tool | concept | entity | topic | custom
sources: []
confidence: draft | inferred | verified | stale | contradicted
created: YYYY-MM-DD
updated: YYYY-MM-DD
status: draft | active | deprecated
---
```

### 4.5 Capabilities / Skills

能力生成指把重复、稳定、可验证的 agent 工作方法沉淀为 canonical skills。

Skill 不是随便一段经验。至少应包含：

- `name` 和 `description`，明确触发条件。
- 适用范围和不适用范围。
- 输入和输出。
- 操作步骤。
- 需要的工具/命令/MCP。
- 验证 checklist。
- 失败处理。
- evidence/citations。

Canonical source：

```text
.agent-context/skills/<skill-id>/SKILL.md
```

Adapter views 再由 AgentMind 渲染给 Codex、Claude Code 等 harness。

### 4.6 Project Profile

Project Profile 是项目级资产索引，不是生成器。它记录已经确认的项目画像、Schema 和 Project Skills，让 Worker / Extraction packet 能知道应该加载哪些项目专属规则。

稳定文件：

```text
.agent-context/profile.md
```

建议内容：

```yaml
---
project_type: research | product | library | app | course | infra | agent-tooling | custom
stage: discovery | mvp | active-development | maintenance | archive
schema: .agent-context/wiki/schema.md
extraction_skill: .agent-context/skills/project-extraction/SKILL.md
workflow_skill: .agent-context/skills/project-workflow/SKILL.md
source_priority:
  - README.md
  - docs/
  - src/
not_now: []
confirmed_by: user
updated: YYYY-MM-DD
---
```

Profile 应回答：

- 这是哪类项目，当前阶段是什么。
- 当前用户确认过的目标和非目标是什么。
- Wiki schema 在哪里。
- 本项目 extraction/workflow skills 在哪里。
- source priority 和可信度规则是什么。
- 哪些维护任务暂时不做。

Profile 不应该包含大段抽取规则；这些规则应放在 schema 或 project skills 中。

### 4.7 Project-specific Skills

第一版至少定义两个项目专属 Skill：

```text
.agent-context/skills/project-extraction/SKILL.md
.agent-context/skills/project-workflow/SKILL.md
```

`project-extraction` 负责：

- 判断本项目哪些信息值得进入 Wiki、Memory 或 Skill。
- 根据 schema 选择页面类型和目录位置。
- 定义 source priority、citation/confidence 规则。
- 定义领域概念、实验/指标/客户/模块等项目专属分类。
- 定义丢弃规则，防止一次性细节污染长期资产。

`project-workflow` 负责：

- 项目日常开发/研究/写作/实验/发布流程。
- 常用命令、验证步骤、环境约束。
- work item、checkpoint、handoff 的项目级约定。
- 特定任务何时要先读哪些 Wiki/Skill/Source。

项目专属 Skill 必须包含：触发条件、适用/不适用范围、输入、输出、步骤、验证、失败处理、evidence。它们不能替代 AgentMind Core Skill 的安全边界。

## 5. `agentmind-extraction` Skill

AgentMind 应内置一个 canonical skill：

```text
.agent-context/skills/agentmind-extraction/SKILL.md
```

它是知识抽取和能力生成的主 SOP，应包含以下操作。

它不是项目专属 Skill。它是顶层方法 Skill，负责指导 Agent 如何创建 Project Design Packet、如何与用户讨论、如何读取 sources、如何生成候选方案、如何把用户确认后的结果转成 proposals。项目确认后的内容判断，应交给 `project-extraction` 和 `project-workflow`。

### 5.0 PROJECT DESIGN

触发：首次进入已有项目、用户要求建立项目 Wiki、用户要求设计 schema、scan 完成但没有 schema、用户要求生成项目专属 skills、Worker packet 发现只有通用 skill 而没有项目规则。

目标：通过讨论和调研，生成经过用户确认的 Project Profile、Wiki Schema、Project Extraction Skill 和 Project Workflow Skill。

流程：

1. 创建 Project Design Packet，而不是直接写稳定文件。
2. 询问用户是否已有：项目目标、schema、分类体系、团队约定、参考项目、已有 wiki/skill、Not Now。
3. 阅读 workspace source：README、docs、package/config、源码结构、tests/scripts、现有 `.agent-context/wiki/`、`.agent-context/skills/`、pending proposals、history/source records。
4. 必要时做外部调研，参考类似项目的 wiki/schema/docs/runbook/skills，但不能复制隐私内容或不可用 license 内容。
5. 生成 2-3 套候选方案，每套必须包含：profile 摘要、schema 草案、project-extraction skill 草案、project-workflow skill 草案、适用场景、代价、迁移影响、风险。
6. 与用户讨论候选方案，把用户选择、修改意见、反对点和未决问题写入 `user-decisions.md`。
7. 用户确认后，生成 pending proposals，而不是直接写稳定资产，除非用户明确要求 apply。
8. apply 后稳定资产应包括 `.agent-context/profile.md`、`.agent-context/wiki/schema.md`、`.agent-context/skills/project-extraction/SKILL.md`、`.agent-context/skills/project-workflow/SKILL.md`。

候选方案不应只给名字。每个候选至少应包含：

- Wiki 目录和页面类型。
- 每类页面 frontmatter。
- source priority 和 citation 规则。
- 这个项目里“durable knowledge”的定义。
- 这个项目里“不进入长期资产”的内容。
- project-extraction skill 的触发条件和输出 contract。
- project-workflow skill 的触发条件和验证方式。

DISCUSSION-FIRST 约束：

- 如果用户没有确认，不能写 `.agent-context/wiki/schema.md`。
- 如果用户没有确认，不能启用 `project-extraction` 或 `project-workflow` 为稳定 skill。
- 可以写候选文件和 pending proposals，但必须标记为候选。
- 如果用户只确认一部分，例如只确认 schema，不确认 workflow skill，则只能 apply 已确认部分。

### 5.1 DISCOVER SCHEMA

触发：首次进入已有项目、用户要求建立项目 wiki、scan 完成但没有 schema、用户说“先设计 schema”。

状态：保留为 PROJECT DESIGN 的子流程。单独调用时只产生 schema candidates，不直接决定 project skills。

流程：

1. 询问用户是否已有 schema、目标、参考项目或分类偏好。
2. 阅读 scan sources、README/docs、源码结构、history、现有 wiki/skills/tools。
3. 必要时做外部调研，找同类项目的 wiki/docs/skills/runbook/taxonomy。
4. 写 `schema-candidates.md`，给出 2-3 个候选 schema。
5. 与用户讨论并记录到 `user-decisions.md`。
6. 用户确认后，生成或更新 `.agent-context/wiki/schema.md`。
7. 同步生成 project-extraction skill 的候选 patch；是否 apply 取决于用户确认。

### 5.2 EXTRACT SCAN

触发：`agentmind scan finish` 后、用户要求从现有 repo 建 wiki。

输入：scan selected sources。

输出：

- wiki overview。
- architecture/module boundaries。
- workflows/runbooks。
- gotchas/failure modes。
- decisions/open questions。
- tools/commands/MCP notes。
- skill candidates。

流程必须先读 schema。如果没有 schema，应先走 `DISCOVER SCHEMA`。

如果没有 Project Profile 或 project-extraction skill，应先走 `PROJECT DESIGN`，或者在 packet 中明确本次只能做临时/低置信度 proposal，不能把通用规则当成项目最终规则。

### 5.3 EXTRACT HISTORY

触发：导入过去对话、Codex/Claude rollout JSONL、session log，或用户要求“从过去对话生成知识和能力”。

抽取项：

- 用户偏好。
- 项目目标和阶段目标。
- 已做决策及理由。
- 工作流和 runbooks。
- 失败、纠正、gotchas。
- 工具/环境规则。
- reward signals。
- skill candidates。

历史对话不能直接等同事实。需要区分：

- 用户明确表达。
- agent 推断。
- 命令/测试结果。
- 后续被纠正的结论。
- 仍需验证的假设。

### 5.4 EXTRACT REFERENCE

触发：用户给外部 URL、paper、gist、repo、文档，或 reference source 被登记。

要求：

- Reference fetch 作为可插拔 capability，不在 AgentMind 核心内重写 crawler。
- 对抓取正文记录 provenance、tool、timestamp、permission、risk。
- 抽取结果不能直接进入 fixed knowledge，必须保留 source citation 和 confidence。

### 5.5 PROMOTE CAPABILITY

触发：重复工作流、成功 episode、history 中的稳定流程、用户明确要求沉淀 skill。

流程：

1. 找出触发条件和适用边界。
2. 写 workflow steps。
3. 写验证 checklist。
4. 写 failure handling。
5. 记录 evidence。
6. 生成 canonical `SKILL.md` 候选。
7. 根据配置决定直接写、candidate 状态或 proposal。

### 5.6 LINT / AUDIT

触发：用户说“体检 wiki”、大规模 extraction 后、schema 变更后。

检查：

- 缺 citations。
- 过期/冲突 claims。
- orphan pages。
- schema drift。
- index/log 不一致。
- skill 缺验证步骤。
- gotcha 没有关联 workflow。

输出 lint report，并可为低风险修复生成 patches/proposals。

## 6. CLI / Product Commands

CLI 不负责智能理解，但负责生成 packet 和约束输出。

建议命令：

```bash
agentmind project design [--from-scan <scan-id>] [--from-source <source-id>] [--mode <new|revise>]
agentmind project design status <design-id>
agentmind project design propose <design-id>
agentmind extract schema [--from-scan <scan-id>] [--from-source <source-id>]
agentmind extract scan <scan-id>
agentmind extract history <source-id-or-thread-id>
agentmind extract reference <source-id>
agentmind extract proposal <proposal-id>
agentmind extract list
agentmind extract status <extract-id>
```

`agentmind project design` 是高影响入口。它只创建 Project Design Packet，不自动生成最终 schema/skills。

命令输出应告诉 agent：

```text
Read .agent-context/project-design/<id>/PACKET.md
Use .agent-context/skills/agentmind-extraction/SKILL.md PROJECT DESIGN flow
Ask the user the required discovery questions before finalizing candidates
Do not write stable profile/schema/project skills until user confirmation
```

### 6.0 Discovery And Suggestion Flow

`agentmind setup`、`agentmind doctor`、`agentmind status` 和 workspace entry flow 应能暴露 Project Design 的缺失状态，但不应自动执行 Project Design。

需要检测的缺失项：

```text
.agent-context/profile.md
.agent-context/wiki/schema.md
.agent-context/skills/project-extraction/SKILL.md
.agent-context/skills/project-workflow/SKILL.md
```

当缺失这些资产时，CLI 或 Agent entry flow 应给出建议：

```text
Project Design is not complete.
Recommended next step: ask the user whether to run `agentmind project design`.
Do not generate final schema or project skills without user confirmation.
```

Agent 面向用户时不应只输出 CLI，而应解释为什么建议做 Project Design：没有项目级 schema 和 project skills 时，Worker/Extraction 只能按通用规则生成低置信度 proposal，质量会不稳定。

命令输出应告诉 agent 下一步：

```text
Read .agent-context/extractions/<id>/PACKET.md
Use .agent-context/skills/agentmind-extraction/SKILL.md
Produce the required outputs listed in output-contract.md
```

### 6.1 Packet 对 Skill 的引用规则

Worker / Extraction / Project Design packet 中引用多个 Skill 时，必须显式标注职责：

```yaml
skills:
  core_protocol:
    - .agent-context/skills/agentmind-worker/SKILL.md
    - .agent-context/skills/agentmind-extraction/SKILL.md
  project_rules:
    profile: .agent-context/profile.md
    schema: .agent-context/wiki/schema.md
    extraction: .agent-context/skills/project-extraction/SKILL.md
    workflow: .agent-context/skills/project-workflow/SKILL.md
  templates:
    - research-repo
    - product-repo
```

Packet 必须写清楚：

- Core protocol skills 总是先读。
- Project rules 存在时必须读，用于内容判断。
- Templates 只能用于候选生成，不能作为稳定项目规则。
- 缺少 profile/schema/project skill 时，应进入 Project Design 或生成低置信度 proposal。

### 6.2 Proposal / Apply 规则

Project Design 的输出默认是 proposals：

```text
profile proposal -> .agent-context/profile.md
schema proposal -> .agent-context/wiki/schema.md
project-extraction skill proposal -> .agent-context/skills/project-extraction/SKILL.md
project-workflow skill proposal -> .agent-context/skills/project-workflow/SKILL.md
```

`accept` 只表示用户认可方向；`apply` 才表示稳定资产实际写入。Project Design 相关 proposal 必须记录用户确认 evidence，例如 `user-decisions.md` 路径或明确对话摘要。

## 7. 输出策略

是否直接写 wiki/skill，还是先进入 proposal，应由配置决定。配置模块单独设计，本 PRD 只定义抽取模块需要读取配置。

需要配置的策略包括：

```text
approval_mode: request_approval | auto_approve_low_risk | auto_apply
wiki_write_policy: proposal_only | create_new_pages_directly | direct_write
skill_write_policy: proposal_only | candidate_direct | promoted_direct
memory_write_policy: proposal_only | explicit_user_only
external_research_policy: ask_each_time | allowed | disabled
citation_required: true
```

默认建议：

- 新 wiki 页面可以 candidate/direct create，但必须有 citations。
- 修改 public memory、高影响 schema、已有 skill 默认走 proposal。
- Skill promotion 默认 candidate/proposal，不自动变 active。
- 用户明确选择“替我审批模式”后，可放宽低风险写入。

## 8. MVP 范围

第一版应实现最小可实验闭环：

1. 生成 `agentmind-extraction` canonical skill，包含 PROJECT DESIGN / DISCOVER SCHEMA / EXTRACT SCAN / EXTRACT HISTORY / PROMOTE CAPABILITY / LINT。
2. 支持 `agentmind project design` 生成 Project Design Packet。
3. Project Design Packet 必须包含 `PACKET.md`、`PLAN.md`、`workspace-sources.json`、`research-notes.md`、`user-decisions.md`、`profile-candidates.md`、`schema-candidates.md`、`skill-candidates.md`、`migration-preview.md`、`output-contract.md`。
4. 支持 `agentmind project design propose <design-id>`，在用户确认后生成 profile/schema/project skill 的 pending proposals。
5. 支持 `agentmind extract history <source-id-or-thread-id>` 生成 packet。
6. 支持 `agentmind extract scan <scan-id>` 生成 packet。
7. Extraction packet 必须包含 source list、output contract、schema/profile/project skill 引用、缺失规则时的 Project Design 提示和 required outputs。
8. Worker packet 必须在存在 Project Profile 时引用 profile/schema/project skills；不存在时不能假装有项目规则。
9. Agent 按 skill 读取 packet 后，能产出至少：
   - 一个 wiki workflow 或 overview 更新。
   - 一个 gotcha。
   - 一个 skill candidate。
   - 一条 wiki log。
   - citations 指向 source/history/scan。
10. Project Design 相关 proposal 的 accept/apply 语义必须和 review/apply 流程一致。

不在第一版做：

- 自动 LLM 执行 extraction。
- 自动联网抓所有 URL 正文。
- 自动从所有 Codex/Claude 数据库批量抽取历史。
- 自动判断所有 proposal 是否该 apply。
- 完整 team governance。
- 自动选择最终 schema 或 project skills。
- 用 Memory 直接生成 schema/project skills。
- 多项目模板 marketplace。

## 8.1 MVP 开发顺序

推荐开发顺序：

1. 数据路径和类型：增加 `.agent-context/project-design/`、ProjectDesignPacket、ProjectProfile、DesignStatus。
2. 内置 Skill：生成 `agentmind-extraction` canonical skill，并渲染到 Codex/Claude adapter。
3. CLI packet：实现 `agentmind project design`，只生成 packet 和候选文件骨架。
4. Discussion guard：packet 中明确必须先问用户，不允许无确认写稳定资产。
5. Proposal generation：实现 `agentmind project design propose <id>`，读取候选和用户确认，生成 pending proposals。
6. Apply path：复用 review/apply，把 proposals 写入 profile/schema/project skills。
7. Worker integration：`agentmind worker run --once` 读取 profile/schema/project skills 并写入 packet 的 skill reference section。
8. Extraction commands：实现 `extract scan/history`，并在缺 schema/profile/project skills 时引导 Project Design。
9. Entry/doctor/status integration：在入口流程和状态检查中检测 profile/schema/project skills 缺失，并建议用户是否启动 Project Design。

每一步都必须有 fixture 或 smoke test，避免只完成文件生成而没有验证 agent 能按 packet 执行。

## 9. 验收实验

### 9.1 Project Design 验收实验

用当前 AgentMind repo 作为第一个实验对象。

输入：

```text
README.md
PRODUCT_PRD.zh-CN.md
EXTRACTION_PRD.zh-CN.md
AGENTMIND_WORKER_PRD.zh-CN.md
src/
.agent-context/wiki/
.agent-context/skills/
.agent-context/proposals/pending/
```

期望流程：

```bash
agentmind project design --from-scan scan_45c376ff21 --root /Users/renwanlan/Documents/memory-helper
```

Agent 读取 Project Design Packet 和 `agentmind-extraction` skill 后，必须先问用户：

- 这个 repo 当前更接近 product repo、agent tooling repo、library，还是混合？
- Wiki 主要服务开发实现、产品决策、研究调研，还是用户使用文档？
- 是否已有参考项目或希望模仿的 schema？
- 哪些内容暂时不进入长期资产？
- project-extraction 和 project-workflow 是否要分开？

用户给出方向后，Agent 应产生：

- `profile-candidates.md`：至少 2 套 profile 候选。
- `schema-candidates.md`：至少 2 套 wiki schema 候选。
- `skill-candidates.md`：`project-extraction` 和 `project-workflow` 草案。
- `migration-preview.md`：说明现有 `overview/workflows/gotchas/fixed-knowledge` 如何迁移。
- `user-decisions.md`：记录用户确认和未决问题。

验收标准：

- 候选方案不是泛泛模板，必须引用当前 repo 的 PRD、CLI、AgentMind artifacts。
- 没有用户确认前，不产生稳定 `.agent-context/profile.md`、`.agent-context/wiki/schema.md` 或 project skills。
- 用户确认后，`project design propose` 能产生 4 类 pending proposals：profile、schema、project-extraction skill、project-workflow skill。
- apply 后，Worker packet 会引用这些项目规则，而不是只引用通用 worker skill。

### 9.2 Extraction 验收实验

用已有 AgentMind bootstrap session 做端到端实验。

输入：

```text
/Users/renwanlan/.codex/sessions/2026/06/25/rollout-2026-06-25T20-12-50-019efeb2-7abf-7912-b559-340c097e9948.jsonl
```

期望流程：

```bash
agentmind history import <rollout-jsonl> --reason "Backfill AgentMind bootstrap setup session"
agentmind extract history <source-id>
```

Agent 读取 packet 和 extraction skill 后，应至少生成：

- `.agent-context/wiki/workflows.md` 中的 “AgentMind existing repo bootstrap workflow”。
- `.agent-context/wiki/gotchas.md` 中的 “npm link may fail on /usr/local permissions”。
- `.agent-context/skills/agentmind-bootstrap-existing-repo/SKILL.md` candidate，包含 setup/doctor/online/scan/checkpoint/finish/end 的完整步骤。
- `.agent-context/wiki/log.md` 一条 extraction 记录。
- citations 指向 rollout JSONL、`AGENTMIND_BOOTSTRAP.md`、相关 command evidence。

验收标准：下一轮 agent 进入项目时，能通过 wiki 或 skill 复用这次沉淀，而不是重新从 rollout JSONL 推导。

## 10. 参考实践

本模块参考以下实践，但不直接复制其实现：

- `/Users/renwanlan/具身智能/.agents/skills/wiki-note/SKILL.md`：本地最接近目标的实践。关键启发是 `INGEST / QUERY / LINT`、frontmatter、index/log、跨页更新和红线。
- `sdyckjq-lab/llm-wiki-skill`：多平台 LLM wiki skill，强调 raw/wiki/index/log、置信度、缓存、对话结晶化和可选提取器。
- `Astro-Han/karpathy-llm-wiki`：Agent Skills-compatible 的 Karpathy LLM Wiki 实现，核心是 Ingest/Query/Lint。
- `lewislulu/llm-wiki-skill`：提供 scaffold、lint、audit review 思路，适合参考 audit/feedback loop。
- Karpathy LLM Wiki gist：fixed knowledge / compiled wiki 的核心思想来源。

## 11. 开放问题

- Schema discovery 是否应有单独命令，还是作为 `extract scan/history` 的前置阶段自动触发？
- Candidate wiki 页面是否应该有独立目录，例如 `.agent-context/wiki-candidates/`？
- Skill candidate 是否应默认写入 `.agent-context/skills/<id>/SKILL.md`，还是先写 `.agent-context/capabilities/candidates/`？
- Extraction packet 是否需要状态机：`draft -> researching -> waiting_user -> extracting -> reviewing -> complete`？
- 如何衡量 extraction 的质量：用户接受、后续复用、减少重复解释、减少错误？
- 如何对历史对话做敏感信息检测和脱敏？
- 如何把用户反馈作为 reward 反向改进 extraction skill 本身？
