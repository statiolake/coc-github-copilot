// GitHub Copilot Chat interface implementation
import { commands, type ExtensionContext, window, workspace } from 'coc.nvim';
import type { LanguageModelToolResult, LMNamespace } from '../api/types';
import { LanguageModelTextPart } from '../api/types';
import { ChatRenderer } from './chat-renderer';
import { ChatState } from './chat-state';
import type { AgentService } from './index';

// Sidebar state management
let sidebarBufnr: number | null = null;
let sidebarWinId: number | null = null;

// Chat state management
const chatStates = new Map<string, ChatState>();
const chatRenderers = new Map<number, ChatRenderer>();

/**
 * Extract user input from the buffer based on virtual text --- markers
 */
async function getUserInput(bufnr: number): Promise<string | null> {
  const { nvim } = workspace;
  const namespace = await nvim.call('nvim_create_namespace', ['copilot_chat']);

  try {
    // Get all extmarks with virtual text
    const extmarks = await nvim.call('nvim_buf_get_extmarks', [
      bufnr,
      namespace,
      0,
      -1,
      { details: true },
    ]);

    // Find the last You: marker (extmark with virtual text containing dashes)
    let lastYouMarkerLine = -1;
    for (let i = extmarks.length - 1; i >= 0; i--) {
      const extmark = extmarks[i];
      const [_id, line, _col, details] = extmark;
      if (details?.virt_text?.[0]?.[0]?.includes('---')) {
        lastYouMarkerLine = line;
        break;
      }
    }

    if (lastYouMarkerLine === -1) {
      return null;
    }

    const lines = await nvim.call('getbufline', [bufnr, 1, '$']);
    const inputStart = lastYouMarkerLine + 2; // Line after You: marker (1-based)

    if (inputStart > lines.length) {
      return null;
    }

    const inputLines = lines.slice(inputStart - 1); // Convert to 0-based for slice
    const userMessage = inputLines.join('\n').trim();

    return userMessage || null;
  } catch (error) {
    console.error('getUserInput error:', error);
    return null;
  }
}

/**
 * Create and setup a chat buffer with proper configuration
 */
async function createChatBuffer(
  title = '# Copilot Chat'
): Promise<{ bufnr: number; namespace: number; chatState: ChatState; renderer: ChatRenderer }> {
  const { nvim } = workspace;

  // Create new buffer
  await nvim.command('enew');
  await nvim.command('setfiletype markdown');

  const newBufnr = await nvim.call('bufnr', ['%']);
  const namespace = await nvim.call('nvim_create_namespace', ['copilot_chat']);

  // Create chat state and renderer
  const conversationId = `buffer-${newBufnr}`;
  const chatState = new ChatState(conversationId);
  const renderer = new ChatRenderer(newBufnr, namespace);

  // Add initial empty user message for input
  chatState.addEmptyUserMessage();

  // Render initial state
  await renderer.render(chatState, title);

  // Store references
  chatStates.set(conversationId, chatState);
  chatRenderers.set(newBufnr, renderer);

  return { bufnr: newBufnr, namespace, chatState, renderer };
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
  // 自動挿入モードを無効化 - ユーザーが手動で入力モードに入る

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
        if (!agentService.isReady()) {
          window.showErrorMessage('Agent is not ready');
          return;
        }

        const { nvim } = workspace;

        // 現在のバッファが対象バッファかチェック
        const currentBufnr = await nvim.call('bufnr', ['%']);
        if (currentBufnr !== bufnr) {
          return;
        }

        // Get chat state and renderer
        const conversationId = `buffer-${bufnr}`;
        const chatState = chatStates.get(conversationId);
        const renderer = chatRenderers.get(bufnr);

        if (!(chatState && renderer)) {
          window.showErrorMessage('Chat session not found');
          return;
        }

        // Get user input from buffer
        const userMessage = await getUserInput(bufnr);
        if (!userMessage) {
          return;
        }

        // Update the last (empty) user message with actual content
        chatState.updateLastUserMessage(userMessage);
        await renderer.render(chatState);

        // カーソル追従のためのヘルパー関数
        const shouldFollowCursor = async (): Promise<boolean> => {
          const currentLine = await nvim.call('line', ['.']);
          const lastLine = await nvim.call('line', ['$']);
          return currentLine >= lastLine - 1;
        };

        // Assistant message started flag
        let assistantMessageStarted = false;

        // ツール使用のリアルタイム表示コールバック
        const onToolUse = async (
          toolName: string,
          input: object,
          result: LanguageModelToolResult
        ) => {
          try {
            const toolResultText = result.content
              .filter((c): c is LanguageModelTextPart => c instanceof LanguageModelTextPart)
              .map((c: LanguageModelTextPart) => c.value)
              .join('\n');

            // Add tool component to chat state
            chatState.addToolComponent(toolName, input, toolResultText);

            // After tool use, prepare for next assistant message
            assistantMessageStarted = false;

            await renderer.render(chatState);

            // カーソル追従
            if (await shouldFollowCursor()) {
              await renderer.moveCursorIfFollowing();
            }
          } catch (_error) {
            // Tool display error
          }
        };

        // テキストストリーミングコールバック
        const onTextStream = async (textPart: string) => {
          try {
            // Start assistant message on first text part
            if (!assistantMessageStarted) {
              chatState.startAssistantMessage();
              assistantMessageStarted = true;
            }

            // Append text to last assistant message
            chatState.appendToLastAssistantMessage(textPart);
            await renderer.render(chatState);

            // カーソル追従
            if (await shouldFollowCursor()) {
              await renderer.moveCursorIfFollowing();
            }
          } catch (_error) {
            // ストリーミング表示エラー
          }
        };

        // ユーザーメッセージを直接AIに送信
        const result = await agentService.sendDirectMessage(
          userMessage,
          {
            requestId: `interactive-${Date.now()}`,
            participantName: 'copilot',
            command: 'chat',
          },
          conversationId,
          undefined,
          onToolUse,
          onTextStream
        );

        // Ensure final content is set correctly only if assistant message was started
        if (assistantMessageStarted) {
          const finalContent = result.content
            .filter((c): c is LanguageModelTextPart => c instanceof LanguageModelTextPart)
            .map((c: LanguageModelTextPart) => c.value)
            .join('\n');

          chatState.updateLastAssistantMessage(finalContent);
          await renderer.render(chatState);
        }

        // Add new empty user message for next input
        chatState.addEmptyUserMessage();
        await renderer.render(chatState);

        // カーソルを新しい入力エリアに移動
        const finalLine = await nvim.call('line', ['$']);
        await nvim.call('cursor', [finalLine, 1]);
      } catch (error) {
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

        // Get chat state and renderer
        const conversationId = `buffer-${bufnr}`;
        const chatState = chatStates.get(conversationId);
        const renderer = chatRenderers.get(bufnr);

        if (!(chatState && renderer)) {
          window.showErrorMessage('Chat session not found');
          return;
        }

        // Clear chat state
        chatState.clear();
        agentService.clearConversationHistory(conversationId);

        // Add initial empty user message for input
        chatState.addEmptyUserMessage();

        // Re-render with empty state
        await renderer.clear();
        await renderer.render(chatState, '# Copilot Chat');

        // カーソルを入力エリアに移動
        await nvim.call('cursor', [3, 1]);

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
