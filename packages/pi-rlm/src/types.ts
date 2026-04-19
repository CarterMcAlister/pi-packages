import type { Api, Model } from '@mariozechner/pi-ai'
import type { ExtensionContext } from '@mariozechner/pi-coding-agent'

export type AxTaskStatusKind = 'info' | 'success' | 'failed'

export interface AxTaskStatusUpdate {
  message: string
  kind: AxTaskStatusKind
}

export interface AxTaskHelpers {
  readTextFile(path: string): Promise<string>
  resolvePath(path: string): string
}

export interface AxTaskPrepareContext {
  cwd: string
  query?: string
  inputs: Record<string, string>
  helpers: AxTaskHelpers
  model?: string
  onStatus: (message: string, kind?: AxTaskStatusKind) => void
}

export interface AxClarificationChoice {
  label: string
  value: string
}

export interface AxClarificationPrompt {
  question: string
  type?: 'text' | 'number' | 'date' | 'single_choice' | 'multiple_choice'
  choices?: Array<string | AxClarificationChoice>
}

export type AxClarificationAnswer = string | string[]

export interface AxClarificationConfig {
  answerField?: string
  applyAnswer?: (args: {
    currentInputs: Record<string, unknown>
    answer: AxClarificationAnswer
    clarification: AxClarificationPrompt
  }) => Promise<Record<string, unknown>> | Record<string, unknown>
}

export interface AxForwardAgent<
  ResultValues extends Record<string, unknown> = Record<string, unknown>,
> {
  forward(ai: unknown, inputs: Record<string, unknown>): Promise<ResultValues>
  setState?(state: unknown): void
  getState?(): unknown
}

export interface AxPreparedTask<
  ResultValues extends Record<string, unknown> = Record<string, unknown>,
> {
  agent: AxForwardAgent<ResultValues>
  inputs: Record<string, unknown>
  clarification?: AxClarificationConfig
}

export interface AxFormattedTaskResult {
  summary: string
  markdown?: string
  result?: Record<string, unknown>
}

export interface AxTaskDefinition<
  ResultValues extends Record<string, unknown> = Record<string, unknown>,
> {
  id: string
  description: string
  inputSchema?: Record<string, string>
  examples?: string[]
  defaultModel?: string
  prepare(
    context: AxTaskPrepareContext,
  ): Promise<AxPreparedTask<ResultValues>> | AxPreparedTask<ResultValues>
  formatResult?(args: {
    result: ResultValues
    prepared: AxPreparedTask<ResultValues>
    context: AxTaskPrepareContext
  }): AxFormattedTaskResult
}

export interface LoadedAxTask {
  id: string
  description: string
  source: 'bundled' | 'project'
  path?: string
  task: AxTaskDefinition
}

export interface AxTaskRegistry {
  list(cwd: string): Promise<LoadedAxTask[]>
  get(cwd: string, id: string): Promise<LoadedAxTask | undefined>
}

export interface AxTaskRunRequest {
  task: string
  query?: string
  inputs?: Record<string, string>
  model?: string
  debug?: boolean
}

export interface ResolvedAxModel {
  ai: unknown
  provider: string
  modelId: string
  spec: string
  source: 'active' | 'override' | 'task-default' | 'settings-default'
}

export interface ResolvedPiModel {
  model: Model<Api>
  provider: string
  modelId: string
  spec: string
  source: 'active' | 'override' | 'task-default' | 'settings-default'
  apiKey?: string
  headers?: Record<string, string>
}

export interface AxTaskRunResult {
  taskId: string
  description: string
  source: 'bundled' | 'project'
  sourcePath?: string
  model: Omit<ResolvedAxModel, 'ai'>
  summary: string
  outputText: string
  markdown?: string
  result: Record<string, unknown>
  statusUpdates: AxTaskStatusUpdate[]
  clarifications: number
  debug: boolean
}

export type AxTaskRunner = (
  request: AxTaskRunRequest,
  ctx: ExtensionContext,
  registry: AxTaskRegistry,
) => Promise<AxTaskRunResult>

export interface PiRlmExtensionOptions {
  registry?: AxTaskRegistry
  runTask?: AxTaskRunner
}

export type RlmWorkflowStatusKind = AxTaskStatusKind
export type RlmWorkflowStatusUpdate = AxTaskStatusUpdate
export type RlmWorkflowHelpers = AxTaskHelpers
export type RlmWorkflowPrepareContext = AxTaskPrepareContext
export type RlmClarificationChoice = AxClarificationChoice
export type RlmClarificationPrompt = AxClarificationPrompt
export type RlmClarificationAnswer = AxClarificationAnswer
export type RlmClarificationConfig = AxClarificationConfig
export type RlmWorkflowAgent<
  ResultValues extends Record<string, unknown> = Record<string, unknown>,
> = AxForwardAgent<ResultValues>
export type RlmPreparedWorkflow<
  ResultValues extends Record<string, unknown> = Record<string, unknown>,
> = AxPreparedTask<ResultValues>
export type RlmFormattedWorkflowResult = AxFormattedTaskResult
export type RlmWorkflowDefinition<
  ResultValues extends Record<string, unknown> = Record<string, unknown>,
> = AxTaskDefinition<ResultValues>
export type LoadedRlmWorkflow = LoadedAxTask
export type RlmWorkflowRegistry = AxTaskRegistry
export type RlmWorkflowRunRequest = AxTaskRunRequest
export type ResolvedRlmModel = ResolvedAxModel
export type RlmWorkflowRunResult = AxTaskRunResult
export type RlmWorkflowRunner = AxTaskRunner

export type RlmMode = 'auto' | 'solve' | 'decompose'
export type RlmRunStatus = 'running' | 'completed' | 'failed' | 'cancelled'
export type RlmNodeStatus = RlmRunStatus
export type RlmToolOp = 'start' | 'status' | 'wait' | 'cancel'

export interface RlmStartRequest {
  task: string
  mode: RlmMode
  maxDepth: number
  maxNodes: number
  maxBranching: number
  concurrency: number
  model?: string
  cwd: string
}

export interface RlmNodeDecision {
  action: 'solve' | 'decompose'
  reason: string
  subtasks?: string[]
}

export interface RlmNode {
  id: string
  task: string
  depth: number
  status: RlmNodeStatus
  startedAt: number
  finishedAt?: number
  decision?: RlmNodeDecision
  result?: string
  error?: string
  children: RlmNode[]
}

export interface RlmRunArtifacts {
  dir: string
  eventsPath: string
  treePath: string
  outputPath: string
}

export interface RlmRunResult {
  runId: string
  root: RlmNode
  final: string
  model: string
  artifacts: RlmRunArtifacts
  events: string[]
  stats: {
    nodesVisited: number
    maxDepthSeen: number
    durationMs: number
  }
}

export interface RlmPlanResult {
  action: 'solve' | 'decompose'
  reason: string
  subtasks?: string[]
}

export interface RlmEngineOptions {
  signal?: AbortSignal
  onProgress?: (message: string) => void
  resolveModel?: (
    ctx: ExtensionContext,
    overrideModel?: string,
    taskDefaultModel?: string,
  ) => Promise<ResolvedPiModel>
}

export interface RlmRunRecord {
  id: string
  input: RlmStartRequest
  status: RlmRunStatus
  createdAt: number
  startedAt: number
  finishedAt?: number
  error?: string
  currentActivity?: string
  recentEvents: string[]
  controller: AbortController
  promise: Promise<RlmRunResult>
  result?: RlmRunResult
}
