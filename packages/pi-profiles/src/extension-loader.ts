import { createJiti } from '@mariozechner/jiti'
import type {
  ExtensionAPI,
  ExtensionFactory,
} from '@mariozechner/pi-coding-agent'

async function importExtensionFactory(
  extensionPath: string,
): Promise<ExtensionFactory | undefined> {
  const jiti = createJiti(import.meta.url, {
    moduleCache: false,
  })

  const module = await jiti.import(extensionPath, { default: true })
  return typeof module === 'function' ? (module as ExtensionFactory) : undefined
}

export async function loadProfileExtensionsIntoPi(
  pi: ExtensionAPI,
  extensionPaths: string[],
  alreadyLoaded: Set<string>,
): Promise<string[]> {
  const loadedNow: string[] = []

  for (const extensionPath of extensionPaths) {
    if (alreadyLoaded.has(extensionPath)) {
      continue
    }

    const factory = await importExtensionFactory(extensionPath)

    if (!factory) {
      throw new Error(
        `Profile extension does not export a valid factory function: ${extensionPath}`,
      )
    }

    await factory(pi)
    alreadyLoaded.add(extensionPath)
    loadedNow.push(extensionPath)
  }

  return loadedNow
}
