import { commands, type ExtensionContext, window, workspace } from 'coc.nvim';
import type { LanguageModelToolResult, LMNamespace } from '../api/types';
import { LanguageModelTextPart } from '../api/types';
import { ChatRenderer } from './chat-renderer';
import { ChatState } from './chat-state';
import type { AgentService } from './index';

let sidebarBufnr: number | null = null;
let sidebarWinId: number | null = null;

const chatStates = new Map<string, ChatState>();
const chatRenderers = new Map<number, ChatRenderer>();

async function getUserInput(bufnr: number): Promise<string | null> {
  const { nvim } = workspace;
  const namespace = await nvim.call('nvim_create_namespace', ['copilot_chat']);

  try {
    const extmarks = await nvim.call('nvim_buf_get_extmarks', [
      bufnr,
      namespace,
      0,
      -1,
      { details: true },
    ]);

    let lastYouMarkerLine = -1;
    for (let i = extmarks.length - 1; i >= 0; i--) {
      const [_id, line, _col, details] = extmarks[i];
      if (details?.virt_text?.[0]?.[0]?.includes('---')) {
        lastYouMarkerLine = line;
        break;
      }
    }

    if (lastYouMarkerLine === -1) return null;

    const lines = await nvim.call('getbufline', [bufnr, 1, '$']);
    const inputStart = lastYouMarkerLine + 2;

    if (inputStart > lines.length) return null;

    const inputLines = lines.slice(inputStart - 1);
    const userMessage = inputLines.join('\n').trim();

    return userMessage || null;
  } catch (error) {
    console.error('getUserInput error:', error);
    return null;
  }
}

async function createChatBuffer(
  title = '# Copilot Chat'
): Promise<{ bufnr: number; namespace: number; chatState: ChatState; renderer: ChatRenderer }> {
  const { nvim } = workspace;

  await nvim.command('enew');
  await nvim.command('setfiletype markdown');

  const newBufnr = await nvim.call('bufnr', ['%']);
  const namespace = await nvim.call('nvim_create_namespace', ['copilot_chat']);

  const conversationId = `buffer-${newBufnr}`;
  const chatState = new ChatState(conversationId);
  const renderer = new ChatRenderer(newBufnr, namespace);

  chatState.addEmptyUserMessage();
  await renderer.render(chatState, title);

  chatStates.set(conversationId, chatState);
  chatRenderers.set(newBufnr, renderer);

  return { bufnr: newBufnr, namespace, chatState, renderer };
}

async function setupSidebarBuffer(): Promise<number> {
  if (sidebarBufnr) {
    const { nvim } = workspace;
    try {
      const bufExists = await nvim.call('bufexists', [sidebarBufnr]);
      if (bufExists) {
        await nvim.command(`buffer ${sidebarBufnr}`);
        return sidebarBufnr;
      }
    } catch {}
  }

  const { bufnr } = await createChatBuffer('# Copilot Chat (Sidebar)');
  sidebarBufnr = bufnr;
  return bufnr;
}

async function setupKeyMappings(bufnr: number): Promise<void> {
  const { nvim } = workspace;
  const commands = [
    `nnoremap <buffer> <CR> :call CocActionAsync('runCommand', 'copilot.sendMessage', ${bufnr})<CR>`,
    `inoremap <buffer> <C-s> <Esc>:call CocActionAsync('runCommand', 'copilot.sendMessage', ${bufnr})<CR>`,
    `nnoremap <buffer> <C-l> :call CocActionAsync('runCommand', 'copilot.clearHistory', ${bufnr})<CR>`,
  ];

  for (const cmd of commands) {
    await nvim.command(cmd);
  }
}

async function openSidebar(agentService: AgentService): Promise<void> {
  if (!agentService.isReady()) {
    throw new Error('Agent is not ready. Please initialize it first.');
  }

  const { nvim } = workspace;
  await nvim.command('botright 50vnew');

  const bufnr = await setupSidebarBuffer();
  sidebarWinId = await nvim.call('win_getid');

  await setupKeyMappings(bufnr);

  const lastLine = await nvim.call('line', ['$']);
  await nvim.call('cursor', [lastLine, 1]);

  window.showInformationMessage('GitHub Copilot: サイドバーチャットが開始されました。');
}

function resetSidebarBuffer(): void {
  sidebarBufnr = null;
  sidebarWinId = null;
}

async function closeSidebar(): Promise<void> {
  if (!sidebarWinId) return;

  const { nvim } = workspace;
  try {
    const windows = await nvim.call('getwininfo');
    const windowExists = windows.some((win: { winid: number }) => win.winid === sidebarWinId);

    if (windowExists) {
      await nvim.call('win_gotoid', [sidebarWinId]);
      await nvim.command('close');
    }
  } catch {}

  sidebarWinId = null;
  window.showInformationMessage('GitHub Copilot: サイドバーチャットを閉じました。');
}

async function createChatWithSetup(): Promise<void> {
  const { bufnr } = await createChatBuffer();
  const { nvim } = workspace;

  await setupKeyMappings(bufnr);
  await nvim.call('cursor', [3, 1]);
  await nvim.command('startinsert');

  window.showInformationMessage('GitHub Copilot: チャットが開始されました。');
}

