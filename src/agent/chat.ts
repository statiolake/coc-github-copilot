// GitHub Copilot Chat interface implementation
import { commands, type ExtensionContext, window, workspace } from 'coc.nvim';
import type { LanguageModelToolResult, LMNamespace } from '../api/types';
import { LanguageModelTextPart } from '../api/types';
import type { AgentService } from './index';

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

      // 新しいバッファを作成
      const { nvim } = workspace;
      await nvim.command('enew');
      await nvim.command('setfiletype markdown');

      // バッファをクリアして構造を設定
      await nvim.command('normal! ggdG');
      await nvim.setLine('# Copilot Chat');
      await nvim.call('append', [1, '']);
      await nvim.call('append', [2, '']);
      await nvim.call('append', [3, '']); // ユーザー入力用の4行目を確保

      // バッファ番号を取得
      const bufnr = await nvim.call('bufnr', ['%']);

      // 初期のユーザー入力エリアにextmarkを設置
      const namespace = await nvim.call('nvim_create_namespace', ['copilot_chat']);
      const _initialMarkId = await nvim.call('nvim_buf_set_extmark', [
        bufnr,
        namespace,
        2, // 0-based indexing (3行目)
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

      // Created initial extmark for chat input

      // キーマッピングを設定
      await nvim.command(
        `nnoremap <buffer> <CR> :call CocActionAsync('runCommand', 'copilot.sendMessage', ${bufnr})<CR>`
      );
      await nvim.command(
        `inoremap <buffer> <C-s> <Esc>:call CocActionAsync('runCommand', 'copilot.sendMessage', ${bufnr})<CR>`
      );
      await nvim.command(
        `nnoremap <buffer> <C-l> :call CocActionAsync('runCommand', 'copilot.clearHistory', ${bufnr})<CR>`
      );

      // カーソルを入力エリアに移動（virt_lineの下の行）
      await nvim.call('cursor', [4, 1]);
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

        let userInputStartLine = 4; // デフォルトは4行目から（virt_lineの下の行）

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

        // 区切り線を追加してユーザーメッセージを確定
        await appendToBuffer('');
        await appendToBuffer('---');
        await appendToBuffer('');

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

        await appendToBuffer(resultText);
        await appendToBuffer('');
        await appendToBuffer('');

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
        await nvim.call('append', [2, '']);
        await nvim.call('append', [3, '']); // ユーザー入力用の4行目を確保

        // extmarkをクリアして再設置
        const namespace = await nvim.call('nvim_create_namespace', ['copilot_chat']);
        await nvim.call('nvim_buf_clear_namespace', [bufnr, namespace, 0, -1]);

        const _initialMarkId = await nvim.call('nvim_buf_set_extmark', [
          bufnr,
          namespace,
          2, // 0-based indexing (3行目)
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
        await nvim.call('cursor', [4, 1]);
        await nvim.command('startinsert');

        window.showInformationMessage('会話履歴をクリアしました');
      } catch (error) {
        console.error('Clear history error:', error);
        window.showErrorMessage(`履歴クリアエラー: ${error}`);
      }
    }
  );

  context.subscriptions.push(chatCommand, sendMessageCommand, clearHistoryCommand);
}
