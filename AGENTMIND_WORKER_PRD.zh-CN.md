# AgentMind Worker PRD

## 1. 概述

AgentMind Worker 是 AgentMind 的长期资产维护任务层。它不负责完成用户当前任务，也不替代 Codex、Claude Code、Cursor 等主 Agent；它负责读取 AgentMind 能稳定获得的输入资源，抽取和改进长期资产。

Worker 在产品概念上是“维护任务抽象”，不必在第一版就实现为自研后台 Agent。它可以有两种执行后端：

```text
Skill-driven backend：Session end 或用户手动触发后，由当前 Coding Agent 按 AgentMind skills 执行维护任务
Autonomous backend：由 AgentMind 自己实现的维护型 Agent/worker 进程执行维护任务
```

第一版优先采用 skill-driven backend，因为 session 结束后的维护工作已经不占用主任务资源，并且可以复用当前 Coding Agent 的读写、推理和工具能力。自研 Agent 作为 advanced backend，在需要后台常驻、批处理、多模型调度或更严格隔离时再实现。

Worker 的核心职责分为两类：

```text
Extract：从输入资源中提取 Wiki 和 Skill 候选
Improve：根据对话、反馈、episodes 和已有资产，迭代 Wiki 和 Skill
```

Worker 的默认输出不是直接修改稳定资产，而是生成可审核的 proposal。稳定 Wiki、Skill、Memory 和 adapter views 只有在 review/accept 后才更新。

## 2. 背景

AgentMind 目前已经具备 workspace bootstrap、online session、work item、checkpoint、handoff、episode、proposal、scan、source、skill render 等基础能力。但这些机制主要用于记录和组织工作状态，还没有形成持续运行的维护型智能体。

用户当前的产品判断是：主 Agent 应该聚焦当前任务，不应该在任务进行中被维护 Memory、Wiki、Skill、Capability 的杂事分散注意力。长期资产维护应该由 AgentMind Worker 承担，但 Worker 的执行可以先复用 session end 后的 Coding Agent + AgentMind skills，不必一开始自研完整后台 Agent。

调研 AutoSkill 和 SkillOpt 后，可以得到几个关键参考点：

- AutoSkill 更强调从 conversation、trajectory、document 中做 skill lifecycle：`discard / create / improve / merge`。
- SkillOpt Core 更强调可验证 task、rollout、score 和 validation gate，不依赖完整聊天记录。
- SkillOpt-Sleep 会读取 Claude/Codex transcript，但会先转成 session digest，再 mine recurring tasks，不是把完整 transcript 原样塞进优化器。
- 两者都没有把主任务 Agent 变成长时资产维护者，而是把长期学习放在外部系统中。

因此，AgentMind Worker 应该先定义为独立的、local-first 的维护任务层，以 AgentMind 自己的事件、episodes、sources、history imports 和 proposals 为主要输入，以 harness transcript adapter 为可选增强。它的执行后端可以从 skill-driven 逐步演进到 autonomous。

## 3. 产品目标

AgentMind Worker 的目标是让 workspace 中的长期知识和能力能够持续积累，并且保持可控、可审计、可回滚。

具体目标：

- 从 AgentMind 可获得的输入资源中提取项目 Wiki、用户偏好、工作流、gotchas 和 Skill 候选。
- 根据用户对话、反馈、失败记录、成功 episode 和 rejected/accepted proposal，改进已有 Wiki 和 Skill。
- 在沉淀前判断内容是否具有长期价值，避免把一次性任务细节污染长期资产。
- 检索已有 Wiki、Skill、Memory 和 pending proposals，避免重复创建和冲突更新。
- 默认生成 pending proposal，由用户或 review 流程决定是否接受。
- 在后续阶段支持 replay/eval/validation gate，证明 Skill 变化真的改进了任务表现。

## 4. 非目标

第一阶段明确不做以下事情：

