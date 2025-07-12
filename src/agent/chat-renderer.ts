import { workspace } from 'coc.nvim';
import type { ChatState } from './chat-state';

export interface RenderedLine {
  line: string;
  hlGroup?: string;
  additionalVirtualText?: string;
}

export type Rendered = {
  lines: RenderedLine[];
};

/**
 * Handles rendering chat state to Neovim buffer with differential updates
 */
export class ChatRenderer {
  private bufnr: number;
  private namespace: number;
  private lastRendered: Rendered | null = null;

  constructor(bufnr: number, namespace: number) {
    this.bufnr = bufnr;
    this.namespace = namespace;
  }

  /**
   * Render chat state to buffer with differential updates
   */
  async render(chatState: ChatState, title = '# Copilot Chat'): Promise<void> {
    const rendered = this.renderChatState(chatState, title);
    await this.applyDiffToBuffer(rendered);
    this.lastRendered = rendered;
  }

  private renderChatState(chatState: ChatState, title: string): Rendered {
    const lines: RenderedLine[] = [{ line: title }];

    const components = chatState.getComponents();
    const componentSeparator = (line: string, hlGroup: string) => ({
      line,
      hlGroup,
      additionalVirtualText: '-'.repeat(100),
    });

    for (const component of components) {
      lines.push({ line: '' });

      if (component.type === 'message') {
        const label = component.role === 'user' ? 'You:' : 'Agent:';
        const hlGroup = component.role === 'user' ? 'Title' : 'Function';
        lines.push(componentSeparator(label, hlGroup));

        for (const line of component.content.split('\n')) {
          lines.push({ line });
        }
      } else {
        lines.push(componentSeparator('Tool:', 'Type'));
        lines.push({
          line: `🔧 **${component.toolName}** ${JSON.stringify(component.toolInput)}`,
        });
        lines.push({ line: '```' });

        for (const line of this.limitToolOutput(component.toolResponse).split('\n')) {
          lines.push({ line });
        }

        lines.push({ line: '```' });
      }
    }

    return { lines };
  }

  private async applyDiffToBuffer(rendered: Rendered): Promise<void> {
    const { nvim } = workspace;
    const oldLines = this.lastRendered?.lines ?? [{ line: '' }];
    const newLines = rendered.lines;

    if (!this.lastRendered) {
      await nvim.call('deletebufline', [this.bufnr, 1, await nvim.call('line', ['$'])]);
    }

    const minLength = Math.min(oldLines.length, newLines.length);

    for (let i = 0; i < minLength; i++) {
      if (!this.renderedLinesEqual(oldLines[i], newLines[i])) {
        await nvim.call('setbufline', [this.bufnr, i + 1, newLines[i].line]);
      }
    }

    if (newLines.length > oldLines.length) {
      const linesToAdd = newLines.slice(oldLines.length).map((l) => l.line);
      await nvim.call('append', [oldLines.length, linesToAdd]);
    }

    if (oldLines.length > newLines.length) {
      const startDelete = newLines.length + 1;
      const endDelete = oldLines.length;
      await nvim.call('deletebufline', [this.bufnr, startDelete, endDelete]);
    }

    await this.applyHighlightsAndVirtualText(rendered.lines);
    await nvim.command('redraw');
  }

  private renderedLinesEqual(line1: RenderedLine, line2: RenderedLine): boolean {
    return (
      line1.line === line2.line &&
      line1.hlGroup === line2.hlGroup &&
      line1.additionalVirtualText === line2.additionalVirtualText
    );
  }

  private async applyHighlightsAndVirtualText(lines: RenderedLine[]): Promise<void> {
    const { nvim } = workspace;

    await nvim.call('nvim_buf_clear_namespace', [this.bufnr, this.namespace, 0, -1]);

    for (let i = 0; i < lines.length; i++) {
      const { hlGroup, additionalVirtualText, line } = lines[i];

      if (hlGroup) {
        await nvim.call('nvim_buf_set_extmark', [
          this.bufnr,
          this.namespace,
          i,
          0,
          {
            end_col: line.length,
            hl_group: hlGroup,
            priority: 900,
          },
        ]);
      }

      if (additionalVirtualText) {
        await nvim.call('nvim_buf_set_extmark', [
          this.bufnr,
          this.namespace,
          i,
          0,
          {
            virt_text: [[additionalVirtualText, 'Comment']],
            virt_text_pos: 'eol',
            right_gravity: false,
            undo_restore: true,
            invalidate: false,
            priority: 1000,
          },
        ]);
      }
    }
  }

  /**
   * Move cursor to end if user is following the conversation
   */
  async moveCursorIfFollowing(): Promise<void> {
    const { nvim } = workspace;
    const currentLine = await nvim.call('line', ['.']);
    const lastLine = await nvim.call('line', ['$']);

    if (currentLine >= lastLine - 1) {
      await nvim.call('cursor', [lastLine, 1]);
    }
  }

  /**
   * Clear all buffer content and extmarks
   */
  async clear(): Promise<void> {
    const { nvim } = workspace;
    await nvim.command('normal! ggdG');
    await nvim.call('nvim_buf_clear_namespace', [this.bufnr, this.namespace, 0, -1]);
    this.lastRendered = null;
  }

  private limitToolOutput(text: string, maxLines = 5): string {
    const lines = text.split('\n');
    return lines.length <= maxLines
      ? text
      : `${lines.slice(0, maxLines).join('\n')}\n... (${lines.length - maxLines} more lines)`;
  }
}
