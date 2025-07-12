// GitHub Copilot Chat interface implementation
import { commands, type ExtensionContext, window, workspace } from 'coc.nvim';
import type { LanguageModelToolResult, LMNamespace } from '../api/types';
import { LanguageModelTextPart } from '../api/types';
import type { AgentService } from './index';

// Sidebar state management
let sidebarBufnr: number | null = null;
let sidebarWinId: number | null = null;

/**
 * Create and setup a chat buffer with proper configuration
 */
async function createChatBuffer(
  title = '# Copilot Chat'
): Promise<{ bufnr: number; namespace: number }> {
  const { nvim } = workspace;

  // Create new buffer
  const _bufnr = await nvim.call('bufnr', ['%']);
  await nvim.command('enew');
  await nvim.command('setfiletype markdown');

  // Clear buffer and set structure
  await nvim.command('normal! ggdG');
  await nvim.setLine(title);
  await nvim.call('append', [1, '']);
  await nvim.call('append', [2, '']); // Reserve line 3 for user input

  const newBufnr = await nvim.call('bufnr', ['%']);

  // Create namespace and initial extmark
  const namespace = await nvim.call('nvim_create_namespace', ['copilot_chat']);
  const _initialMarkId = await nvim.call('nvim_buf_set_extmark', [
    newBufnr,
    namespace,
    1, // 0-based indexing (line 2)
    0,
    {
      virt_lines: [[['You:', 'Title']]],
      virt_lines_above: false,
      right_gravity: false,
      undo_restore: true,
      invalidate: false,
      priority: 1000,
    },
  ]);

  return { bufnr: newBufnr, namespace };
}

/**
 * Open chat sidebar
 */
async function openSidebar(agentService: AgentService): Promise<void> {
  if (!agentService.isReady()) {
    throw new Error('Agent is not ready. Please initialize it first.');
  }

  const { nvim } = workspace;

  // Open vertical split on the right
  await nvim.command('botright 50vnew');

  // Create or reuse existing sidebar buffer
  if (!sidebarBufnr) {
    // Create new buffer only if it doesn't exist
    const { bufnr } = await createChatBuffer('# Copilot Chat (Sidebar)');
    sidebarBufnr = bufnr;
  } else {
    // Check if buffer still exists
    try {
      const bufExists = await nvim.call('bufexists', [sidebarBufnr]);
      if (!bufExists) {
        // Buffer was deleted, create new one
        const { bufnr } = await createChatBuffer('# Copilot Chat (Sidebar)');
        sidebarBufnr = bufnr;
      } else {
        // Reuse existing buffer
        await nvim.command(`buffer ${sidebarBufnr}`);
      }
    } catch (_error) {
      // Error checking buffer, create new one
      const { bufnr } = await createChatBuffer('# Copilot Chat (Sidebar)');
      sidebarBufnr = bufnr;
    }
  }

  sidebarWinId = await nvim.call('win_getid');

  // Set up key mappings for sidebar
  await nvim.command(
    `nnoremap <buffer> <CR> :call CocActionAsync('runCommand', 'copilot.sendMessage', ${sidebarBufnr})<CR>`
  );
  await nvim.command(
    `inoremap <buffer> <C-s> <Esc>:call CocActionAsync('runCommand', 'copilot.sendMessage', ${sidebarBufnr})<CR>`
  );
  await nvim.command(
    `nnoremap <buffer> <C-l> :call CocActionAsync('runCommand', 'copilot.clearHistory', ${sidebarBufnr})<CR>`
  );

  // Move cursor to input area (find the last line for continued input)
  const lastLine = await nvim.call('line', ['$']);
  await nvim.call('cursor', [lastLine, 1]);
  await nvim.command('startinsert');

  window.showInformationMessage('GitHub Copilot: サイドバーチャットが開始されました。');
}

/**
 * Reset sidebar buffer (for complete cleanup)
 */
function resetSidebarBuffer(): void {
  sidebarBufnr = null;
  sidebarWinId = null;
}

/**
 * Close chat sidebar
 */