- 不做新的 coding agent。
- 第一版不自研完整后台 Agent runtime。
- 不让 Worker 接管用户当前任务。
- 不依赖 Codex/Claude 私有 session 存储作为核心产品基础。
- 不直接自动重写稳定 Wiki、Skill 或 Memory。
- 不自动维护 Compiled Wiki；Compiled Wiki 更新暂列为 Not Now。
- 不一开始做完整 SkillOpt 风格训练、replay 和 validation benchmark。
- 不把关键词监听当作 reward 或 skill evolution 的主要机制。
- 不把所有历史聊天完整塞进 context 后自由总结。

## 5. 核心原则

### 5.1 主 Agent 专注当前任务

Codex、Claude Code 等主 Agent 的职责是完成用户当前目标。它可以在关键节点写 checkpoint、handoff、episode 或 source record，但不应该承担复杂的长期资产维护逻辑。

这条原则主要约束任务进行中。Session end 之后，当前 Coding Agent 可以作为 Worker 的 skill-driven 执行后端，按专用 skill 处理 Wiki/Skill proposal，因为此时维护工作不再和当前任务争抢注意力。

### 5.2 Worker 只维护长期资产

Worker 关注的是：哪些经验值得沉淀，应该沉淀到哪里，如何避免重复和污染，已有资产是否需要改进。

Worker 是维护任务层，不等同于某一个具体进程。它可以由当前 Coding Agent 按 skill 执行，也可以由 AgentMind 自研 Agent 执行。

### 5.3 Proposal-first

Worker 默认只写 pending proposal 和 worker run logs，不直接改稳定资产。

```text
Worker analysis -> pending proposal -> review -> accept/reject -> apply
```

### 5.4 输入先结构化，再分析

Worker 不应依赖“完整上下文自由推理”。它应先把输入资源规范化为 Resource Bundle、Episode、Conversation Unit、Trajectory Unit 或 Asset Context，再交给 Extract/Improve 处理。

### 5.5 区分 Wiki 和 Skill

Wiki 是项目事实、决策和知识系统；Skill 是 Agent 以后遇到某类任务时应如何行动。

判断规则：

```text
回答“事实是什么 / 决策是什么 / 系统如何设计” -> Wiki
回答“以后遇到这种任务应该怎么做” -> Skill
两者都有 -> 拆成两个 proposal
```

## 6. 用户场景

### 6.1 从对话中沉淀产品决策

用户和主 Agent 讨论 AgentMind Worker 的设计。Worker 在 session end 或手动触发后读取 episode 和 handoff，识别出：

- Compiled Wiki 自动更新不是当前目标。
- Worker 是长期资产维护任务层，MVP 优先由当前 Coding Agent 按 skill 执行。
- Worker 有 Extract 和 Improve 两类职责。
- 主 Agent 不应分心维护长期资产。

Worker 生成 Wiki/decision proposal，而不是直接改 Wiki。

### 6.2 从历史聊天中提取 Skill

用户导入一段过去的 Codex/Claude 对话。Worker 识别出反复出现的工作流，例如“进入 workspace 后必须注册 AgentMind session、查看 stale sessions、claim work item”。Worker 检索已有 `agentmind-workflow` skill，发现已有相似 skill，于是生成 improve/merge proposal，而不是创建重复 skill。

### 6.3 从失败 episode 中提取 gotcha

某次实现失败，因为没有先读取已有 schema 就直接生成 Wiki。Worker 根据失败结果和用户纠正，生成 `wiki/gotchas.md` 或 extraction skill 的 patch proposal。

### 6.4 改进已有 Skill

用户指出某个 skill 太泛、触发条件不清楚、步骤不够可执行。Worker 检索相关 skill、episodes 和 feedback，生成 bounded patch proposal，并标记风险和证据。

## 7. 输入资源模型

Worker 应支持多类输入资源，但第一阶段应以 AgentMind 自己产生的稳定资源为主。

### 7.1 AgentMind Native Inputs

优先级最高，作为核心产品基础：

```text
.agent-context/work/events.jsonl
.agent-context/work/checkpoints/
.agent-context/work/handoffs/
.agent-context/episodes/
.agent-context/rewards/
.agent-context/proposals/pending/
.agent-context/proposals/accepted/
.agent-context/proposals/rejected/
.agent-context/sources/
.agent-context/scans/
.agent-context/wiki/
.agent-context/skills/
```

