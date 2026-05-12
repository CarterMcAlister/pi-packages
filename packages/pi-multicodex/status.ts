import type { Api, Model } from '@earendil-works/pi-ai'
import type {
  ExtensionCommandContext,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import { getSettingsListTheme } from '@earendil-works/pi-coding-agent'
import {
  Container,
  type SettingItem,
  SettingsList,
  Text,
} from '@earendil-works/pi-tui'
import {
  getAgentSettingsPath,
  readJsonObjectFileAsync,
  writeJsonObjectFileAsync,
} from 'pi-provider-utils/agent-paths'
import type { AccountManager } from './account-manager'
import { PROVIDER_ID } from './provider'
import type { CodexUsageSnapshot } from './usage'

const STATUS_KEY = 'multicodex-usage'
const SETTINGS_KEY = 'pi-multicodex'
const SETTINGS_FILE = getAgentSettingsPath()
const REFRESH_INTERVAL_MS = 60_000
const MODEL_SELECT_REFRESH_DEBOUNCE_MS = 250
const UNKNOWN_PERCENT = '--'
const BRAND_LABEL = 'Codex'
const SEGMENT_SEPARATOR = '·'
const FIVE_HOUR_LABEL = '5h:'
const SEVEN_DAY_LABEL = '7d:'

type MaybeModel = Model<Api> | undefined
export type PercentDisplayMode = 'left' | 'used'
export type ResetWindowMode = '5h' | '7d' | 'both'
export type StatusOrder = 'account-first' | 'usage-first'
export type FooterItemId = 'brand' | 'account' | '5h' | '7d'

const FOOTER_ITEM_IDS: readonly FooterItemId[] = [
  'brand',
  'account',
  '5h',
  '7d',
]

export interface FooterPreferences {
  usageMode: PercentDisplayMode
  resetWindow: ResetWindowMode
  showAccount: boolean
  showReset: boolean
  order: StatusOrder
  footerItems: FooterItemId[]
}

const DEFAULT_PREFERENCES: FooterPreferences = {
  usageMode: 'left',
  resetWindow: '7d',
  showAccount: true,
  showReset: true,
  order: 'account-first',
  footerItems: [...FOOTER_ITEM_IDS],
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function isPercentDisplayMode(value: unknown): value is PercentDisplayMode {
  return value === 'left' || value === 'used'
}

function isResetWindowMode(value: unknown): value is ResetWindowMode {
  return value === '5h' || value === '7d' || value === 'both'
}

function isStatusOrder(value: unknown): value is StatusOrder {
  return value === 'account-first' || value === 'usage-first'
}

function isFooterItemId(value: unknown): value is FooterItemId {
  return (FOOTER_ITEM_IDS as readonly unknown[]).includes(value)
}

function normalizeFooterItems(
  value: unknown,
  legacyShowAccount: boolean,
): FooterItemId[] {
  if (!Array.isArray(value)) {
    return DEFAULT_PREFERENCES.footerItems.filter(
      (item) => legacyShowAccount || item !== 'account',
    )
  }

  const items: FooterItemId[] = []
  for (const item of value) {
    if (isFooterItemId(item) && !items.includes(item)) {
      items.push(item)
    }
  }

  return items
}

function hasFooterItem(
  preferences: FooterPreferences,
  item: FooterItemId,
): boolean {
  return preferences.footerItems.includes(item)
}

function setFooterItem(
  preferences: FooterPreferences,
  item: FooterItemId,
  enabled: boolean,
): FooterPreferences {
  const footerItems = enabled
    ? [...preferences.footerItems, item]
    : preferences.footerItems.filter((existing) => existing !== item)
  const deduped = FOOTER_ITEM_IDS.filter((candidate) =>
    footerItems.includes(candidate),
  )

  return {
    ...preferences,
    showAccount: item === 'account' ? enabled : preferences.showAccount,
    footerItems: deduped,
  }
}

function normalizePreferences(value: unknown): FooterPreferences {
  const record = asObject(value)
  const legacyShowAccount =
    typeof record?.showAccount === 'boolean'
      ? record.showAccount
      : DEFAULT_PREFERENCES.showAccount
  const footerItems = normalizeFooterItems(
    record?.footerItems,
    legacyShowAccount,
  )

  return {
    usageMode: isPercentDisplayMode(record?.usageMode)
      ? record.usageMode
      : DEFAULT_PREFERENCES.usageMode,
    resetWindow: isResetWindowMode(record?.resetWindow)
      ? record.resetWindow
      : DEFAULT_PREFERENCES.resetWindow,
    showAccount: footerItems.includes('account'),
    showReset:
      typeof record?.showReset === 'boolean'
        ? record.showReset
        : DEFAULT_PREFERENCES.showReset,
    order: isStatusOrder(record?.order)
      ? record.order
      : DEFAULT_PREFERENCES.order,
    footerItems,
  }
}

async function readSettingsFile(): Promise<Record<string, unknown>> {
  return readJsonObjectFileAsync(SETTINGS_FILE)
}

async function writeSettingsFile(
  settings: Record<string, unknown>,
): Promise<void> {
  await writeJsonObjectFileAsync(SETTINGS_FILE, settings)
}

export async function loadFooterPreferences(): Promise<FooterPreferences> {
  const settings = await readSettingsFile()
  return normalizePreferences(settings[SETTINGS_KEY])
}

export async function persistFooterPreferences(
  preferences: FooterPreferences,
): Promise<void> {
  const settings = await readSettingsFile()
  settings[SETTINGS_KEY] = {
    ...asObject(settings[SETTINGS_KEY]),
    ...preferences,
  }
  await writeSettingsFile(settings)
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value))
}

