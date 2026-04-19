import type {
  RlmRunRecord,
  RlmRunResult,
  RlmRunStatus,
  RlmStartRequest,
} from './types'

const maxRecords = 200
const maxRecentEvents = 25

export class RlmRunStore {
  private readonly records = new Map<string, RlmRunRecord>()

  start(
    input: RlmStartRequest,
    executor: (runId: string, signal: AbortSignal) => Promise<RlmRunResult>,
    externalSignal?: AbortSignal,
  ): RlmRunRecord {
    const id = createRunId()
    const controller = new AbortController()

    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort()
      } else {
        externalSignal.addEventListener(
          'abort',
          () => {
            controller.abort()
          },
          { once: true },
        )
      }
    }

    const record: RlmRunRecord = {
      id,
      input,
      status: 'running',
      createdAt: Date.now(),
      startedAt: Date.now(),
      recentEvents: [],
      controller,
      promise: Promise.resolve(null as unknown as RlmRunResult),
    }

    const runPromise = (async () => {
      try {
        const result = await executor(id, controller.signal)
        record.status = 'completed'
        record.finishedAt = Date.now()
        record.result = result
        record.currentActivity = 'Completed'
        this.appendEvent(id, `Run completed in ${result.stats.durationMs}ms`)
        return result
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        record.finishedAt = Date.now()
        record.status =
          controller.signal.aborted || message.toLowerCase().includes('cancel')
            ? 'cancelled'
            : 'failed'
        record.error = message
        record.currentActivity = message
        this.appendEvent(id, message)
        throw error
      } finally {
        this.prune()
      }
    })()

    void runPromise.catch(() => undefined)
    record.promise = runPromise
    this.records.set(id, record)
    this.prune()
    return record
  }

  get(id: string): RlmRunRecord | undefined {
    return this.records.get(id)
  }

  list(): RlmRunRecord[] {
    return [...this.records.values()].sort(
      (left, right) => right.createdAt - left.createdAt,
    )
  }

  appendEvent(id: string, message: string): void {
    const record = this.records.get(id)
    if (!record) {
      return
    }

    record.currentActivity = message
    record.recentEvents.push(message)
    if (record.recentEvents.length > maxRecentEvents) {
      record.recentEvents.splice(
        0,
        record.recentEvents.length - maxRecentEvents,
      )
    }
  }

  async wait(
    id: string,
    timeoutMs: number,
  ): Promise<{
    status: RlmRunStatus
    record: RlmRunRecord
    done: boolean
  }> {
    const record = this.records.get(id)
    if (!record) {
      throw new Error(`Unknown run id: ${id}`)
    }

    if (record.status !== 'running') {
      return { status: record.status, record, done: true }
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        record.promise.then(() => undefined).catch(() => undefined),
        new Promise((resolve) => {
          timeoutHandle = setTimeout(resolve, timeoutMs)
        }),
      ])
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
    }

    return {
      status: record.status,
      record,
      done: record.status !== 'running',
    }
  }

  cancel(id: string): RlmRunRecord {
    const record = this.records.get(id)
    if (!record) {
      throw new Error(`Unknown run id: ${id}`)
    }

    if (record.status === 'running') {
      this.appendEvent(id, 'Cancellation requested')
      record.controller.abort()
    }

    return record
  }

  private prune() {
    const records = this.list()
    if (records.length <= maxRecords) {
      return
    }

    for (const record of records.slice(maxRecords)) {
      if (record.status === 'running') {
        continue
      }
      this.records.delete(record.id)
    }
  }
}

function createRunId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export const rlmRunStore = new RlmRunStore()