这些资源由 AgentMind 自己定义和维护，跨 harness 稳定。

### 7.2 Imported History

来自用户显式导入的历史对话或日志：

```text
Markdown transcript
OpenAI-format messages JSON/JSONL
Codex/Claude exported session log
terminal logs
manual notes
```

导入后应先保存 raw source，并生成 extraction job，不应直接写 Wiki/Skill。

### 7.3 Harness Transcript Adapters

可选增强，不作为核心依赖：

```text
Claude Code transcript path / hooks
Codex archived sessions
Cursor / OpenCode logs
```

Adapter 的职责是把 harness-specific transcript 规范化为 AgentMind Resource Bundle。它必须过滤 system/developer/private instructions、tool arguments、raw tool outputs 和 secrets。

### 7.4 Repository And Reference Sources

用于 Wiki 和 Skill 抽取：

```text
source code
README/docs
tests/scripts/config
external URL/reference repo/paper/manual
```

这些 source 应保留 provenance、timestamp、reason、risk 和 confidence。

## 8. 执行后端路线

AgentMind Worker 有两条执行路线。两条路线共享同一套输入资源、WorkerJob、AssetContext、proposal 和 review/apply 机制，区别只在“谁来执行维护推理”。

### 8.1 Route A：Skill-driven Worker

Skill-driven Worker 是第一版推荐路线。

运行方式：

```text
Session end / 用户手动触发
-> 当前 Coding Agent 读取 AgentMind worker skill
-> Agent 按 skill 读取 episode/handoff/source/asset context
-> 生成 pending proposal
-> 用户 review
```

优点：

- 不需要自研 Agent runtime。
- 复用 Codex/Claude Code 已有推理、工具和文件操作能力。
- session end 后执行，不会打断主任务。
- 更容易调试，因为用户能直接看到 Agent 的分析过程。
- 更符合当前 AgentMind 已有 skill/adapters 体系。

代价：

- 不是持续后台运行。
- 依赖用户手动触发、session end hook 或主 Agent 遵守 skill。
- 跨 harness 的一致性取决于 skill 和 adapter view 的质量。
- 难以做长时间批处理、调度、多模型协同和资源隔离。

### 8.2 Route B：Autonomous Worker Agent

Autonomous Worker Agent 是 advanced 路线。

运行方式：

```text
AgentMind worker process
-> 持续或周期性读取 event journal / sources / history
-> 自己调用 LLM provider 和工具
-> 生成 WorkerRun 和 pending proposal
-> 用户 review
```

适用场景：

- 需要后台常驻或定时 sleep cycle。
- 需要批量处理大量历史 transcript/source。
- 需要在主 Agent 不在线时维护资产。
- 需要更严格的权限隔离、预算控制、队列和重试。
- 需要多模型调度或 validation gate。

代价：

- 需要实现 Agent runtime、prompt protocol、tool policy、LLM provider、队列、状态和错误恢复。
- 更难调试和解释。
- 更容易过度复杂化。
- 第一版容易分散产品重心。

### 8.3 路线选择

当前产品优先级：

```text
MVP：Route A，skill-driven Worker
Advanced：Route B，自研 autonomous Worker Agent
```

核心原因：Worker 的高价值动作主要发生在 session end 或用户手动触发后，此时直接让当前 Coding Agent 按 AgentMind skills 处理 Wiki/Skill proposal，是更简单、更可维护的闭环。

## 9. 核心对象

### 9.1 ResourceBundle

一次 Worker 处理的输入包。

```json
{
  "id": "resource_bundle_xxx",
  "kind": "episode | conversation | trajectory | document | scan | mixed",
  "source_ids": [],
  "summary": "",
  "normalized_content_path": "",
  "created_at": ""
}
```

### 9.2 WorkerJob

Worker 的任务实例。

