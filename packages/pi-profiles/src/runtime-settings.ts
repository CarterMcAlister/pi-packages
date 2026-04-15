import type {
  ExtensionAPI,
  ExtensionContext,
} from '@mariozechner/pi-coding-agent'
import type { LoadedProfile } from './types'

function notifyOnce(
  notifications: Set<string>,
  ctx: ExtensionContext,
  message: string,
  level: 'info' | 'warning' | 'error' = 'warning',
): void {
  if (notifications.has(message)) {
    return
  }

  notifications.add(message)
  ctx.ui.notify(message, level)
}

export async function applyProfileRuntimeSettings(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  profile: LoadedProfile | null,
  notifications: Set<string>,
): Promise<void> {
  if (!profile) {
    ctx.ui.setStatus('profile', undefined)
    return
  }

  ctx.ui.setStatus('profile', `profile:${profile.ref.name}`)

  const { settings } = profile

  if (settings.theme && ctx.hasUI) {
    const result = ctx.ui.setTheme(settings.theme)

    if (!result.success && result.error) {
      notifyOnce(
        notifications,
        ctx,
        `Profile "${profile.ref.name}": ${result.error}`,
      )
    }
  }

  if (settings.defaultThinkingLevel) {
    pi.setThinkingLevel(settings.defaultThinkingLevel)
  }

  if (settings.defaultProvider && settings.defaultModel) {
    const model = ctx.modelRegistry.find(
      settings.defaultProvider,
      settings.defaultModel,
    )

    if (!model) {
      notifyOnce(
        notifications,
        ctx,
        `Profile "${profile.ref.name}": model ${settings.defaultProvider}/${settings.defaultModel} was not found.`,
      )
      return
    }

    const success = await pi.setModel(model)

    if (!success) {
      notifyOnce(
        notifications,
        ctx,
        `Profile "${profile.ref.name}": no credentials are available for ${settings.defaultProvider}/${settings.defaultModel}.`,
      )
    }

    return
  }

  if (settings.defaultModel && !settings.defaultProvider) {
    notifyOnce(
      notifications,
      ctx,
      `Profile "${profile.ref.name}": defaultModel requires defaultProvider to be set too.`,
    )
  }
}
