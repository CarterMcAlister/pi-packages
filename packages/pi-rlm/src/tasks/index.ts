import type { AxTaskDefinition } from '../types'
import incidentReviewTask from './incident-review'
import rfcQualityCheckTask from './rfc-quality-check'

const bundledTasks: readonly AxTaskDefinition[] = [
  incidentReviewTask,
  rfcQualityCheckTask,
]

export default bundledTasks
