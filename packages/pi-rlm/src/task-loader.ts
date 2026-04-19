import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { createJiti } from '@mariozechner/jiti'
import bundledTasks from './tasks'
import type { AxTaskDefinition, AxTaskRegistry, LoadedAxTask } from './types'

const TASK_FILE_EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.mts'])

function isTaskDefinition(value: unknown): value is AxTaskDefinition {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AxTaskDefinition).id === 'string' &&
    typeof (value as AxTaskDefinition).description === 'string' &&
    typeof (value as AxTaskDefinition).prepare === 'function'
  )
}

async function walkTaskFiles(rootDir: string): Promise<string[]> {
  if (!existsSync(rootDir)) {
    return []
  }

  const paths: string[] = []
  const entries = await readdir(rootDir, { withFileTypes: true })

  for (const entry of entries) {
    const absolutePath = join(rootDir, entry.name)
    if (entry.isDirectory()) {
      paths.push(...(await walkTaskFiles(absolutePath)))
      continue
    }

    if (!TASK_FILE_EXTENSIONS.has(extname(entry.name))) {
      continue
    }

    paths.push(absolutePath)
  }

  return paths.sort((left, right) => left.localeCompare(right))
}

async function importTaskDefinition(
  taskPath: string,
): Promise<AxTaskDefinition> {
  const jiti = createJiti(import.meta.url, {
    moduleCache: false,
  })

  const loaded = await jiti.import(taskPath, { default: true })
  if (!isTaskDefinition(loaded)) {
    throw new Error(
      `Task module does not export a valid task definition: ${taskPath}`,
    )
  }

  return loaded
}

export function getProjectTaskRoot(cwd: string): string {
  return join(cwd, '.pi', 'rlm', 'tasks')
}

export function createTaskRegistry(
  options: {
    bundled?: readonly AxTaskDefinition[]
    taskRoot?: (cwd: string) => string
  } = {},
): AxTaskRegistry {
  const builtinTasks = options.bundled ?? bundledTasks
  const resolveTaskRoot = options.taskRoot ?? getProjectTaskRoot

  const list = async (cwd: string): Promise<LoadedAxTask[]> => {
    const taskMap = new Map<string, LoadedAxTask>()

    for (const task of builtinTasks) {
      taskMap.set(task.id, {
        id: task.id,
        description: task.description,
        source: 'bundled',
        task,
      })
    }

    const projectTaskPaths = await walkTaskFiles(resolveTaskRoot(cwd))
    for (const taskPath of projectTaskPaths) {
      const task = await importTaskDefinition(taskPath)
      taskMap.set(task.id, {
        id: task.id,
        description: task.description,
        source: 'project',
        path: taskPath,
        task,
      })
    }

    return [...taskMap.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    )
  }

  const get = async (cwd: string, id: string) => {
    const tasks = await list(cwd)
    return tasks.find((task) => task.id === id)
  }

  return {
    list,
    get,
  }
}

export const createRlmWorkflowRegistry = createTaskRegistry
