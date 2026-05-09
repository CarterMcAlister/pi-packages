import type { AutocompleteItem } from '@earendil-works/pi-tui'

type CommandMap = Record<string, unknown>

function toItem(command: string): AutocompleteItem {
  return {
    value: command,
    label: command,
  }
}

export function createCompletionFactory(
  commands: CommandMap,
): (argumentPrefix: string) => AutocompleteItem[] | null {
  const commandNames = Object.keys(commands).sort()

  return (argumentPrefix: string) => {
    const prefix = argumentPrefix.trimStart()

    if (prefix.includes(' ')) {
      return null
    }

    if (!prefix) {
      return commandNames.map(toItem)
    }

    return commandNames
      .filter((command) => command.startsWith(prefix))
      .map(toItem)
  }
}
