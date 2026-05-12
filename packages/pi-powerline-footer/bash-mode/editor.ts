// biome-ignore-all lint/suspicious/noExplicitAny: Pi TUI/editor constructor receives dynamic runtime objects.
import { CustomEditor } from '@earendil-works/pi-coding-agent'
import type { AutocompleteProvider } from '@earendil-works/pi-tui'
import {
  CURSOR_MARKER,
  isKeyRelease,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from '@earendil-works/pi-tui'
import { matchesConfiguredShortcut } from '../shortcuts.ts'
import { getOneOffBashCommandContext } from './completion.ts'
import type { GhostSuggestion } from './types.ts'

interface EditorBoundaryShortcuts {
  start: string
  end: string
}

interface BashModeEditorOptions {
  keybindings: PiKeybindings
  isBashModeActive: () => boolean
  isShellRunning: () => boolean
  onExitBashMode: () => void
  onSubmitCommand: (command: string) => void
  onEditorSubmit?: () => void
  editorBoundaryShortcuts?: EditorBoundaryShortcuts
  onInterrupt: () => void
  onNotify: (message: string, level?: 'info' | 'warning' | 'error') => void
  getHistoryEntries: (prefix: string) => string[]
  resolveGhostSuggestion: (
    text: string,
    signal: AbortSignal,
  ) => Promise<GhostSuggestion | null>
}

const DEFAULT_EDITOR_BOUNDARY_SHORTCUTS: EditorBoundaryShortcuts = {
  start: 'super+shift+up',
  end: 'super+shift+down',
}

function isPrintableInput(data: string): boolean {
  return data.length === 1 && data.charCodeAt(0) >= 32
}

function matchesEditorBoundaryShortcut(
  data: string,
  shortcut: string,
): boolean {
  return matchesConfiguredShortcut(data, shortcut)
}

interface PiKeybindings {
  matches(data: string, id: string): boolean
}

interface EditorPosition {
  line: number
  col: number
}

interface EditorSelectionRange {
  start: EditorPosition
  end: EditorPosition
}

interface EditorStateRef {
  lines: string[]
  cursorLine: number
  cursorCol: number
}

interface VisualLineRef {
  logicalLine: number
  startCol: number
  length: number
}

interface LayoutLineRef {
  text: string
  hasCursor: boolean
  cursorPos?: number
}

function matchesKeybinding(
  keybindings: PiKeybindings,
  data: string,
  id: string,
): boolean {
  return keybindings.matches(data, id)
}

export class BashModeEditor extends CustomEditor {
  private readonly keybindingsRef: PiKeybindings
  private readonly optionsRef: BashModeEditorOptions
  private wrappedProviderInstalled = false
  private shellHistoryIndex = -1
  private shellHistoryItems: string[] = []
  private shellHistoryDraft = ''
  private ghost: GhostSuggestion | null = null
  private ghostAbort: AbortController | null = null
  private ghostToken = 0
  private wordSelectionAnchor: EditorPosition | null = null

  constructor(
    tui: any,
    theme: any,
    keybindings: PiKeybindings,
    options: BashModeEditorOptions,
  ) {
    super(tui, theme, keybindings as never)
    this.keybindingsRef = keybindings
    this.optionsRef = options
  }

  installAutocompleteProvider(provider: AutocompleteProvider): void {
    this.setAutocompleteProvider(provider)
    this.wrappedProviderInstalled = true
  }

  hasWrappedProvider(): boolean {
    return this.wrappedProviderInstalled
  }

  getGhostSuggestion(): GhostSuggestion | null {
    return this.isShellCompletionContext() ? this.ghost : null
  }

  refreshGhostSuggestion(): void {
    this.scheduleGhostUpdate()
  }

  clearGhostSuggestion(): void {
    this.ghostAbort?.abort()
    this.ghostAbort = null
    this.ghost = null
  }

  dismissBashModeUi(): void {
    this.shellHistoryIndex = -1
    this.shellHistoryItems = []
    this.shellHistoryDraft = ''
    this.clearGhostSuggestion()

    const cancelAutocomplete = Reflect.get(this, 'cancelAutocomplete')
    if (typeof cancelAutocomplete === 'function') {
      cancelAutocomplete.call(this)
    }
    this.tui.requestRender()
  }

  handleInput(data: string): void {
    const pasteInProgress =
      data.includes('\x1b[200~') || Reflect.get(this, 'isInPaste') === true
    const handleWordSelectionInput = Reflect.get(
      this,
      'handleWordSelectionInput',
    )
    if (
      !pasteInProgress &&
      typeof handleWordSelectionInput === 'function' &&
      handleWordSelectionInput.call(this, data)
    ) {
      return
    }

    const hasWordSelection = Reflect.get(this, 'hasWordSelection')
    const clearWordSelection = Reflect.get(this, 'clearWordSelection')
    if (
      !pasteInProgress &&
      typeof hasWordSelection === 'function' &&
      hasWordSelection.call(this) &&
      !isKeyRelease(data) &&
      this.isSelectionDeleteInput(data)
    ) {
      this.deleteSelection()
      return
    }

    const shouldClearSelection =
      typeof hasWordSelection === 'function' &&
      hasWordSelection.call(this) &&
      !pasteInProgress &&
      !isKeyRelease(data)
    if (shouldClearSelection && typeof clearWordSelection === 'function') {
      clearWordSelection.call(this)
    }

    if (pasteInProgress) {
      super.handleInput(data)
      if (Reflect.get(this, 'isInPaste') === true) {
        return
      }
    } else {
      const bashMode = this.optionsRef.isBashModeActive()
      const oneOffBashCommand = !bashMode && this.isOneOffBashCommandContext()

      if (
        bashMode &&
        matchesKeybinding(this.keybindingsRef, data, 'app.interrupt')
      ) {
        this.optionsRef.onExitBashMode()
        return
      }

      if (
        bashMode &&
        matchesKeybinding(this.keybindingsRef, data, 'app.clear') &&
        this.optionsRef.isShellRunning()
      ) {
        this.optionsRef.onInterrupt()
        return
      }

      if (
        bashMode &&
        matchesKeybinding(this.keybindingsRef, data, 'tui.editor.cursorUp')
      ) {
        this.navigateShellHistory(-1)
        return
      }

      if (
        bashMode &&
        matchesKeybinding(this.keybindingsRef, data, 'tui.editor.cursorDown')
      ) {
        this.navigateShellHistory(1)
        return
      }

      const editorBoundaryShortcuts =
        this.optionsRef.editorBoundaryShortcuts ??
        DEFAULT_EDITOR_BOUNDARY_SHORTCUTS
      if (
        !isKeyRelease(data) &&
        matchesEditorBoundaryShortcut(data, editorBoundaryShortcuts.start)
      ) {
        this.moveCursorToEditorBoundary('start')
        return
      }

      if (
        !isKeyRelease(data) &&
        matchesEditorBoundaryShortcut(data, editorBoundaryShortcuts.end)
      ) {
        this.moveCursorToEditorBoundary('end')
        return
      }

      if (
        (bashMode || oneOffBashCommand) &&
        matchesKeybinding(this.keybindingsRef, data, 'tui.input.tab')
      ) {
        this.acceptGhostSuggestion()
        return
      }

      if (
        (bashMode || oneOffBashCommand) &&
        matchesKeybinding(
          this.keybindingsRef,
          data,
          'tui.editor.cursorRight',
        ) &&
        this.acceptGhostSuggestion()
      ) {
        return
      }

      if (
        bashMode &&
        matchesKeybinding(this.keybindingsRef, data, 'tui.input.submit') &&
        !matchesKeybinding(this.keybindingsRef, data, 'tui.input.newLine')
      ) {
        if (this.optionsRef.isShellRunning()) {
          this.optionsRef.onNotify('Shell command already running', 'warning')
          return
        }

        const command = this.getExpandedText().trim()
        if (!command) return
        this.clearGhostSuggestion()
        this.shellHistoryIndex = -1
        this.shellHistoryItems = []
        this.shellHistoryDraft = ''
        this.optionsRef.onEditorSubmit?.()
        this.optionsRef.onSubmitCommand(command)
        this.setText('')
        this.refreshGhostSuggestion()
        return
      }

      super.handleInput(data)
    }

    if (!this.isShellCompletionContext()) {
      this.shellHistoryIndex = -1
      this.shellHistoryItems = []
      this.shellHistoryDraft = ''
      this.clearGhostSuggestion()
      return
    }

    if (
      pasteInProgress ||
      isPrintableInput(data) ||
      matchesKeybinding(
        this.keybindingsRef,
        data,
        'tui.editor.deleteCharBackward',
      ) ||
      matchesKeybinding(
        this.keybindingsRef,
        data,
        'tui.editor.deleteCharForward',
      ) ||
      matchesKeybinding(
        this.keybindingsRef,
        data,
        'tui.editor.deleteWordBackward',
      ) ||
      matchesKeybinding(
        this.keybindingsRef,
        data,
        'tui.editor.deleteWordForward',
      ) ||
      matchesKeybinding(
        this.keybindingsRef,
        data,
        'tui.editor.deleteToLineStart',
      ) ||
      matchesKeybinding(
        this.keybindingsRef,
        data,
        'tui.editor.deleteToLineEnd',
      ) ||
      matchesKeybinding(this.keybindingsRef, data, 'tui.input.newLine') ||
      matchesKeybinding(this.keybindingsRef, data, 'tui.editor.cursorLeft') ||
      matchesKeybinding(this.keybindingsRef, data, 'tui.editor.cursorRight')
    ) {
      this.shellHistoryIndex = -1
      this.shellHistoryItems = []
      this.shellHistoryDraft = ''
      this.scheduleGhostUpdate()
    }
  }

  render(width: number): string[] {
    const lines = super.render(width)
    this.renderWordSelection(lines, width)
    if (this.hasWordSelection()) return lines
    if (!this.isShellCompletionContext()) return lines
    if (!this.ghost) return lines

    const text = this.getText()
    if (text.includes('\n')) return lines
    const cursor = this.getCursor()
    if (cursor.line !== 0 || cursor.col !== text.length) return lines
    if (!this.ghost.value.startsWith(text) || this.ghost.value === text)
      return lines
    if (lines.length < 3) return lines

    const suffix = this.ghost.value.slice(text.length)
    const contentLine = 1
    const cursorBlock = '\x1b[7m \x1b[0m'
    const availableWidth = Math.max(0, width - visibleWidth(text) - 1)
    if (availableWidth === 0) return lines

    const shownSuffix = truncateToWidth(suffix, availableWidth, '', true)
    if (!shownSuffix) return lines

    const padding = ' '.repeat(
      Math.max(0, width - visibleWidth(text) - 1 - visibleWidth(shownSuffix)),
    )
    const ghost = `\x1b[38;5;244m${shownSuffix}\x1b[0m`
    lines[contentLine] = `${text}${cursorBlock}${ghost}${padding}`
    return lines
  }

  getSelectedText(): string | null {
    const range = this.getWordSelectionRange()
    const state = this.getEditorState()
    if (!range || !state) return null

    if (range.start.line === range.end.line) {
      const line = state.lines[range.start.line] ?? ''
      return line.slice(range.start.col, range.end.col)
    }

    const selected: string[] = []
    for (
      let lineIndex = range.start.line;
      lineIndex <= range.end.line;
      lineIndex++
    ) {
      const line = state.lines[lineIndex] ?? ''
      if (lineIndex === range.start.line) {
        selected.push(line.slice(range.start.col))
      } else if (lineIndex === range.end.line) {
        selected.push(line.slice(0, range.end.col))
      } else {
        selected.push(line)
      }
    }

    return selected.join('\n')
  }

  clearSelection(): void {
    this.clearWordSelection()
    this.tui.requestRender()
  }

  private isShellCompletionContext(): boolean {
    return (
      this.optionsRef.isBashModeActive() || this.isOneOffBashCommandContext()
    )
  }

  handleWordSelectionInput(data: string): boolean {
    const direction = this.getWordSelectionDirection(data)
    if (!direction) return false
    if (isKeyRelease(data)) return true

    const state = this.getEditorState()
    if (!state) return true

    if (!this.wordSelectionAnchor) {
      this.wordSelectionAnchor = {
        line: state.cursorLine,
        col: state.cursorCol,
      }
    }

    const mover = Reflect.get(
      this,
      direction === 'left' ? 'moveWordBackwards' : 'moveWordForwards',
    )
    if (typeof mover === 'function') {
      mover.call(this)
    }

    const nextState = this.getEditorState()
    if (
      nextState &&
      this.wordSelectionAnchor &&
      this.positionsEqual(this.wordSelectionAnchor, {
        line: nextState.cursorLine,
        col: nextState.cursorCol,
      })
    ) {
      this.wordSelectionAnchor = null
    }

    this.clearGhostSuggestion()
    this.tui.requestRender()
    return true
  }

  private getWordSelectionDirection(data: string): 'left' | 'right' | null {
    if (matchesKey(data, 'alt+shift+left' as never)) return 'left'
    if (matchesKey(data, 'shift+alt+left' as never)) return 'left'
    if (matchesKey(data, 'alt+shift+right' as never)) return 'right'
    if (matchesKey(data, 'shift+alt+right' as never)) return 'right'
    return null
  }

  private isSelectionDeleteInput(data: string): boolean {
    return (
      matchesKeybinding(
        this.keybindingsRef,
        data,
        'tui.editor.deleteCharBackward',
      ) || matchesKey(data, 'shift+backspace' as never)
    )
  }

  private deleteSelection(): void {
    const range = this.getWordSelectionRange()
    const state = this.getEditorState()
    if (!range || !state) return

    const cancelAutocomplete = Reflect.get(this, 'cancelAutocomplete')
    if (typeof cancelAutocomplete === 'function') {
      cancelAutocomplete.call(this)
    }

    const pushUndoSnapshot = Reflect.get(this, 'pushUndoSnapshot')
    if (typeof pushUndoSnapshot === 'function') {
      pushUndoSnapshot.call(this)
    }

    if (range.start.line === range.end.line) {
      const line = state.lines[range.start.line] ?? ''
      state.lines[range.start.line] =
        line.slice(0, range.start.col) + line.slice(range.end.col)
    } else {
      const firstLine = state.lines[range.start.line] ?? ''
      const lastLine = state.lines[range.end.line] ?? ''
      state.lines.splice(
        range.start.line,
        range.end.line - range.start.line + 1,
        firstLine.slice(0, range.start.col) + lastLine.slice(range.end.col),
      )
    }

    if (state.lines.length === 0) {
      state.lines.push('')
    }

    state.cursorLine = range.start.line
    const setCursorCol = Reflect.get(this, 'setCursorCol')
    if (typeof setCursorCol === 'function') {
      setCursorCol.call(this, range.start.col)
    } else {
      state.cursorCol = range.start.col
      Reflect.set(this, 'preferredVisualCol', null)
      Reflect.set(this, 'snappedFromCursorCol', null)
    }

    Reflect.set(this, 'historyIndex', -1)
    Reflect.set(this, 'lastAction', null)
    this.clearWordSelection()
    this.clearGhostSuggestion()

    const onChange = Reflect.get(this, 'onChange')
    if (typeof onChange === 'function') {
      onChange.call(this, this.getText())
    }

    if (this.isShellCompletionContext()) {
      this.shellHistoryIndex = -1
      this.shellHistoryItems = []
      this.shellHistoryDraft = ''
      this.scheduleGhostUpdate()
    }

    this.tui.requestRender()
  }

  private hasWordSelection(): boolean {
    return this.getWordSelectionRange() !== null
  }

  private clearWordSelection(): void {
    this.wordSelectionAnchor = null
  }

  private getEditorState(): EditorStateRef | null {
    const state = Reflect.get(this, 'state')
    if (!state || typeof state !== 'object') return null
    const lines = Reflect.get(state, 'lines')
    const cursorLine = Reflect.get(state, 'cursorLine')
    const cursorCol = Reflect.get(state, 'cursorCol')
    if (
      !Array.isArray(lines) ||
      typeof cursorLine !== 'number' ||
      typeof cursorCol !== 'number'
    ) {
      return null
    }

    return { lines, cursorLine, cursorCol }
  }

  private comparePositions(a: EditorPosition, b: EditorPosition): number {
    if (a.line !== b.line) return a.line - b.line
    return a.col - b.col
  }

  private positionsEqual(a: EditorPosition, b: EditorPosition): boolean {
    return a.line === b.line && a.col === b.col
  }

  private getWordSelectionRange(): EditorSelectionRange | null {
    const state = this.getEditorState()
    if (!state || !this.wordSelectionAnchor) return null

    const cursor = { line: state.cursorLine, col: state.cursorCol }
    if (this.positionsEqual(this.wordSelectionAnchor, cursor)) return null

    return this.comparePositions(this.wordSelectionAnchor, cursor) <= 0
      ? { start: this.wordSelectionAnchor, end: cursor }
      : { start: cursor, end: this.wordSelectionAnchor }
  }

  private renderWordSelection(lines: string[], width: number): void {
    const range = this.getWordSelectionRange()
    if (!range || lines.length < 3) return

    const layoutText = Reflect.get(this, 'layoutText')
    const buildVisualLineMap = Reflect.get(this, 'buildVisualLineMap')
    if (
      typeof layoutText !== 'function' ||
      typeof buildVisualLineMap !== 'function'
    ) {
      return
    }

    const maxPadding = Math.max(0, Math.floor((width - 1) / 2))
    const paddingX = Math.min(this.getPaddingX(), maxPadding)
    const contentWidth = Math.max(1, width - paddingX * 2)
    const layoutWidth = Math.max(1, contentWidth - (paddingX ? 0 : 1))
    const layoutLines = layoutText.call(this, layoutWidth) as LayoutLineRef[]
    const visualLines = buildVisualLineMap.call(
      this,
      layoutWidth,
    ) as VisualLineRef[]
    const scrollOffset = Reflect.get(this, 'scrollOffset')
    const startOffset = typeof scrollOffset === 'number' ? scrollOffset : 0
    const terminalRows = this.tui?.terminal?.rows ?? 24
    const maxVisibleLines = Math.max(5, Math.floor(terminalRows * 0.3))
    const visibleCount = Math.min(
      layoutLines.length - startOffset,
      maxVisibleLines,
      lines.length - 2,
    )
    const leftPadding = ' '.repeat(paddingX)
    const rightPadding = leftPadding
    const autocompleteActive = Reflect.get(this, 'autocompleteState') !== null
    const emitCursorMarker = this.focused && !autocompleteActive

    for (let i = 0; i < visibleCount; i++) {
      const layoutLine = layoutLines[startOffset + i]
      const visualLine = visualLines[startOffset + i]
      if (!layoutLine || !visualLine) continue

      const lineSelection = this.getLineSelectionRange(range, visualLine)
      if (!lineSelection) continue

      const cursorPos = layoutLine.hasCursor ? layoutLine.cursorPos : undefined
      const { text, cursorInPadding } = this.renderSelectedLayoutText(
        layoutLine.text,
        lineSelection.start,
        lineSelection.end,
        cursorPos,
        emitCursorMarker,
        contentWidth,
        paddingX,
      )
      const lineVisibleWidth =
        visibleWidth(layoutLine.text) +
        (cursorPos === layoutLine.text.length ? 1 : 0)
      const padding = ' '.repeat(Math.max(0, contentWidth - lineVisibleWidth))
      const lineRightPadding = cursorInPadding
        ? rightPadding.slice(1)
        : rightPadding
      lines[1 + i] = `${leftPadding}${text}${padding}${lineRightPadding}`
    }
  }

  private getLineSelectionRange(
    range: EditorSelectionRange,
    visualLine: VisualLineRef,
  ): { start: number; end: number } | null {
    const line = visualLine.logicalLine
    if (line < range.start.line || line > range.end.line) return null

    const visualStart = visualLine.startCol
    const visualEnd = visualLine.startCol + visualLine.length
    const selectionStart = line === range.start.line ? range.start.col : 0
    const lineText = this.getEditorState()?.lines[line] ?? ''
    const selectionEnd =
      line === range.end.line ? range.end.col : lineText.length
    const start = Math.max(visualStart, selectionStart)
    const end = Math.min(visualEnd, selectionEnd)
    if (start >= end) return null

    return { start: start - visualStart, end: end - visualStart }
  }

  private renderSelectedLayoutText(
    text: string,
    selectionStart: number,
    selectionEnd: number,
    cursorPos: number | undefined,
    emitCursorMarker: boolean,
    contentWidth: number,
    paddingX: number,
  ): { text: string; cursorInPadding: boolean } {
    const segment = Reflect.get(this, 'segment')
    const segments =
      typeof segment === 'function'
        ? ([...segment.call(this, text)] as Intl.SegmentData[])
        : [...new Intl.Segmenter().segment(text)]
    let rendered = ''
    let selectionOpen = false

    const openSelection = () => {
      if (!selectionOpen) {
        rendered += '\x1b[7m'
        selectionOpen = true
      }
    }
    const closeSelection = () => {
      if (selectionOpen) {
        rendered += '\x1b[0m'
        selectionOpen = false
      }
    }

    for (const item of segments) {
      const start = item.index
      const value = item.segment
      const end = start + value.length
      const selected = start < selectionEnd && end > selectionStart
      const cursorHere = cursorPos === start

      if (cursorHere && emitCursorMarker) {
        rendered += CURSOR_MARKER
      }

      if (selected) {
        openSelection()
        rendered += value
      } else {
        closeSelection()
        if (cursorHere) {
          rendered += `\x1b[7m${value}\x1b[0m`
        } else {
          rendered += value
        }
      }
    }

    closeSelection()

    let cursorInPadding = false
    if (cursorPos === text.length) {
      if (emitCursorMarker) rendered += CURSOR_MARKER
      rendered += '\x1b[7m \x1b[0m'
      cursorInPadding = visibleWidth(text) + 1 > contentWidth && paddingX > 0
    }

    return { text: rendered, cursorInPadding }
  }

  private isOneOffBashCommandContext(): boolean {
    return getOneOffBashCommandContext(this.getExpandedText()) !== null
  }

  private moveCursorToEditorBoundary(position: 'start' | 'end'): void {
    const state = Reflect.get(this, 'state')
    const lines =
      state && typeof state === 'object' ? Reflect.get(state, 'lines') : null
    if (!Array.isArray(lines)) {
      throw new Error('Editor cursor state is unavailable')
    }

    if (position === 'start') {
      Reflect.set(state, 'cursorLine', 0)
      Reflect.set(state, 'cursorCol', 0)
    } else {
      const lastLine = Math.max(0, lines.length - 1)
      Reflect.set(state, 'cursorLine', lastLine)
      Reflect.set(
        state,
        'cursorCol',
        typeof lines[lastLine] === 'string' ? lines[lastLine].length : 0,
      )
    }

    Reflect.set(this, 'lastAction', null)
    Reflect.set(this, 'preferredVisualCol', null)
    Reflect.set(this, 'snappedFromCursorCol', null)
    this.tui.requestRender()
  }

  private acceptGhostSuggestion(): boolean {
    if (!this.ghost) return false
    const text = this.getExpandedText()
    if (text.includes('\n')) return false

    const cursor = this.getCursor()
    if (cursor.line !== 0 || cursor.col !== text.length) return false

    if (!this.ghost.value.startsWith(text) || this.ghost.value === text)
      return false
    this.setText(this.ghost.value)
    this.clearGhostSuggestion()
    return true
  }

  private navigateShellHistory(direction: -1 | 1): void {
    const prefix = this.shellHistoryDraft || this.getExpandedText()
    if (this.shellHistoryIndex === -1) {
      this.shellHistoryDraft = prefix
      this.shellHistoryItems = this.optionsRef.getHistoryEntries(prefix)
    }

    if (this.shellHistoryItems.length === 0) {
      this.optionsRef.onNotify('No shell history matches', 'info')
      return
    }

    if (direction < 0) {
      this.shellHistoryIndex = Math.min(
        this.shellHistoryItems.length - 1,
        this.shellHistoryIndex + 1,
      )
      this.setText(
        this.shellHistoryItems[this.shellHistoryIndex] ??
          this.shellHistoryDraft,
      )
      this.clearGhostSuggestion()
      return
    }

    this.shellHistoryIndex -= 1
    if (this.shellHistoryIndex < 0) {
      this.shellHistoryIndex = -1
      this.setText(this.shellHistoryDraft)
      this.scheduleGhostUpdate()
      return
    }

    this.setText(
      this.shellHistoryItems[this.shellHistoryIndex] ?? this.shellHistoryDraft,
    )
    this.clearGhostSuggestion()
  }

  private scheduleGhostUpdate(): void {
    const text = this.getExpandedText()
    const currentToken = ++this.ghostToken
    this.ghostAbort?.abort()

    const controller = new AbortController()
    this.ghostAbort = controller
    this.optionsRef
      .resolveGhostSuggestion(text, controller.signal)
      .then((ghost) => {
        if (controller.signal.aborted || currentToken !== this.ghostToken)
          return
        this.ghost = ghost
        this.tui.requestRender()
      })
      .catch((error) => {
        if (error instanceof Error && error.message === 'aborted') return
        console.debug(
          '[powerline-footer] Failed to resolve bash ghost suggestion:',
          error,
        )
      })
  }
}