```json
{
  "id": "worker_job_xxx",
  "mode": "extract | improve",
  "status": "queued | running | completed | failed | skipped",
  "resource_bundle_id": "resource_bundle_xxx",
  "target_assets": [],
  "created_at": "",
  "updated_at": ""
}
```

### 9.3 AssetContext

Worker 为一次 job 检索到的相关资产上下文。

```json
{
  "wiki_pages": [],
  "skills": [],
  "memory_files": [],
  "pending_proposals": [],
  "accepted_proposals": [],
  "rejected_proposals": []
}
```

### 9.4 Episode

Episode 是一次 work/session 的事实记录和 provenance anchor。MVP 阶段的 episode 可以是机械生成的，不要求是 Agent 智能总结出的完整轨迹。

当前机械 episode 的主要来源：

```text
work item
handoff summary
latest checkpoint
changed files
verification summaries
session id
outcome/status
```

Episode 的意义是：

- 给 proposal 提供 evidence anchor。
- 记录一次 work 的目标、结果和可追溯摘要。
- 作为 Worker Extract/Improve 的输入。
- 作为 reward/feedback 的 target。
- 让跨 session 的历史工作有 durable record。

Episode 的边界也必须明确：

- 不等于完整对话记录。
- 不等于完整 agent trajectory。
- 不等于高质量 Wiki/Skill 抽取结果。
- 不应直接被视为 verified project fact。
- 需要 Worker skill 或人工 review 进一步提炼，才能进入稳定 Wiki/Skill。

### 9.5 WorkerRun

一次 Worker 执行记录，用于审计和 debug。

```json
{
  "id": "worker_run_xxx",
  "job_id": "worker_job_xxx",
  "model": "",
  "inputs": [],
  "decisions": [],
  "proposals": [],
  "discarded": [],
  "created_at": ""
}
```

### 9.6 ProposalDraft

Worker 输出的候选资产更新。

ProposalDraft 是待审核的维护任务建议，不等于稳定资产变更。MVP 阶段允许 proposal 的 `patch` 是自然语言建议或抽取任务说明；后续如果要自动 apply，patch 需要升级为可执行 diff 或结构化 operation。

现有 `UpdateProposal` 可作为 MVP 基础：

```json
{
  "id": "proposal_xxx",
  "asset": ".agent-context/skills/example/SKILL.md",
  "operation": "create | update | replace | deprecate | disable",
  "reason": "",
  "evidence": [],
  "risk": "low | medium | high | critical",
  "status": "pending_review",
  "patch": "",
  "created_at": ""
}
```

Proposal 的状态语义：

```text
pending_review：等待人或 Agent review
accepted：被确认值得采纳，但不一定已经写入稳定资产
rejected：不采纳；后续 Worker 应读取它以避免重复生成
applied：后续可新增状态，表示已经写入目标资产
```

因此，`accept` 和 `apply` 必须分开建模：

```text
accept = 认可这个 proposal 的方向
apply = 把 proposal 的内容实际写入 wiki/skill/memory/tool asset
```

后续可扩展字段：

```text
proposal_type: wiki | skill | memory | gotcha | workflow | reward
confidence
source_bundle_id
worker_job_id
duplicate_of
target_asset_candidates
discard_reason
```

## 10. Worker 能力一：Extract

Extract 的职责是从新输入资源中提取长期资产候选。

### 10.1 Extract 输入

```text
ResourceBundle
AssetContext
用户提供的 extraction hint
当前项目目标和非目标
已有 schema / skill policy
```

### 10.2 Extract 输出

```text
create wiki proposal
update wiki proposal
create skill proposal
improve/merge skill proposal
discard decision
worker run log
```

### 10.3 Extract 决策

Extract 必须先判断内容是否有长期价值。

应该沉淀的内容：

- 稳定项目事实。
- 已确认产品决策。
- 用户长期偏好。
- 可复用工作流。
- 可复用工具规则。
- 重复失败模式。
- 明确纠正过的 gotcha。
- 可迁移到未来任务的 Skill。

应该丢弃的内容：