function usedToDisplayPercent(
  value: number | undefined,
  mode: PercentDisplayMode,
): number | undefined {
  if (typeof value !== 'number' || Number.isNaN(value)) return undefined
  const left = clampPercent(100 - value)
  return mode === 'left' ? left : clampPercent(100 - left)
}

function formatBrand(ctx: ExtensionContext): string {
  return ctx.ui.theme.fg('muted', BRAND_LABEL)
}

function formatLoading(ctx: ExtensionContext): string {
  return ctx.ui.theme.fg('muted', 'loading...')
}

function formatSeparator(ctx: ExtensionContext): string {
  return ctx.ui.theme.fg('muted', SEGMENT_SEPARATOR)
}

function getUsageSeverityToken(
  displayPercent: number | undefined,
  mode: PercentDisplayMode,
): 'success' | 'thinkingMedium' | 'warning' | 'error' | 'dim' {
  if (typeof displayPercent !== 'number' || Number.isNaN(displayPercent)) {
    return 'dim'
  }

  if (mode === 'left') {
    if (displayPercent <= 10) return 'error'
    if (displayPercent <= 25) return 'warning'
    if (displayPercent <= 50) return 'thinkingMedium'
    return 'success'
  }

  if (displayPercent >= 90) return 'error'
  if (displayPercent >= 75) return 'warning'
  if (displayPercent >= 50) return 'thinkingMedium'
  return 'success'
}

function formatPercent(
  displayPercent: number | undefined,
  mode: PercentDisplayMode,
): string {
  if (typeof displayPercent !== 'number' || Number.isNaN(displayPercent)) {
    return UNKNOWN_PERCENT
  }

  return `${Math.round(clampPercent(displayPercent))}% ${mode}`
}

