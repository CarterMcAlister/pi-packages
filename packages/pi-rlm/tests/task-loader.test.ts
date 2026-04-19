import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createRlmWorkflowRegistry,
  getProjectTaskRoot,
} from '../src/task-loader'

const tempDirs: string[] = []

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) {
      await rm(dir, { recursive: true, force: true })
    }
  }
})

test('lists bundled tasks by default', async () => {
  const registry = createRlmWorkflowRegistry()
  const tasks = await registry.list(process.cwd())

  expect(tasks.map((task) => task.id)).toContain('incident-review')
  expect(tasks.map((task) => task.id)).toContain('rfc-quality-check')
})

test('uses the RLM project task root by default', () => {
  expect(getProjectTaskRoot('/repo')).toBe('/repo/.pi/rlm/tasks')
})

test('project-local workflows from .pi/rlm/tasks override bundled workflows by id', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-rlm-loader-'))
  tempDirs.push(root)

  const rlmTaskDir = join(root, '.pi', 'rlm', 'tasks')

  await Bun.write(
    join(rlmTaskDir, 'incident-review.ts'),
    `export default {
      id: 'incident-review',
      description: 'RLM override',
      async prepare() {
        return {
          agent: {
            async forward() {
              return { answer: 'rlm' }
            },
          },
          inputs: {},
        }
      },
    }
`,
  )

  const registry = createRlmWorkflowRegistry()
  const task = await registry.get(root, 'incident-review')

  expect(task?.source).toBe('project')
  expect(task?.description).toBe('RLM override')
  expect(task?.path).toContain('.pi/rlm/tasks/incident-review.ts')
})