- 一次性任务细节。
- 没有证据的推测。
- 泛泛的用户表扬或抱怨。
- 已经存在且没有增量的信息。
- 与当前目标无关的临时实现细节。
- 无法区分事实和 hallucination 的 agent 输出。

### 10.4 Extract 资产分类

Extract 必须明确输出目标类型。

```text
Project fact / decision / architecture -> Wiki
Repeatable agent behavior -> Skill
Stable user/workspace preference -> Memory
Known failure mode -> Gotcha Wiki or Skill patch
Tool usage rule -> Skill or tools config proposal
```

## 11. Worker 能力二：Improve

Improve 的职责是根据新证据迭代已有 Wiki 和 Skill。

### 11.1 Improve 输入

```text
已有 Wiki / Skill / Memory
相关 episodes
用户反馈
accepted/rejected proposals
失败记录
验证结果
当前产品决策和非目标
```

### 11.2 Improve 输出

```text
patch wiki proposal
patch skill proposal
merge duplicate skill proposal
deprecate stale asset proposal
reject/no-op decision
worker run log
```

### 11.3 Improve 判断

Improve 需要回答：

- 现有资产是否过期？
- 是否和用户最新决策冲突？
- 是否过于泛化，导致未来 Agent 误用？
- 是否缺少触发条件、步骤、边界或验证？
- 是否已有重复 Skill 或重复 Wiki 页面？
- 是否应该 merge，而不是 create？
- 是否应该 deprecate，而不是 patch？

### 11.4 Improve 边界

Improve 不能因为一次反馈就大幅重写高影响资产。高风险变更必须：

- 保留证据。
- 标记风险。
- 说明替代方案。
- 进入人工 review。
- 必要时等待更多 episodes 或验证结果。

## 12. Worker Pipeline

Worker 的标准处理流程：

```text
1. Ingest
2. Normalize
3. Classify Job
4. Retrieve Asset Context
5. Run Extract or Improve
6. Dedupe and Conflict Check
7. Generate Proposal
8. Write WorkerRun
9. Wait for Review
```

### 12.1 Ingest

读取新增事件、episode、handoff、history import、source 或用户手动指定资源。

### 12.2 Normalize

把不同资源转换为统一 ResourceBundle。Transcript adapter 需要在此阶段过滤隐私和 harness 内部内容。

### 12.3 Classify Job

判断应该进入 Extract 还是 Improve。

```text
新 source / 新 conversation / 新 scan -> Extract
用户反馈 / rejected proposal / asset conflict / failed episode -> Improve
```

### 12.4 Retrieve Asset Context

检索已有相关资产，避免重复和冲突。

MVP 可以使用简单检索：

```text
文件名
title
description
tags
recent links
pending proposal asset path
```

后续再加入 embedding/BM25。

### 12.5 Run Extract Or Improve

按执行后端运行维护推理，输出结构化 decision 和 proposal draft。

- Skill-driven backend：当前 Coding Agent 读取 AgentMind worker skill 和 WorkerJob packet 后执行。
- Autonomous backend：AgentMind worker process 自己调用 LLM provider 和受限工具执行。

### 12.6 Dedupe And Conflict Check

检查：

- 是否已有同类 pending proposal。
- 是否和 rejected proposal 重复。
- 是否和当前非目标冲突。
- 是否没有足够证据。
- 是否过于泛化。

### 12.7 Generate Proposal

写入 `.agent-context/proposals/pending/`。

### 12.8 Write WorkerRun

写入 `.agent-context/worker/runs/`，用于解释 Worker 为什么这么判断。

## 13. 运行模式

### 13.1 Manual One-shot

第一阶段推荐实现。

```bash
agentmind worker run --once --root <workspace>
```

处理当前未处理的 WorkerJob，适合开发和调试。

### 13.2 Targeted Run

针对某个资源或 episode 运行。

```bash
agentmind worker extract --source <source-id> --root <workspace>
agentmind worker improve --asset .agent-context/skills/x/SKILL.md --root <workspace>
```

### 13.3 Session-end Run

在 handoff/session end 后运行，分析刚结束的工作。