function formatResetCountdown(resetAt: number | undefined): string | undefined {
  if (typeof resetAt !== 'number' || Number.isNaN(resetAt)) return undefined
  const totalSeconds = Math.max(0, Math.round((resetAt - Date.now()) / 1000))
  const days = Math.floor(totalSeconds / 86_400)
  const hours = Math.floor((totalSeconds % 86_400) / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  if (days > 0) return `${days}d${hours}h`
  if (hours > 0) return `${hours}h${minutes}m`
  if (minutes > 0) return `${minutes}m`
  return `${seconds}s`
}

function shouldShowReset(
  preferences: FooterPreferences,
  window: Exclude<ResetWindowMode, 'both'>,
): boolean {
  if (!preferences.showReset) return false
  return (
    preferences.resetWindow === 'both' || preferences.resetWindow === window
  )
}

function formatUsageSegment(
  ctx: ExtensionContext,
  label: string,
  usedPercent: number | undefined,
  resetAt: number | undefined,
  showReset: boolean,
  preferences: FooterPreferences,
): string | undefined {
  const displayPercent = usedToDisplayPercent(
    usedPercent,
    preferences.usageMode,
  )
  const severity = getUsageSeverityToken(displayPercent, preferences.usageMode)
  if (severity === 'success') return undefined

  const parts = [
    `${label}${formatPercent(displayPercent, preferences.usageMode)}`,
  ]
  if (showReset) {
    const countdown = formatResetCountdown(resetAt)
    if (countdown) {
      parts.push(`(↺${countdown})`)
    }
  }
  return ctx.ui.theme.fg(severity, parts.join(' '))
}

export function isManagedModel(model: MaybeModel): boolean {
  return model?.provider === PROVIDER_ID
}

export function formatActiveAccountStatus(
  ctx: ExtensionContext,
  accountEmail: string,
  usage: CodexUsageSnapshot | undefined,
  preferences: FooterPreferences,
): string {
  const brandText = hasFooterItem(preferences, 'brand')
    ? formatBrand(ctx)
    : undefined
  const accountText = hasFooterItem(preferences, 'account')
    ? ctx.ui.theme.fg('text', accountEmail)
    : undefined
  const showFiveHour = hasFooterItem(preferences, '5h')
  const showSevenDay = hasFooterItem(preferences, '7d')

  if (!usage) {
    const loadingText =
      showFiveHour || showSevenDay ? formatLoading(ctx) : undefined
    return [brandText, accountText, loadingText].filter(Boolean).join(' ')
  }

  const fiveHour = showFiveHour
    ? formatUsageSegment(
        ctx,
        FIVE_HOUR_LABEL,
        usage.primary?.usedPercent,
        usage.primary?.resetAt,
        shouldShowReset(preferences, '5h'),
        preferences,
      )
    : undefined
  const sevenDay = showSevenDay
    ? formatUsageSegment(
        ctx,
        SEVEN_DAY_LABEL,
        usage.secondary?.usedPercent,
        usage.secondary?.resetAt,
        shouldShowReset(preferences, '7d'),
        preferences,
      )
    : undefined

  const usageSegments = [fiveHour, sevenDay].filter(Boolean)
  const usageText = usageSegments.join(` ${formatSeparator(ctx)} `)
  const leading =
    preferences.order === 'account-first'
      ? [brandText, accountText, usageText]
      : [brandText, usageText]
  const trailing =
    preferences.order === 'account-first' ? [] : [accountText].filter(Boolean)

  return [...leading, ...trailing]
    .filter(Boolean)
    .join(` ${formatSeparator(ctx)} `)
}

function getBooleanLabel(value: boolean): string {
  return value ? 'on' : 'off'
}

function getFooterItemLabel(
  preferences: FooterPreferences,
  item: FooterItemId,
): string {
  return getBooleanLabel(hasFooterItem(preferences, item))
}

function createSettingsItems(preferences: FooterPreferences): SettingItem[] {
  return [
    {
      id: 'usageMode',
      label: 'Usage display',
      description: 'Show remaining or consumed quota percentages',
      currentValue: preferences.usageMode,
      values: ['left', 'used'],
    },
    {
      id: 'resetWindow',
      label: 'Reset countdown window',
      description:
        'Choose whether the footer shows the 5h countdown, the 7d countdown, or both',
      currentValue: preferences.resetWindow,
      values: ['5h', '7d', 'both'],
    },
    {
      id: 'showBrand',
      label: 'Show brand',
      description: 'Display the Codex brand label in the footer',
      currentValue: getFooterItemLabel(preferences, 'brand'),
      values: ['on', 'off'],
    },
    {
      id: 'showAccount',
      label: 'Show account',
      description: 'Display the active account identifier in the footer',
      currentValue: getFooterItemLabel(preferences, 'account'),
      values: ['on', 'off'],
    },
    {
      id: 'showFiveHourUsage',
      label: 'Show 5h usage',
      description: 'Display the 5-hour quota percentage in the footer',
      currentValue: getFooterItemLabel(preferences, '5h'),
      values: ['on', 'off'],
    },
    {
      id: 'showSevenDayUsage',
      label: 'Show 7d usage',
      description: 'Display the 7-day quota percentage in the footer',
      currentValue: getFooterItemLabel(preferences, '7d'),
      values: ['on', 'off'],
    },
    {
      id: 'showReset',
      label: 'Show reset countdown',
      description:
        'Display a reset countdown like the codex usage footer extension',
      currentValue: getBooleanLabel(preferences.showReset),
      values: ['on', 'off'],
    },
    {
      id: 'order',
      label: 'Footer order',
      description:
        'Choose whether the account appears before or after usage fields',
      currentValue: preferences.order,
      values: ['account-first', 'usage-first'],
    },
  ]
}

function applyPreferenceChange(
  preferences: FooterPreferences,
  id: string,
  newValue: string,
): FooterPreferences {
  if (id === 'usageMode' && isPercentDisplayMode(newValue)) {
    return { ...preferences, usageMode: newValue }
  }
  if (id === 'resetWindow' && isResetWindowMode(newValue)) {
    return { ...preferences, resetWindow: newValue }
  }
  if (id === 'showBrand') {
    return setFooterItem(preferences, 'brand', newValue === 'on')
  }
  if (id === 'showAccount') {
    return setFooterItem(preferences, 'account', newValue === 'on')
  }
  if (id === 'showFiveHourUsage') {
    return setFooterItem(preferences, '5h', newValue === 'on')
  }
  if (id === 'showSevenDayUsage') {
    return setFooterItem(preferences, '7d', newValue === 'on')
  }
  if (id === 'showReset') {
    return { ...preferences, showReset: newValue === 'on' }
  }
  if (id === 'order' && isStatusOrder(newValue)) {
    return { ...preferences, order: newValue }
  }
  return preferences
}

export function createUsageStatusController(accountManager: AccountManager) {
  let refreshTimer: ReturnType<typeof setInterval> | undefined
  let modelSelectTimer: ReturnType<typeof setTimeout> | undefined
  let activeContext: ExtensionContext | undefined
  let refreshInFlight = false
  let queuedRefresh = false
  let preferences: FooterPreferences = DEFAULT_PREFERENCES
  let livePreviewPreferences: FooterPreferences | undefined

  accountManager.onStateChange(() => {
    if (!activeContext) return
    renderCachedStatus(activeContext, livePreviewPreferences ?? preferences)
  })

  function clearStatus(ctx?: ExtensionContext): void {
    ctx?.ui.setStatus(STATUS_KEY, undefined)
  }

  async function ensurePreferencesLoaded(): Promise<void> {
    preferences = await loadFooterPreferences()
  }

  function getStatusText(
    ctx: ExtensionContext,
    preferencesOverride?: FooterPreferences,
  ): string | undefined {
    if (!ctx.hasUI) return undefined
    if (!isManagedModel(ctx.model)) return undefined

    const activeAccount = accountManager.getActiveAccount()
    if (!activeAccount) {
      return ctx.ui.theme.fg('warning', 'Multicodex no active account')
    }

    return formatActiveAccountStatus(
      ctx,
      activeAccount.email,
      accountManager.getCachedUsage(activeAccount.email),
      preferencesOverride ?? preferences,
    )
  }

  function renderCachedStatus(
    ctx: ExtensionContext,
    preferencesOverride?: FooterPreferences,
  ): void {
    if (!ctx.hasUI) return
    if (!isManagedModel(ctx.model)) {
      clearStatus(ctx)
      return
    }

    const text = getStatusText(ctx, preferencesOverride)
    ctx.ui.setStatus(STATUS_KEY, text || undefined)
  }

  async function updateStatus(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI) return
    if (!isManagedModel(ctx.model)) {
      clearStatus(ctx)
      return
    }

    renderCachedStatus(ctx, livePreviewPreferences ?? preferences)

    const activeAccount = accountManager.getActiveAccount()
    if (!activeAccount) {
      ctx.ui.setStatus(
        STATUS_KEY,
        ctx.ui.theme.fg('warning', 'Multicodex no active account'),
      )
      return
    }

    const cachedUsage = accountManager.getCachedUsage(activeAccount.email)
    const usage =
      (await accountManager.refreshUsageForAccount(activeAccount)) ??
      cachedUsage
    const text = formatActiveAccountStatus(
      ctx,
      activeAccount.email,
      usage,
      livePreviewPreferences ?? preferences,
    )
    ctx.ui.setStatus(STATUS_KEY, text || undefined)
  }

  async function refreshFor(ctx: ExtensionContext): Promise<void> {
    activeContext = ctx
    if (refreshInFlight) {
      queuedRefresh = true
      return
    }

    refreshInFlight = true
    try {
      await updateStatus(ctx)
    } finally {
      refreshInFlight = false
      if (queuedRefresh && activeContext) {
        queuedRefresh = false
        await refreshFor(activeContext)
      }
    }
  }

  function scheduleModelSelectRefresh(ctx: ExtensionContext): void {
    activeContext = ctx
    renderCachedStatus(ctx, livePreviewPreferences ?? preferences)
    if (modelSelectTimer) {
      clearTimeout(modelSelectTimer)
    }
    modelSelectTimer = setTimeout(() => {
      modelSelectTimer = undefined
      void refreshFor(ctx)
    }, MODEL_SELECT_REFRESH_DEBOUNCE_MS)
    modelSelectTimer.unref?.()
  }

  function startAutoRefresh(): void {
    if (refreshTimer) clearInterval(refreshTimer)
    refreshTimer = setInterval(() => {
      if (!activeContext) return
      void refreshFor(activeContext)
    }, REFRESH_INTERVAL_MS)
    refreshTimer.unref?.()
  }

  function stopAutoRefresh(ctx?: ExtensionContext): void {
    if (refreshTimer) {
      clearInterval(refreshTimer)
      refreshTimer = undefined
    }
    if (modelSelectTimer) {
      clearTimeout(modelSelectTimer)
      modelSelectTimer = undefined
    }
    livePreviewPreferences = undefined
    clearStatus(ctx ?? activeContext)
    activeContext = undefined
    queuedRefresh = false
  }

  async function loadPreferences(ctx?: ExtensionContext): Promise<void> {
    try {
      await ensurePreferencesLoaded()
    } catch (error) {
      preferences = DEFAULT_PREFERENCES
      ctx?.ui.notify(
        `Multicodex: failed to load ${SETTINGS_FILE}: ${String(error)}`,
        'warning',
      )
    }
  }

  function renderPreviewLabel(
    ctx: ExtensionContext,
    theme: ExtensionCommandContext['ui']['theme'],
    draft: FooterPreferences,
  ): string {
    const previewText = getStatusText(ctx, draft)
    return `${theme.fg('dim', 'Preview')}: ${previewText || theme.fg('dim', 'hidden')}`
  }

  async function openPreferencesPanel(
    ctx: ExtensionCommandContext,
  ): Promise<void> {
    await loadPreferences(ctx)
    let draft = preferences
    livePreviewPreferences = draft
    renderCachedStatus(ctx, livePreviewPreferences)

    await ctx.ui.custom((_tui, theme, _kb, done) => {
      const container = new Container()
      container.addChild(
        new Text(theme.fg('accent', theme.bold('MultiCodex Footer')), 1, 0),
      )
      container.addChild(
        new Text(
          theme.fg(
            'dim',
            'Configure the usage footer to match the codex usage extension style.',
          ),
          1,
          0,
        ),
      )
      const previewText = new Text(renderPreviewLabel(ctx, theme, draft), 1, 0)
      container.addChild(previewText)

      const settingsList = new SettingsList(
        createSettingsItems(draft),
        9,
        getSettingsListTheme(),
        (id: string, newValue: string) => {
          draft = applyPreferenceChange(draft, id, newValue)
          livePreviewPreferences = draft
          settingsList.updateValue(id, newValue)
          previewText.setText(renderPreviewLabel(ctx, theme, draft))
          container.invalidate()
          renderCachedStatus(ctx, draft)
        },
        () => done(undefined),
        { enableSearch: true },
      )
      container.addChild(settingsList)

      return {
        render: (width: number) => container.render(width),
        invalidate: () => container.invalidate(),
        handleInput: (data: string) => settingsList.handleInput(data),
      }
    })

    preferences = draft
    livePreviewPreferences = undefined
    await persistFooterPreferences(preferences)
    await refreshFor(ctx)
  }

  return {
    loadPreferences,
    openPreferencesPanel,
    refreshFor,
    scheduleModelSelectRefresh,
    startAutoRefresh,
    stopAutoRefresh,
    getPreferences: () => preferences,
  }
}