async function closeSidebar(): Promise<void> {
  if (sidebarWinId) {
    const { nvim } = workspace;
    try {
      // Check if window still exists
      const windows = await nvim.call('getwininfo');
      const windowExists = windows.some((win: { winid: number }) => win.winid === sidebarWinId);

      if (windowExists) {
        await nvim.call('win_gotoid', [sidebarWinId]);
        await nvim.command('close');
      }
    } catch (_error) {
      // Window might already be closed
    }

    // Only clear window ID, keep buffer for content preservation
    sidebarWinId = null;
    // Note: sidebarBufnr is kept to preserve chat content

    window.showInformationMessage('GitHub Copilot: サイドバーチャットを閉じました。');
  }
}

export function registerChatCommands(
  context: ExtensionContext,
  agentService: AgentService,
  _lm: LMNamespace
) {
  // チャットコマンド
  const chatCommand = commands.registerCommand('copilot.chat', async () => {
    try {
      // Starting GitHub Copilot Chat

      if (!agentService.isReady()) {
        throw new Error('Agent is not ready. Please initialize it first.');
      }

      // Create chat buffer
      const { bufnr } = await createChatBuffer();
      const { nvim } = workspace;

      // Set up key mappings
      await nvim.command(
        `nnoremap <buffer> <CR> :call CocActionAsync('runCommand', 'copilot.sendMessage', ${bufnr})<CR>`
      );
      await nvim.command(
        `inoremap <buffer> <C-s> <Esc>:call CocActionAsync('runCommand', 'copilot.sendMessage', ${bufnr})<CR>`
      );
      await nvim.command(
        `nnoremap <buffer> <C-l> :call CocActionAsync('runCommand', 'copilot.clearHistory', ${bufnr})<CR>`
      );

      // Move cursor to input area
      await nvim.call('cursor', [3, 1]);
      await nvim.command('startinsert');

      window.showInformationMessage('GitHub Copilot: チャットが開始されました。');
    } catch (error) {
      console.error('Chat error:', error);
      window.showErrorMessage(`チャットエラー: ${error}`);
    }
  });

  // メッセージ送信コマンド
  const sendMessageCommand = commands.registerCommand(
    'copilot.sendMessage',
    async (bufnr: number) => {
      try {
        // Send message command started

        if (!agentService.isReady()) {
          // Agent not ready
          window.showErrorMessage('Agent is not ready');
          return;
        }

        // Agent is ready

        const { nvim } = workspace;

        // 現在のバッファが対象バッファかチェック
        const currentBufnr = await nvim.call('bufnr', ['%']);
        // Current buffer check

        if (currentBufnr !== bufnr) {
          // Buffer mismatch, exiting
          return;
        }

        // extmarkを使ってユーザー入力エリアを特定
        const namespace = await nvim.call('nvim_create_namespace', ['copilot_chat']);

        // 既存のextmarkを検索（ユーザー入力マーカー）
        const existingMarks = await nvim.call('nvim_buf_get_extmarks', [
          bufnr,
          namespace,
          0,
          -1,
          {},
        ]);
        // Found existing extmarks

        let userInputStartLine = 3; // デフォルトは3行目から（virt_lineの下の行）

        if (existingMarks.length > 0) {
          // 最後のextmark（最新のユーザー入力位置）を取得
          const lastMark = existingMarks[existingMarks.length - 1];
          // virt_linesの下の行から入力開始
          userInputStartLine = lastMark[1] + 2; // extmarkの行+2（virt_linesの下）から
          // Using extmark position
        } else {
          // No extmarks found, using default
        }

        const lastLine = await nvim.call('line', ['$']);
        // User input area determined

        if (lastLine < userInputStartLine) {
          // No message found, exiting
          return; // メッセージがない
        }

        // ユーザーメッセージを取得（extmarkの次の行以降）
        const messageLines = [];
        for (let i = userInputStartLine; i <= lastLine; i++) {
          const line = await nvim.call('getline', [i]);
          messageLines.push(line);
        }

        const userMessage = messageLines.join('\n').trim();
        // User message extracted

        if (!userMessage) {
          // Empty user message, exiting
          return;
        }

        // バッファに追記する関数
        const appendToBuffer = async (text: string) => {
          const lines = text.split('\n');
          const lastLine = await nvim.call('line', ['$']);
          await nvim.call('append', [lastLine, lines]);
        };

        // ツール出力を制限する関数（最大5行）
        const limitToolOutput = (text: string, maxLines = 5): string => {
          const lines = text.split('\n');
          if (lines.length <= maxLines) {
            return text;
          }
          return `${lines.slice(0, maxLines).join('\n')}\n... (${lines.length - maxLines} more lines)`;
        };

        // ユーザーメッセージを確定（区切り線なし）
        // No separator needed

        // 会話IDとしてバッファ番号を使用
        const conversationId = `buffer-${bufnr}`;

        // ツール使用のリアルタイム表示コールバック
        const onToolUse = async (
          toolName: string,
          input: object,
          result: LanguageModelToolResult
        ) => {
          try {
            // Tool use callback triggered

            const toolResultText = result.content
              .filter((c): c is LanguageModelTextPart => c instanceof LanguageModelTextPart)
              .map((c: LanguageModelTextPart) => c.value)
              .join('\n');

            const limitedOutput = limitToolOutput(toolResultText);

            // Tool result processed

            // バッファが有効かチェック
            const currentBufnr = await nvim.call('bufnr', ['%']);
            // Buffer verification

            if (currentBufnr !== bufnr) {
              // Switching to target buffer
              // 正しいバッファに切り替え
              await nvim.command(`buffer ${bufnr}`);
            }

            // Appending tool display to buffer
            await appendToBuffer(`🔧 **${toolName}** ${JSON.stringify(input)}`);
            await appendToBuffer('```');
            await appendToBuffer(limitedOutput);
            await appendToBuffer('```');
            await appendToBuffer('');

            // Tool display updated successfully

            // バッファを再描画
            await nvim.command('redraw');
            // Buffer redrawn
          } catch (_error) {
            // Tool display error
          }
        };

        // ユーザーメッセージを直接AIに送信
        // Sending message to agent

        const result = await agentService.sendDirectMessage(
          userMessage,
          {
            requestId: `interactive-${Date.now()}`,
            participantName: 'copilot',
            command: 'chat',
          },
          conversationId,
          undefined,
          onToolUse
        );

        // Agent response received

        // エージェントの応答を表示
        const resultText = result.content
          .filter((c): c is LanguageModelTextPart => c instanceof LanguageModelTextPart)
          .map((c) => c.value)
          .join('\n');

        // エージェントの応答にvirtual textを追加
        const agentResponseLine = await nvim.call('line', ['$']);
        const _agentMarkId = await nvim.call('nvim_buf_set_extmark', [
          bufnr,
          namespace,
          agentResponseLine, // 0-based indexing
          0,
          {
            virt_lines: [[['Agent:', 'Title']]],
            virt_lines_above: false,
            right_gravity: false,
            undo_restore: true,
            invalidate: false,
            priority: 1000,
          },
        ]);

        await appendToBuffer(''); // エージェント応答用の空行
        await appendToBuffer(resultText);
        await appendToBuffer(''); // 次のユーザー入力用の空行

        // 新しいユーザー入力エリアのextmarkを設置
        const newPromptLine = await nvim.call('line', ['$']);
        const _markId = await nvim.call('nvim_buf_set_extmark', [
          bufnr,
          namespace,
          newPromptLine - 1, // 0-based indexing
          0,
          {
            virt_lines: [[['You:', 'Title']]],
            virt_lines_above: false,
            right_gravity: false,
            undo_restore: true,
            invalidate: false,
            priority: 1000,
          },
        ]);

        // Created new extmark for next input

        // ユーザー入力用の空行を追加
        await appendToBuffer('');

        // カーソルを新しい入力エリアに移動（virt_lineの下の行）
        const finalLine = await nvim.call('line', ['$']);
        await nvim.call('cursor', [finalLine, 1]);
        await nvim.command('startinsert');
      } catch (error) {
        // Send message error occurred
        window.showErrorMessage(`メッセージ送信エラー: ${error}`);
      }
    }
  );

  // 履歴クリアコマンド
  const clearHistoryCommand = commands.registerCommand(
    'copilot.clearHistory',
    async (bufnr: number) => {
      try {
        const { nvim } = workspace;

        // 現在のバッファが対象バッファかチェック
        const currentBufnr = await nvim.call('bufnr', ['%']);
        if (currentBufnr !== bufnr) {
          return;
        }

        // バッファをクリアして初期状態に戻す
        await nvim.command('normal! ggdG');
        await nvim.setLine('# Copilot Chat');
        await nvim.call('append', [1, '']);
        await nvim.call('append', [2, '']); // ユーザー入力用の3行目を確保

        // extmarkをクリアして再設置
        const namespace = await nvim.call('nvim_create_namespace', ['copilot_chat']);
        await nvim.call('nvim_buf_clear_namespace', [bufnr, namespace, 0, -1]);

        const _initialMarkId = await nvim.call('nvim_buf_set_extmark', [
          bufnr,
          namespace,
          1, // 0-based indexing (2行目)
          0,
          {
            virt_lines: [[['You:', 'Title']]],
            virt_lines_above: false,
            right_gravity: false,
            undo_restore: true,
            invalidate: false,
            priority: 1000,
          },
        ]);

        // Reset extmark for chat input

        // 会話履歴をクリア
        const conversationId = `buffer-${bufnr}`;
        agentService.clearConversationHistory(conversationId);

        // カーソルを入力エリアに移動（virt_lineの下の行）
        await nvim.call('cursor', [3, 1]);
        await nvim.command('startinsert');

        window.showInformationMessage('会話履歴をクリアしました');
      } catch (error) {
        console.error('Clear history error:', error);
        window.showErrorMessage(`履歴クリアエラー: ${error}`);
      }
    }
  );

  // サイドバートグルコマンド
  const chatSideBarToggleCommand = commands.registerCommand(
    'copilot.chatSideBarToggle',
    async () => {
      try {
        if (sidebarWinId && sidebarBufnr) {
          // Check if sidebar is still open
          const { nvim } = workspace;
          const windows = await nvim.call('getwininfo');
          const isOpen = windows.some((win: { winid: number }) => win.winid === sidebarWinId);

          if (isOpen) {
            await closeSidebar();
          } else {
            await openSidebar(agentService);
          }
        } else {
          await openSidebar(agentService);
        }
      } catch (error) {
        window.showErrorMessage(`サイドバートグルエラー: ${error}`);
      }
    }
  );

  // サイドバーオープンコマンド
  const chatSideBarOpenCommand = commands.registerCommand('copilot.chatSideBarOpen', async () => {
    try {
      await openSidebar(agentService);
    } catch (error) {
      window.showErrorMessage(`サイドバーオープンエラー: ${error}`);
    }
  });

  // サイドバークローズコマンド
  const chatSideBarCloseCommand = commands.registerCommand('copilot.chatSideBarClose', async () => {
    try {
      await closeSidebar();
    } catch (error) {
      window.showErrorMessage(`サイドバークローズエラー: ${error}`);
    }
  });

  // サイドバーリセットコマンド（内容を完全にクリア）
  const chatSideBarResetCommand = commands.registerCommand('copilot.chatSideBarReset', async () => {
    try {
      await closeSidebar();
      resetSidebarBuffer();
      window.showInformationMessage('GitHub Copilot: サイドバーチャットをリセットしました。');
    } catch (error) {
      window.showErrorMessage(`サイドバーリセットエラー: ${error}`);
    }
  });

  context.subscriptions.push(
    chatCommand,
    sendMessageCommand,
    clearHistoryCommand,
    chatSideBarToggleCommand,
    chatSideBarOpenCommand,
    chatSideBarCloseCommand,
    chatSideBarResetCommand
  );
}
