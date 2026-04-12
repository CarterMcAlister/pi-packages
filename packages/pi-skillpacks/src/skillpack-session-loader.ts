import type { Stats } from 'node:fs';
import { stat } from 'node:fs/promises';
import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from '@mariozechner/pi-coding-agent';
import {
  type AutocompleteItem,
  type Component,
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from '@mariozechner/pi-tui';
import {
  countActiveSkillsForItem,
  getDescendantSkills,
  getSkillpackBrowserStatus,
  getVisibleSkillpackBrowserItems,
  loadSkillpackBrowserItems,
  type SkillpackBrowserItem,
  type SkillpackBrowserStatus,
} from './browser';
import { getAddCompletions, getRemoveCompletions } from './completions';
import {
  ADD_COMMAND,
  getDefaultSkillpackRoot,
  REMOVE_COMMAND,
  SKILLPACKS_COMMAND,
  STATE_ENTRY_TYPE,
} from './constants';
import {
  discoverSkillEntryPoints,
  resolveSelectedSkillEntryPoints,
} from './discovery';
import { normalizeSkillpackPath, resolveSkillpackDirectory } from './paths';
import {
  createSkillpackState,
  restoreSelectedPathsFromEntries,
  type SessionEntryLike,
} from './state';

interface SkillpackSessionLoaderOptions {
  rootDir?: string;
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function padVisible(text: string, width: number): string {
  const padding = Math.max(0, width - visibleWidth(text));
  return text + ' '.repeat(padding);
}

function isPrintableCharacter(data: string): boolean {
  return data.length === 1 && data >= ' ' && data !== '\u007f';
}

function formatStatusMarker(
  theme: Theme,
  status: SkillpackBrowserStatus,
): string {
  switch (status) {
    case 'explicit':
      return theme.fg('success', '●');
    case 'active':
      return theme.fg('accent', '◉');
    case 'partial':
      return theme.fg('warning', '◌');
    default:
      return theme.fg('dim', '○');
  }
}

function formatStatusText(
  status: SkillpackBrowserStatus,
  item: SkillpackBrowserItem,
): string {
  switch (status) {
    case 'explicit':
      return 'Explicitly selected';
    case 'active':
      return item.kind === 'skill'
        ? 'Active via selected skill pack'
        : 'All descendant skills are active';
    case 'partial':
      return 'Some descendant skills are active';
    default:
      return 'Inactive';
  }
}

function wrapBlock(text: string, width: number, maxLines?: number): string[] {
  if (width <= 0) return [];

  const wrapped: string[] = [];
  const lines = text.split('\n');

  for (const line of lines) {
    if (line.length === 0) {
      wrapped.push('');
    } else {
      wrapped.push(...wrapTextWithAnsi(line, width));
    }

    if (maxLines !== undefined && wrapped.length >= maxLines) {
      return wrapped.slice(0, maxLines);
    }
  }

  return wrapped;
}

function sameSelections(current: Set<string>, next: string[]): boolean {
  if (current.size !== next.length) {
    return false;
  }

  const nextSet = new Set(next);
  for (const value of current) {
    if (!nextSet.has(value)) {
      return false;
    }
  }

  return true;
}

class SkillpacksDialog implements Component {
  private query: string;
  private filteredItems: SkillpackBrowserItem[];
  private selectedIndex = 0;
  private readonly maxVisibleItems = 18;
  private readonly collapsedPaths = new Set<string>();

  constructor(
    private readonly items: SkillpackBrowserItem[],
    private readonly pendingSelectedPaths: Set<string>,
    private readonly theme: Theme,
    private readonly requestRender: () => void,
    private readonly done: (selectedPaths: string[] | null) => void,
    initialQuery = '',
  ) {
    this.query = initialQuery;
    this.filteredItems = getVisibleSkillpackBrowserItems(
      this.items,
      this.query,
      this.collapsedPaths,
    );
  }

  private getSelectedItem(): SkillpackBrowserItem | undefined {
    return this.filteredItems[this.selectedIndex];
  }

  private isCollapsed(item: SkillpackBrowserItem): boolean {
    return item.kind === 'group' && this.collapsedPaths.has(item.value);
  }

  private setSelectionByValue(value: string): void {
    const nextIndex = this.filteredItems.findIndex(
      (item) => item.value === value,
    );
    if (nextIndex !== -1) {
      this.selectedIndex = nextIndex;
      return;
    }

    this.selectedIndex = Math.min(
      this.selectedIndex,
      Math.max(0, this.filteredItems.length - 1),
    );
  }

  private refreshFilter(): void {
    const previousValue = this.getSelectedItem()?.value;
    this.filteredItems = getVisibleSkillpackBrowserItems(
      this.items,
      this.query,
      this.collapsedPaths,
    );

    if (this.filteredItems.length === 0) {
      this.selectedIndex = 0;
      return;
    }

    if (previousValue) {
      this.setSelectionByValue(previousValue);
      return;
    }

    this.selectedIndex = Math.min(
      this.selectedIndex,
      this.filteredItems.length - 1,
    );
  }

  private toggleSelectedItem(): void {
    const item = this.getSelectedItem();
    if (!item) return;

    if (this.pendingSelectedPaths.has(item.value)) {
      this.pendingSelectedPaths.delete(item.value);
    } else {
      this.pendingSelectedPaths.add(item.value);
    }
  }

  private findNearestGroupAncestor(
    item: SkillpackBrowserItem,
  ): SkillpackBrowserItem | undefined {
    const parts = item.value.split('/');

    for (let index = parts.length - 1; index > 0; index -= 1) {
      const ancestorPath = parts.slice(0, index).join('/');
      const ancestor = this.items.find(
        (candidate) =>
          candidate.kind === 'group' && candidate.value === ancestorPath,
      );
      if (ancestor) {
        return ancestor;
      }
    }

    return undefined;
  }

  private collapseGroup(item: SkillpackBrowserItem): void {
    if (item.kind !== 'group') return;
    this.collapsedPaths.add(item.value);
    this.refreshFilter();
    this.setSelectionByValue(item.value);
  }

  private expandGroup(item: SkillpackBrowserItem): void {
    if (item.kind !== 'group') return;
    this.collapsedPaths.delete(item.value);
    this.refreshFilter();
    this.setSelectionByValue(item.value);
  }

  private collapseSelectedSection(): void {
    const item = this.getSelectedItem();
    if (!item) return;

    if (item.kind === 'group') {
      if (!this.isCollapsed(item)) {
        this.collapseGroup(item);
      }
      return;
    }

    const ancestor = this.findNearestGroupAncestor(item);
    if (ancestor) {
      this.collapseGroup(ancestor);
    }
  }

  private expandSelectedSection(): void {
    const item = this.getSelectedItem();
    if (!item) return;

    if (item.kind === 'group' && this.isCollapsed(item)) {
      this.expandGroup(item);
      return;
    }

    const ancestor = this.findNearestGroupAncestor(item);
    if (ancestor && this.isCollapsed(ancestor)) {
      this.expandGroup(ancestor);
    }
  }

  private getWindowRange(): { start: number; end: number } {
    if (this.filteredItems.length <= this.maxVisibleItems) {
      return { start: 0, end: this.filteredItems.length };
    }

    const halfWindow = Math.floor(this.maxVisibleItems / 2);
    const maxStart = Math.max(
      0,
      this.filteredItems.length - this.maxVisibleItems,
    );
    const start = Math.max(
      0,
      Math.min(this.selectedIndex - halfWindow, maxStart),
    );
    return {
      start,
      end: Math.min(this.filteredItems.length, start + this.maxVisibleItems),
    };
  }

  private renderListLine(
    item: SkillpackBrowserItem,
    width: number,
    isSelected: boolean,
  ): string {
    const status = getSkillpackBrowserStatus(
      this.items,
      this.pendingSelectedPaths,
      item,
    );
    const marker = formatStatusMarker(this.theme, status);
    const indent = '  '.repeat(item.depth);
    const prefix = isSelected ? this.theme.fg('accent', '›') : ' ';
    const disclosure =
      item.kind === 'group'
        ? this.theme.fg('dim', this.isCollapsed(item) ? '▸' : '▾')
        : ' ';
    const suffix =
      item.kind === 'group'
        ? this.theme.fg('dim', ` (${item.skillCount})`)
        : '';
    const baseText = `${prefix} ${indent}${disclosure} ${marker} ${item.title}${suffix}`;
    const truncated = truncateToWidth(baseText, width);

    if (!isSelected) {
      return truncated;
    }

    return this.theme.bg('selectedBg', padVisible(truncated, width));
  }

  private renderLeftPane(width: number): string[] {
    const lines: string[] = [];
    const searchValue =
      this.query.length > 0 ? this.query : this.theme.fg('dim', '_');

    lines.push(
      truncateToWidth(
        `${this.theme.fg('muted', 'Search:')} ${searchValue}`,
        width,
      ),
    );
    lines.push('');
    lines.push(
      truncateToWidth(
        this.theme.fg(
          'accent',
          this.theme.bold(
            `Skillpacks (${this.filteredItems.length}/${this.items.length})`,
          ),
        ),
        width,
      ),
    );

    if (this.filteredItems.length === 0) {
      lines.push('');
      lines.push(
        truncateToWidth(this.theme.fg('warning', 'No matches found.'), width),
      );
    } else {
      const { start, end } = this.getWindowRange();
      for (let index = start; index < end; index += 1) {
        const item = this.filteredItems[index];

        if (!item) {
          continue;
        }

        lines.push(
          this.renderListLine(item, width, index === this.selectedIndex),
        );
      }

      if (this.filteredItems.length > this.maxVisibleItems) {
        lines.push(
          truncateToWidth(
            this.theme.fg(
              'dim',
              `(${this.selectedIndex + 1}/${this.filteredItems.length})`,
            ),
            width,
          ),
        );
      }
    }

    lines.push('');
    lines.push(
      truncateToWidth(
        this.theme.fg(
          'dim',
          'Type to search • Backspace edits search • Ctrl+U clear',
        ),
        width,
      ),
    );
    lines.push(
      truncateToWidth(
        this.theme.fg(
          'dim',
          '↑/↓ navigate • ←/→ collapse • Enter toggle section • Space toggle',
        ),
        width,
      ),
    );
    lines.push(
      truncateToWidth(this.theme.fg('dim', 'Esc apply • Ctrl+C cancel'), width),
    );

    return lines;
  }

  private renderGroupDetails(
    item: SkillpackBrowserItem,
    width: number,
  ): string[] {
    const lines: string[] = [];
    const children = getDescendantSkills(this.items, item).filter(
      (skill) => skill.value !== item.value,
    );

    lines.push(...wrapBlock(`Description: ${item.description}`, width));
    lines.push('');
    lines.push(...wrapBlock(`Skills: ${children.length} total`, width));
    lines.push('');
    lines.push(this.theme.fg('muted', 'Contained skills:'));

    for (const child of children.slice(0, 12)) {
      const status = getSkillpackBrowserStatus(
        this.items,
        this.pendingSelectedPaths,
        child,
      );
      lines.push(
        truncateToWidth(
          `${formatStatusMarker(this.theme, status)} ${child.title} ${this.theme.fg('dim', `(${child.value})`)}`,
          width,
        ),
      );
    }

    if (children.length > 12) {
      lines.push(this.theme.fg('dim', `…and ${children.length - 12} more`));
    }

    return lines;
  }

  private renderSkillDetails(
    item: SkillpackBrowserItem,
    width: number,
  ): string[] {
    const lines: string[] = [];

    lines.push(...wrapBlock(`Description: ${item.description}`, width));

    if (item.skillFilePath) {
      lines.push('');
      lines.push(this.theme.fg('muted', 'Origin:'));
      lines.push(...wrapBlock(item.skillFilePath, width));
    }

    if (item.body.trim()) {
      const previewLines = wrapBlock(item.body.trim(), width, 18);
      const originalLineCount = item.body.trim().split('\n').length;

      lines.push('');
      lines.push(this.theme.fg('muted', 'Instruction:'));
      lines.push(...previewLines);

      if (originalLineCount > 18) {
        lines.push(this.theme.fg('dim', `(truncated at line 18)`));
      }
    }

    return lines;
  }

  private renderRightPane(width: number): string[] {
    const item = this.getSelectedItem();

    if (!item) {
      return [
        this.theme.fg('warning', 'No skill packs match the current search.'),
      ];
    }

    const lines: string[] = [];
    const status = getSkillpackBrowserStatus(
      this.items,
      this.pendingSelectedPaths,
      item,
    );
    const activeSkillCount = countActiveSkillsForItem(
      this.items,
      this.pendingSelectedPaths,
      item,
    );

    lines.push(
      truncateToWidth(
        this.theme.fg('accent', this.theme.bold(item.title)),
        width,
      ),
    );
    lines.push('');
    lines.push(
      truncateToWidth(
        `Type: ${this.theme.fg('accent', item.kind === 'group' ? 'skillpack' : 'skill')}`,
        width,
      ),
    );
    lines.push(truncateToWidth(`Path: ${item.value}`, width));
    lines.push(
      truncateToWidth(
        `Status: ${formatStatusMarker(this.theme, status)} ${formatStatusText(status, item)}`,
        width,
      ),
    );
    lines.push(
      truncateToWidth(
        `Active skills: ${activeSkillCount}/${item.skillCount}`,
        width,
      ),
    );
    if (item.kind === 'group') {
      lines.push(
        truncateToWidth(
          `Section: ${this.theme.fg('accent', this.isCollapsed(item) ? 'collapsed' : 'expanded')}`,
          width,
        ),
      );
    }
    lines.push('');

    if (item.kind === 'group') {
      lines.push(...this.renderGroupDetails(item, width));
    } else {
      lines.push(...this.renderSkillDetails(item, width));
    }

    return lines;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.up)) {
      if (this.filteredItems.length > 0) {
        this.selectedIndex = Math.max(0, this.selectedIndex - 1);
        this.requestRender();
      }
      return;
    }

    if (matchesKey(data, Key.down)) {
      if (this.filteredItems.length > 0) {
        this.selectedIndex = Math.min(
          this.filteredItems.length - 1,
          this.selectedIndex + 1,
        );
        this.requestRender();
      }
      return;
    }

    if (matchesKey(data, Key.left)) {
      this.collapseSelectedSection();
      this.requestRender();
      return;
    }

    if (matchesKey(data, Key.right)) {
      this.expandSelectedSection();
      this.requestRender();
      return;
    }

    if (matchesKey(data, Key.space)) {
      this.toggleSelectedItem();
      this.requestRender();
      return;
    }

    if (matchesKey(data, Key.enter)) {
      const item = this.getSelectedItem();
      if (item?.kind === 'group') {
        if (this.isCollapsed(item)) {
          this.expandGroup(item);
        } else {
          this.collapseGroup(item);
        }
        this.requestRender();
      }
      return;
    }

    if (matchesKey(data, Key.escape)) {
      this.done(
        Array.from(this.pendingSelectedPaths).sort((left, right) =>
          left.localeCompare(right),
        ),
      );
      return;
    }

    if (matchesKey(data, Key.ctrl('c'))) {
      this.done(null);
      return;
    }

    if (matchesKey(data, Key.backspace)) {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        this.refreshFilter();
        this.requestRender();
      }
      return;
    }

    if (matchesKey(data, Key.ctrl('u'))) {
      if (this.query.length > 0) {
        this.query = '';
        this.refreshFilter();
        this.requestRender();
      }
      return;
    }

    if (isPrintableCharacter(data) && data !== ' ') {
      this.query += data;
      this.refreshFilter();
      this.requestRender();
    }
  }

  render(width: number): string[] {
    if (width < 72) {
      const paneWidth = Math.max(1, width);
      const leftLines = this.renderLeftPane(paneWidth).map((line) =>
        truncateToWidth(line, paneWidth),
      );
      const rightLines = this.renderRightPane(paneWidth).map((line) =>
        truncateToWidth(line, paneWidth),
      );
      const divider = truncateToWidth(
        this.theme.fg('border', '─'.repeat(Math.max(1, paneWidth))),
        paneWidth,
      );
      return [...leftLines, '', divider, ...rightLines];
    }

    const gutter = this.theme.fg('border', ' │ ');
    const gutterWidth = visibleWidth(gutter);
    const availableWidth = Math.max(1, width - gutterWidth);
    const leftWidth = Math.max(
      24,
      Math.min(58, Math.floor(availableWidth * 0.42)),
    );
    const rightWidth = Math.max(1, width - leftWidth - gutterWidth);
    const leftLines = this.renderLeftPane(leftWidth);
    const rightLines = this.renderRightPane(rightWidth);
    const lineCount = Math.max(leftLines.length, rightLines.length);
    const lines: string[] = [];

    for (let index = 0; index < lineCount; index += 1) {
      const left = padVisible(
        truncateToWidth(leftLines[index] ?? '', leftWidth),
        leftWidth,
      );
      const right = truncateToWidth(rightLines[index] ?? '', rightWidth);
      lines.push(truncateToWidth(`${left}${gutter}${right}`, width));
    }

    return lines;
  }

  invalidate(): void {}
}