```bash
agentmind worker run --since-last --root <workspace>
```

### 13.4 Watch Mode

后续阶段实现。

```bash
agentmind worker watch --root <workspace>
```

监听 AgentMind event journal，但仍然默认只生成 proposals。

### 13.5 Sleep Mode

后续阶段实现，类似 SkillOpt-Sleep。

```bash
agentmind worker sleep --root <workspace>
```

批量处理历史 sessions、mine recurring tasks、可选 replay/eval。

## 14. 权限模型

Worker 权限必须窄于主 Agent。

### 14.1 默认可读

```text
.agent-context/wiki/
.agent-context/skills/
.agent-context/memory/
.agent-context/work/
.agent-context/episodes/
.agent-context/rewards/
.agent-context/proposals/
.agent-context/sources/
用户显式导入的 history/reference
```

### 14.2 默认可写

```text
.agent-context/worker/
.agent-context/proposals/pending/
.agent-context/episodes/  # 仅当生成派生 episode 时
.agent-context/rewards/   # 仅当记录明确 reward signal 时
```

### 14.3 默认不可写

```text
稳定 wiki 页面
稳定 canonical skills
public/workspace memory
project source code
adapter generated views
```

这些资产只能通过 review/accept/apply 流程更新，除非用户显式要求直接写。

## 15. Review 和 Apply

Worker 输出 proposal 后，由 review 流程处理。

```text
pending proposal
-> user/agent review
-> accept / reject
-> apply accepted patch
-> write review record
-> optional improve policy update
```

当前实现只有最小状态移动：

```text
agentmind review
agentmind review --accept <proposal-id>
agentmind review --reject <proposal-id>
```

其中 `--accept` 目前只表示把 proposal 从 `pending/` 移到 `accepted/`，不代表 patch 已经写入目标 Wiki/Skill。`--reject` 只表示移到 `rejected/`，用于保留反例和避免重复建议。

MVP 需要把 review/apply 语义显式化：

```text
review list/show：查看 pending proposals 和 evidence
review accept：认可 proposal，但不自动改稳定资产
review reject：拒绝 proposal，并记录原因
review apply：把 accepted proposal 应用到目标资产
review accept --apply：低风险场景下接受并应用
```

在 proposal patch 还是自然语言建议时，`apply` 可以先由当前 Coding Agent 按 worker/review skill 执行，而不是由 CLI 自动 patch 文件。只有当 proposal 采用可执行 diff 或结构化 operation 后，CLI 才能安全自动 apply。

Rejected proposal 不是垃圾数据。Worker 后续应读取 rejected proposals，避免重复生成相同低质量更新。

Review/apply 的目标闭环是：

```text
mechanical episode
-> rough proposal
-> Worker skill 生成高质量 proposal
-> review accept/reject
-> apply accepted change
-> stable Wiki/Skill/Memory update
```

## 16. MVP 范围

第一版只做最小闭环：

```text
AgentMind native inputs
-> ResourceBundle
-> WorkerJob / packet
-> 当前 Coding Agent 按 worker skill 执行 Extract/Improve
-> proposal
-> worker run log
```

MVP 的 `agentmind worker run --once` 可以先是 skill-driven orchestration：它负责发现待处理输入、生成 WorkerJob/packet、提示或触发当前 Coding Agent 按 AgentMind worker skill 执行维护任务。它不要求实现独立后台 Agent runtime。

MVP 必须包含：

- `agentmind worker run --once`。
- 读取新 episode、handoff、checkpoint、pending/accepted/rejected proposal。
- 明确 episode 是机械事实记录和 provenance anchor，不把它直接当作高质量知识资产。
- 明确 proposal 是待审核建议，不等于已应用 patch。
- 生成 WorkerJob/packet，供当前 Coding Agent 按 skill 执行。
- 简单 asset retrieval。
- Extract job：从 episode/history/source 中生成 Wiki/Skill proposal。
- Improve job：根据 feedback/rejected proposal/failed episode 生成 patch proposal。
- Dedupe：避免同一 asset 同一原因重复 proposal。
- Review list/show/accept/reject 的可用体验。
- Apply 先允许 skill-driven/manual apply，不强制 CLI 自动 apply。
- Worker run log：记录输入、判断、输出、discard reason。

