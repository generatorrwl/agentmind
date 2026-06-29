export type AgentHarness = "codex" | "claude";

export type WorkStatus = "todo" | "doing" | "done" | "paused" | "abandoned";

export type WorkPriority = "low" | "medium" | "high";

export type RewardPolarity = "positive" | "negative" | "mixed" | "neutral";

export type SourceKind = "reference" | "history" | "repository" | "episode" | "fixed_knowledge";

export type SourceContentType = "url" | "file" | "directory" | "text";

export type WorkerMode = "extract" | "improve";

export type WorkerJobStatus = "queued" | "running" | "completed" | "failed" | "skipped";

export type ResourceBundleKind = "episode" | "conversation" | "trajectory" | "document" | "scan" | "mixed";

export type ProjectDesignStatus = "draft" | "asking_user" | "reading_workspace" | "researching" | "proposing_options" | "waiting_user" | "ready_for_proposal" | "complete";

export type ProjectDesignMode = "new" | "revise";

export interface EpisodeRecord {
  id: string;
  workspace: string;
  agent?: string;
  goal: string;
  assets_used: string[];
  actions: {
    files_read: string[];
    files_modified: string[];
    commands: Array<{ command: string; exit_code?: number; summary?: string }>;
  };
  verification: Record<string, unknown>;
  user_feedback?: string | null;
  outcome: "success" | "failed" | "unknown";
  created_at: string;
}

export interface RewardEvent {
  id: string;
  source: "human" | "verification" | "self_reflection" | "codebase" | "reuse" | "risk";
  polarity: RewardPolarity;
  confidence: number;
  target_episode?: string;
  evidence: string[];
  suspected_causes: string[];
  created_at: string;
}

export interface UpdateProposal {
  id: string;
  asset: string;
  operation: "create" | "update" | "replace" | "deprecate" | "disable";
  reason: string;
  evidence: string[];
  risk: "low" | "medium" | "high" | "critical";
  status: "pending_review" | "accepted" | "rejected" | "applied";
  patch?: string;
  review?: {
    decision: "accepted" | "rejected";
    reason?: string;
    reviewed_at: string;
  };
  application?: {
    mode: "manual";
    reason?: string;
    applied_at: string;
  };
  created_at: string;
}

export interface ResourceBundle {
  id: string;
  kind: ResourceBundleKind;
  source_ids: string[];
  summary: string;
  normalized_content_path?: string;
  created_at: string;
}

export interface WorkerJob {
  id: string;
  mode: WorkerMode;
  status: WorkerJobStatus;
  resource_bundle_id: string;
  target_assets: string[];
  created_at: string;
  updated_at: string;
}

export interface WorkerRun {
  id: string;
  job_id: string;
  backend: "skill_driven" | "autonomous";
  status: "packet_ready" | "completed" | "failed" | "skipped";
  model?: string;
  inputs: string[];
  decisions: Array<{ type: string; message: string; reason?: string }>;
  proposals: string[];
  discarded: Array<{ input: string; reason: string }>;
  packet_path?: string;
  created_at: string;
}

export interface ProjectDesignRecord {
  id: string;
  mode: ProjectDesignMode;
  status: ProjectDesignStatus;
  root: string;
  from_scan?: string;
  from_source?: string;
  files: {
    packet: string;
    plan: string;
    workspace_sources: string;
    research_notes: string;
    user_decisions: string;
    profile_candidates: string;
    schema_candidates: string;
    skill_candidates: string;
    migration_preview: string;
    output_contract: string;
    design_log: string;
  };
  proposals: string[];
  created_at: string;
  updated_at: string;
}

export interface SourceRecord {
  id: string;
  kind: SourceKind;
  content_type: SourceContentType;
  title: string;
  source: {
    path?: string;
    url?: string;
    original_path?: string;
  };
  snapshot_path?: string;
  summary?: string;
  reason?: string;
  tags: string[];
  status: "captured" | "queued_for_extraction" | "extracted" | "archived";
  created_at: string;
  updated_at: string;
}

export interface ScanSource {
  id: string;
  path: string;
  type: "code" | "docs" | "config" | "tests" | "agent_context" | "history" | "reference" | "other";
  reason: string;
  status: "candidate" | "selected" | "skipped" | "extracted";
  added_at: string;
}

export interface ScanRecord {
  id: string;
  goal: string;
  mode: "new" | "existing" | "manual";
  status: "open" | "finished";
  sources: ScanSource[];
  instructions_path: string;
  created_at: string;
  updated_at: string;
  finished_at?: string;
}

export interface CapabilityRecord {
  id: string;
  type: "skill" | "mcp_server" | "cli_tool" | "prompt_pack" | "rule";
  source: {
    kind: "local" | "github" | "registry" | "unknown";
    path?: string;
    url?: string;
  };
  description?: string;
  permissions: {
    network: boolean;
    filesystem: boolean;
    secrets: string[];
  };
  risk: "low" | "medium" | "high" | "critical";
  status: "discovered" | "candidate" | "installed" | "project-adapted" | "active" | "promoted" | "deprecated";
  project_fit: {
    score: number;
    reasons: string[];
  };
  adapters: Record<string, "available" | "unavailable" | "unknown">;
  created_at: string;
  updated_at: string;
}

export interface WorkItem {
  id: string;
  title: string;
  status: WorkStatus;
  priority: WorkPriority;
  owner?: string | null;
  goal?: string;
  next?: string;
  blockers: string[];
  assumptions: string[];
  dont_touch: string[];
  links: {
    episodes: string[];
    rewards: string[];
    proposals: string[];
    references: string[];
    wiki: string[];
  };
  created_at: string;
  updated_at: string;
  last_checkpoint?: string;
  completed_at?: string;
}

export interface WorkEvent {
  id: string;
  work_id?: string;
  session_id?: string;
  type: "created" | "claimed" | "checkpointed" | "paused" | "finished" | "abandoned" | "released";
  summary?: string;
  created_at: string;
}

export interface WorkSession {
  id: string;
  harness: AgentHarness | "unknown";
  status: "active" | "ended" | "stale";
  focus?: string;
  owned_work: string[];
  started_at: string;
  heartbeat_at: string;
  ended_at?: string;
}

export interface WorkLease {
  id: string;
  work_id: string;
  session_id: string;
  status: "active" | "released";
  scope: string[];
  created_at: string;
  released_at?: string;
}

export interface WorkCheckpoint {
  id: string;
  work_id: string;
  session_id?: string;
  summary: string;
  next?: string;
  blockers: string[];
  changed_files: string[];
  verification: string[];
  created_at: string;
}

export interface WorkHandoff {
  id: string;
  work_id: string;
  session_id?: string;
  status: "paused" | "finished" | "abandoned";
  summary: string;
  next?: string;
  created_at: string;
}
