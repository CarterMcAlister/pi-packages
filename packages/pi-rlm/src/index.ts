import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { registerRlmWorkflowCommand } from './command'
import { refreshRlmRunsWidget } from './command-ui'
import { registerRlmCommand } from './rlm-command'
import { registerRlmTool } from './rlm-tool'
import { runRlmWorkflow } from './runner'
import { createRlmWorkflowRegistry } from './task-loader'
import { registerRlmWorkflowTool } from './tool'
import type { PiRlmExtensionOptions } from './types'

export function createPiRlm(options: PiRlmExtensionOptions = {}) {
  const registry = options.registry ?? createRlmWorkflowRegistry()
  const runTask = options.runTask ?? runRlmWorkflow

  return async function piRlm(pi: ExtensionAPI) {
    pi.on('session_start', async (_event, ctx) => {
      refreshRlmRunsWidget(ctx)
    })
    registerRlmTool(pi)
    registerRlmCommand(pi)
    registerRlmWorkflowTool(pi, registry, runTask)
    registerRlmWorkflowCommand(pi, registry, runTask)
  }
}

export * from './model'
export * from './rlm-command'
export * from './rlm-engine'
export * from './rlm-tool'
export * from './runner'
export * from './task-loader'
export * from './types'

export default createPiRlm()
