import type { RlmNode } from './types'

export function plannerDescription(): string {
  return [
    'You are a recursion controller for a recursive language model run.',
    'Decide whether the task should be solved directly or decomposed into subtasks.',
    'Prefer solve for atomic or tightly scoped work.',
    'Prefer decompose only when decomposition is clearly beneficial.',
    'If you choose decompose, return clear, non-overlapping subtasks.',
    'Do not invent extra work just to decompose.',
    'You may receive workspace context. Use it to ground your decision.',
    'Do not claim you lack repository access if workspace context is present.',
  ].join('\n')
}

export function solverDescription(): string {
  return [
    'You are a worker node in a recursive language model run.',
    'Solve the task directly and return a concrete, useful answer.',
    'Be concise but complete.',
    'If the task is underspecified, make the best reasonable attempt and call out uncertainty.',
    'You may receive workspace context. Use it as evidence and cite concrete files or directories when possible.',
    'Do not say you cannot inspect the repository when workspace context is already provided.',
  ].join('\n')
}

export function synthesisDescription(): string {
  return [
    'You are the synthesizer node in a recursive language model run.',
    'Combine child outputs into one final response to the parent task.',
    'Use completed child outputs as evidence.',
    'If some children failed, produce a best-effort synthesis and explicitly call out the gaps.',
    'Do not pretend failed or cancelled child work succeeded.',
    'When workspace context is provided, use it to validate or sharpen the synthesis.',
  ].join('\n')
}

export function formatChildOutputs(children: RlmNode[]): string {
  return children
    .map((child, index) => {
      const result = child.result ?? child.error ?? '(no output)'
      return [
        `Child ${index + 1}`,
        `Status: ${child.status}`,
        `Task: ${child.task}`,
        'Output:',
        result,
      ].join('\n')
    })
    .join('\n\n')
}