export function createSkillpackSessionLoader(
  options: SkillpackSessionLoaderOptions = {},
) {
  const rootDir = options.rootDir ?? getDefaultSkillpackRoot();

  return function skillpackSessionLoader(pi: ExtensionAPI) {
    let selectedPaths = new Set<string>();

    function refreshSelectedPaths(ctx: ExtensionContext) {
      selectedPaths = new Set(
        restoreSelectedPathsFromEntries(
          ctx.sessionManager.getBranch() as SessionEntryLike[],
        ),
      );
    }

    function persistSelectedPaths() {
      pi.appendEntry(STATE_ENTRY_TYPE, createSkillpackState(selectedPaths));
    }

    async function ensureExistingDirectory(rawInput: string) {
      const resolved = resolveSkillpackDirectory(rootDir, rawInput);

      let stats: Stats;

      try {
        stats = await stat(resolved.absolutePath);
      } catch (error) {
        const errno = error as NodeJS.ErrnoException;

        if (errno.code === 'ENOENT') {
          throw new Error(
            `Skill pack "${resolved.logicalPath}" does not exist.`,
          );
        }

        throw error;
      }

      if (!stats.isDirectory()) {
        throw new Error(
          `Skill pack "${resolved.logicalPath}" is not a directory.`,
        );
      }

      return resolved;
    }

    pi.on('session_start', async (_event, ctx) => {
      refreshSelectedPaths(ctx);
    });

    pi.on('session_tree', async (_event, ctx) => {
      refreshSelectedPaths(ctx);
    });

    pi.on('resources_discover', async (_event, ctx) => {
      refreshSelectedPaths(ctx);

      const skillPaths = await resolveSelectedSkillEntryPoints(
        rootDir,
        selectedPaths,
      );

      return skillPaths.length > 0 ? { skillPaths } : undefined;
    });

    pi.registerCommand(ADD_COMMAND, {
      description: 'Load a skill pack into the current session',
      getArgumentCompletions: ((prefix) =>
        getAddCompletions(rootDir, prefix) as unknown as
          | AutocompleteItem[]
          | null) as (argumentPrefix: string) => AutocompleteItem[] | null,
      handler: async (args, ctx) => {
        const rawPath = args.trim();

        if (!rawPath) {
          ctx.ui.notify(`Usage: /${ADD_COMMAND} <path>`, 'warning');
          return;
        }

        try {
          refreshSelectedPaths(ctx);

          const { logicalPath, absolutePath } =
            await ensureExistingDirectory(rawPath);
          const skillPaths = await discoverSkillEntryPoints(absolutePath);

          if (skillPaths.length === 0) {
            ctx.ui.notify(`No skills found under "${logicalPath}".`, 'warning');
            return;
          }

          if (selectedPaths.has(logicalPath)) {
            ctx.ui.notify(`"${logicalPath}" is already active.`, 'info');
            return;
          }

          selectedPaths.add(logicalPath);
          persistSelectedPaths();
          ctx.ui.notify(
            `Added "${logicalPath}" (${pluralize(skillPaths.length, 'skill')}). Reloading…`,
            'info',
          );
          await ctx.reload();
          return;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          ctx.ui.notify(message, 'error');
        }
      },
    });

    pi.registerCommand(REMOVE_COMMAND, {
      description: 'Unload a skill pack from the current session',
      getArgumentCompletions: (prefix) =>
        getRemoveCompletions(selectedPaths, prefix),
      handler: async (args, ctx) => {
        const rawPath = args.trim();

        if (!rawPath) {
          ctx.ui.notify(`Usage: /${REMOVE_COMMAND} <path>`, 'warning');
          return;
        }

        try {
          refreshSelectedPaths(ctx);

          const logicalPath = normalizeSkillpackPath(rawPath);

          if (!selectedPaths.has(logicalPath)) {
            ctx.ui.notify(
              `"${logicalPath}" is not active in this session.`,
              'warning',
            );
            return;
          }

          selectedPaths.delete(logicalPath);
          persistSelectedPaths();
          ctx.ui.notify(
            `Removed "${logicalPath}" (${pluralize(selectedPaths.size, 'selection')} remaining). Reloading…`,
            'info',
          );
          await ctx.reload();
          return;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          ctx.ui.notify(message, 'error');
        }
      },
    });

    pi.registerCommand(SKILLPACKS_COMMAND, {
      description: 'Browse and toggle skill packs and skills',
      handler: async (args, ctx) => {
        refreshSelectedPaths(ctx);

        const items = await loadSkillpackBrowserItems(rootDir);
        if (items.length === 0) {
          ctx.ui.notify(`No skill packs found under ${rootDir}.`, 'warning');
          return;
        }

        const pendingSelections = new Set(selectedPaths);
        const result = await ctx.ui.custom<string[] | null>(
          (tui, theme, _kb, done) => {
            return new SkillpacksDialog(
              items,
              pendingSelections,
              theme,
              () => tui.requestRender(),
              done,
              args.trim(),
            );
          },
        );

        if (!result) {
          return;
        }

        if (sameSelections(selectedPaths, result)) {
          ctx.ui.notify('Skill pack selections unchanged.', 'info');
          return;
        }

        selectedPaths = new Set(result);
        persistSelectedPaths();
        ctx.ui.notify(
          `Updated skillpack selections (${pluralize(selectedPaths.size, 'selection')}). Reloading…`,
          'info',
        );
        await ctx.reload();
        return;
      },
    });
  };
}

export default createSkillpackSessionLoader();