MVP 不包含：

- watch daemon。
- sleep scheduler。
- 自研 autonomous Agent runtime。
- embedding 检索。
- 全自动 apply。
- 可执行 diff patch 体系。
- replay/eval validation gate。
- 自动 Compiled Wiki 更新。
- 实时读取 Codex/Claude 当前 session。

## 17. 后续阶段

### Phase 2：Skill Lifecycle

引入 AutoSkill 风格的 skill lifecycle：

```text
discard / create / improve / merge / deprecate
```

补充 skill similarity search、versioning、provenance 和 usage stats。

### Phase 3：History And Transcript Import

支持：

- OpenAI-format conversation import。
- Claude Code transcript adapter。
- Codex archived session adapter。
- trajectory/log import。

但核心仍然是先 normalize，再 extract/improve。

### Phase 4：Validation Gate

引入 SkillOpt 风格验证：

- repeatable task mining。
- replay/eval harness。
- old skill vs new skill comparison。
- held-out validation gate。
- rejected edit buffer。

只对可验证 Skill 启用。

### Phase 5：Sleep Worker

实现周期性离线维护：

```text
harvest/import sessions
-> mine recurring tasks
-> extract/improve proposals
-> optional validation gate
-> stage for review
```

## 18. 成功指标

### 18.1 质量指标

- Proposal 有明确 evidence。
- Proposal 能准确区分 Wiki 和 Skill。
- Duplicate proposal 数量低。
- Rejected proposal 的重复生成率低。
- 生成的 Skill 有明确触发条件、步骤、边界和验证。
- Wiki proposal 能保留 source/citation/confidence。

### 18.2 使用指标

- Worker 能从已完成 work item 自动发现可沉淀内容。
- 用户 review proposal 的成本低于手写 Wiki/Skill。
- 后续 Agent 能实际复用 accepted Wiki/Skill。
- AgentMind 新 session 的重复解释成本下降。

### 18.3 安全指标

- Worker 不泄露 system/developer/private instructions。
- Worker 不记录 secrets 或 raw tool outputs。
- Worker 不直接修改稳定资产。
- Worker 对高风险更新标记风险并等待 review。

## 19. 关键开放问题

- Worker 使用哪个 LLM provider，如何配置本地/远程模型？
- Proposal patch 应该是纯文本建议，还是可 apply 的 unified diff？
- Proposal 是否需要新增 `applied` 状态，还是用 accepted + apply log 表达？
- Review reject/accept 是否必须记录 human reason？
- WorkerRun log 是否需要保存完整 LLM 输入输出，还是只保存摘要和结构化 decision？
- Skill versioning 放在 `SKILL.md` frontmatter，还是单独 provenance 文件？
- Review/accept 后由哪个命令负责 apply patch？
- 机械 episode 何时需要升级为 agent-generated rich episode？
- 什么时候可以从 proposal-first 升级到 low-risk auto-apply？
- Codex/Claude transcript adapter 的隐私过滤规则如何测试？

## 20. 初始验收标准

第一版 Worker 完成时，应满足：

- 能运行 `agentmind worker run --once`。
- 能读取至少一种 AgentMind native input，例如 latest episode 或 handoff。
- 能把 episode 明确作为 provenance/evidence 使用，而不是直接当作稳定知识。
- 能生成 `extract` 或 `improve` 类型 WorkerJob。
- 能检索至少 wiki/skills/pending proposals 三类 AssetContext。
- 能输出 pending proposal，并包含 asset、operation、reason、evidence、risk、patch。
- 能区分 proposal accept 和 apply，不把 accepted proposal 误报为已写入资产。
- 能记录 WorkerRun，说明输入、判断、生成或丢弃原因。
- 不直接修改稳定 Wiki、Skill、Memory。
- 对“Compiled Wiki 自动更新”明确不执行，只可记录为 Not Now 决策。