function createCommandHandler<T extends unknown[]>(
  handler: (...args: T) => Promise<void>,
  errorPrefix: string
) {
  return async (...args: T) => {
    try {
      await handler(...args);
    } catch (error) {
      console.error(`${errorPrefix} error:`, error);
      window.showErrorMessage(`${errorPrefix}エラー: ${error}`);
    }
  };
}

/**
 * Register all chat-related commands with coc.nvim
 */
export function registerChatCommands(
  context: ExtensionContext,
  agentService: AgentService,
  _lm: LMNamespace
) {
  const chatCommand = commands.registerCommand(
    'copilot.chat',
    createCommandHandler(async () => {
      if (!agentService.isReady()) {
        throw new Error('Agent is not ready. Please initialize it first.');
      }
      await createChatWithSetup();
    }, 'チャット')
  );

  const sendMessageCommand = commands.registerCommand(
    'copilot.sendMessage',
    createCommandHandler(async (bufnr: number) => {
      if (!agentService.isReady()) {
        window.showErrorMessage('Agent is not ready');
        return;
      }

      const { nvim } = workspace;
      const currentBufnr = await nvim.call('bufnr', ['%']);
      if (currentBufnr !== bufnr) return;

      const conversationId = `buffer-${bufnr}`;
      const chatState = chatStates.get(conversationId);
      const renderer = chatRenderers.get(bufnr);

      if (!(chatState && renderer)) {
        window.showErrorMessage('Chat session not found');
        return;
      }

      const userMessage = await getUserInput(bufnr);
      if (!userMessage) return;

      chatState.updateLastUserMessage(userMessage);
      await renderer.render(chatState);

      const shouldFollowCursor = async () => {
        const currentLine = await nvim.call('line', ['.']);
        const lastLine = await nvim.call('line', ['$']);
        return currentLine >= lastLine - 1;
      };

      let assistantMessageStarted = false;

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

          chatState.addToolComponent(toolName, input, toolResultText);
          assistantMessageStarted = false;
          await renderer.render(chatState);

          if (await shouldFollowCursor()) {
            await renderer.moveCursorIfFollowing();
          }
        } catch {}
      };

      const onTextStream = async (textPart: string) => {
        try {
          if (!assistantMessageStarted) {
            chatState.startAssistantMessage();
            assistantMessageStarted = true;
          }

          chatState.appendToLastAssistantMessage(textPart);
          await renderer.render(chatState);

          if (await shouldFollowCursor()) {
            await renderer.moveCursorIfFollowing();
          }
        } catch {}
      };

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

      if (assistantMessageStarted) {
        const finalContent = result.content
          .filter((c): c is LanguageModelTextPart => c instanceof LanguageModelTextPart)
          .map((c: LanguageModelTextPart) => c.value)
          .join('\n');

        chatState.updateLastAssistantMessage(finalContent);
        await renderer.render(chatState);
      }

      chatState.addEmptyUserMessage();
      await renderer.render(chatState);

      const finalLine = await nvim.call('line', ['$']);
      await nvim.call('cursor', [finalLine, 1]);
    }, 'メッセージ送信')
  );

  const clearHistoryCommand = commands.registerCommand(
    'copilot.clearHistory',
    createCommandHandler(async (bufnr: number) => {
      const { nvim } = workspace;
      const currentBufnr = await nvim.call('bufnr', ['%']);
      if (currentBufnr !== bufnr) return;

      const conversationId = `buffer-${bufnr}`;
      const chatState = chatStates.get(conversationId);
      const renderer = chatRenderers.get(bufnr);

      if (!(chatState && renderer)) {
        window.showErrorMessage('Chat session not found');
        return;
      }

      chatState.clear();
      agentService.clearConversationHistory(conversationId);
      chatState.addEmptyUserMessage();

      await renderer.clear();
      await renderer.render(chatState, '# Copilot Chat');
      await nvim.call('cursor', [3, 1]);

      window.showInformationMessage('会話履歴をクリアしました');
    }, '履歴クリア')
  );

  const chatSideBarToggleCommand = commands.registerCommand(
    'copilot.chatSideBarToggle',
    createCommandHandler(async () => {
      if (sidebarWinId && sidebarBufnr) {
        const { nvim } = workspace;
        const windows = await nvim.call('getwininfo');
        const isOpen = windows.some((win: { winid: number }) => win.winid === sidebarWinId);

        await (isOpen ? closeSidebar() : openSidebar(agentService));
      } else {
        await openSidebar(agentService);
      }
    }, 'サイドバートグル')
  );

  const chatSideBarOpenCommand = commands.registerCommand(
    'copilot.chatSideBarOpen',
    createCommandHandler(() => openSidebar(agentService), 'サイドバーオープン')
  );

  const chatSideBarCloseCommand = commands.registerCommand(
    'copilot.chatSideBarClose',
    createCommandHandler(closeSidebar, 'サイドバークローズ')
  );

  const chatSideBarResetCommand = commands.registerCommand(
    'copilot.chatSideBarReset',
    createCommandHandler(async () => {
      await closeSidebar();
      resetSidebarBuffer();
      window.showInformationMessage('GitHub Copilot: サイドバーチャットをリセットしました。');
    }, 'サイドバーリセット')
  );

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
