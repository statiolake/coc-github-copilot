// ChatRenderer class for display management with simple full render + diff approach

import { workspace } from 'coc.nvim';
import type { ChatState } from './chat-state';

// Enhanced render result type with per-line highlight and virtual text info
export interface RenderedLine {
  line: string;
  hlGroup?: string;
  additionalVirtualText?: string;
}

export type Rendered = {
  lines: RenderedLine[];
};

export class ChatRenderer {
  private bufnr: number;
  private namespace: number;
  private lastRendered: Rendered | null = null;

  constructor(bufnr: number, namespace: number) {
    this.bufnr = bufnr;
    this.namespace = namespace;
  }

  /**
   * Render the entire chat state to buffer
   * Semantically equivalent to: clear buffer → render everything
   * But optimized to only send diff updates to Neovim
   */
  async render(chatState: ChatState, title = '# Copilot Chat'): Promise<void> {
    const rendered = this.renderChatState(chatState, title);
    await this.applyDiffToBuffer(rendered);
    this.lastRendered = rendered;
  }

  /**
   * Render chat state to lines with margin-top style spacing
   */
  private renderChatState(chatState: ChatState, title: string): Rendered {
    const lines: RenderedLine[] = [{ line: title }];

    const components = chatState.getComponents();
    const componentSeparator = (line: string, hlGroup: string) => ({
      line,
      hlGroup,
      additionalVirtualText: '-'.repeat(100),
    });

    for (const component of components) {
      // Add margin-top (empty line before each component)
      lines.push({ line: '' });
      switch (component.type) {
        case 'message': {
          if (component.role === 'user') {
            lines.push(componentSeparator('You:', 'Title'));
          } else {
            lines.push(componentSeparator('Agent:', 'Function'));
          }

          const messageLines = component.content.split('\n');
          for (const line of messageLines) {
            lines.push({ line });
          }
          break;
        }

        case 'tool': {
          lines.push(componentSeparator('Tool:', 'Type'));
          lines.push({
            line: `🔧 **${component.toolName}** ${JSON.stringify(component.toolInput)}`,
          });
          lines.push({ line: '```' });

          const toolLines = this.limitToolOutput(component.toolResponse).split('\n');
          for (const line of toolLines) {
            lines.push({ line });
          }

          lines.push({ line: '```' });
          break;
        }
      }
    }

    return { lines };
  }

  /**
   * Apply diff-based updates to buffer with simplified line-by-line approach
   */
  private async applyDiffToBuffer(rendered: Rendered): Promise<void> {
    const { nvim } = workspace;

    // In Neovim, we can't remove all lines on the buffer, at least one line
    // must remain.
    const oldLines = this.lastRendered?.lines ?? [{ line: '' }];
    const newLines = rendered.lines;

    if (!this.lastRendered) {
      await nvim.call('deletebufline', [this.bufnr, 1, await nvim.call('line', ['$'])]);
    }

    // Subsequent renders: use diff algorithm
    const minLength = Math.min(oldLines.length, newLines.length);

    for (let i = 0; i < minLength; i++) {
      if (!this.renderedLinesEqual(oldLines[i], newLines[i])) {
        // Update line i+1 (1-based indexing)
        await nvim.call('setbufline', [this.bufnr, i + 1, newLines[i].line]);
      }
    }

    // Add lines if new content is longer
    if (newLines.length > oldLines.length) {
      const linesToAdd = newLines.slice(oldLines.length).map((l) => l.line);
      await nvim.call('append', [oldLines.length, linesToAdd]);
    }

    // Remove lines if new content is shorter
    if (oldLines.length > newLines.length) {
      const startDelete = newLines.length + 1;
      const endDelete = oldLines.length;
      await nvim.call('deletebufline', [this.bufnr, startDelete, endDelete]);
    }

    // Apply highlights and virtual text after ensuring buffer is updated
    await this.applyHighlightsAndVirtualText(rendered.lines);
    await nvim.command('redraw');
  }

  /**
   * Compare two RenderedLine objects for equality
   */
  private renderedLinesEqual(line1: RenderedLine, line2: RenderedLine): boolean {
    return (
      line1.line === line2.line &&
      line1.hlGroup === line2.hlGroup &&
      line1.additionalVirtualText === line2.additionalVirtualText
    );
  }

  /**
   * Apply highlights and virtual text based on RenderedLine info
   */
  private async applyHighlightsAndVirtualText(lines: RenderedLine[]): Promise<void> {
    const { nvim } = workspace;

    // Clear existing extmarks
    await nvim.call('nvim_buf_clear_namespace', [this.bufnr, this.namespace, 0, -1]);

    // Apply highlights and virtual text for each line
    for (let i = 0; i < lines.length; i++) {
      const renderedLine = lines[i];

      // Apply highlight if specified
      if (renderedLine.hlGroup) {
        await nvim.call('nvim_buf_set_extmark', [
          this.bufnr,
          this.namespace,
          i, // 0-based indexing
          0,
          {
            end_col: renderedLine.line.length,
            hl_group: renderedLine.hlGroup,
            priority: 900,
          },
        ]);
      }

      // Apply virtual text if specified
      if (renderedLine.additionalVirtualText) {
        await nvim.call('nvim_buf_set_extmark', [
          this.bufnr,
          this.namespace,
          i, // 0-based indexing
          0,
          {
            virt_text: [[renderedLine.additionalVirtualText, 'Comment']],
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
   * Move cursor to end if user is following
   */
  async moveCursorIfFollowing(): Promise<void> {
    const { nvim } = workspace;

    const currentLine = await nvim.call('line', ['.']);
    const lastLine = await nvim.call('line', ['$']);

    // If cursor is near the end, keep following
    if (currentLine >= lastLine - 1) {
      await nvim.call('cursor', [lastLine, 1]);
    }
  }

  /**
   * Clear all content and extmarks
   */
  async clear(): Promise<void> {
    const { nvim } = workspace;

    await nvim.command('normal! ggdG');
    await nvim.call('nvim_buf_clear_namespace', [this.bufnr, this.namespace, 0, -1]);
    this.lastRendered = null;
  }

  /**
   * Limit tool output length
   */
  private limitToolOutput(text: string, maxLines = 5): string {
    const lines = text.split('\n');
    if (lines.length <= maxLines) {
      return text;
    }
    return `${lines.slice(0, maxLines).join('\n')}\n... (${lines.length - maxLines} more lines)`;
  }
}
