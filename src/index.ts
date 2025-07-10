// Main extension entry point - exports LM namespace directly for coc.nvim extensions
import { type ExtensionContext, window, workspace } from 'coc.nvim';
import { createAgentService } from './agent';
import { registerChatCommands } from './agent/chat';
import { createLMNamespace } from './api';
import type { LMNamespace } from './api/types';
import { LanguageModelTextPart } from './api/types';
import { initializeSuggestionFeatures } from './suggestion';

export async function activate(context: ExtensionContext): Promise<LMNamespace> {
  // Initialize suggestion functionality (language server, auth, commands)
  await initializeSuggestionFeatures(context);

  // Create LM namespace for chat functionality
  const lm = createLMNamespace();

  // Create agent service
  const agentService = createAgentService();

  // Register test tools for LM API
  async function setupTestTools() {
    try {
      console.log('=== Setting up test tools ===');

      // Register tools with LM namespace
      lm.registerTool('getCurrentTime', {
        invoke: async () => {
          const now = new Date();
          return {
            content: [
              new LanguageModelTextPart(
                `現在の日時は ${now.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} です。`
              ),
            ],
          };
        },
      });
      console.log('Registered tool: getCurrentTime');

      lm.registerTool('calculate', {
        invoke: async (options: { input: { expression: string } }) => {
          try {
            // Simple math evaluation (safe for basic expressions)
            const result = Function(`"use strict"; return (${options.input.expression})`)();
            return {
              content: [
                new LanguageModelTextPart(`計算結果: ${options.input.expression} = ${result}`),
              ],
            };
          } catch (error) {
            return {
              content: [
                new LanguageModelTextPart(
                  `計算エラー: ${options.input.expression} を評価できませんでした。エラー: ${error}`
                ),
              ],
            };
          }
        },
      });
      console.log('Registered tool: calculate');

      lm.registerTool('getWorkspaceInfo', {
        invoke: async () => {
          const { nvim } = workspace;
          const cwd = await nvim.call('getcwd');
          const bufname = await nvim.call('expand', ['%:p']);
          return {
            content: [
              new LanguageModelTextPart(
                `ワークスペース情報:\n- 作業ディレクトリ: ${cwd}\n- 現在のファイル: ${bufname}`
              ),
            ],
          };
        },
      });
      console.log('Registered tool: getWorkspaceInfo');

      lm.registerTool('testError', {
        invoke: async (options: { input: { message: string } }) => {
          return {
            content: [
              new LanguageModelTextPart(
                `エラーツールが呼び出されました。メッセージ: ${options.input.message}\n` +
                  'このエラーを解決するために、現在の時刻を確認してください。getCurrentTimeツールを使用してください。'
              ),
            ],
          };
        },
      });
      console.log('Registered tool: testError');

      console.log('Registered 4 tools successfully');
    } catch (error) {
      console.error('Setup tools error:', error);
      window.showErrorMessage(`ツールセットアップエラー: ${error}`);
    }
  }

  // 起動時に自動でエージェントを初期化
  async function setupAgent() {
    try {
      console.log('=== Auto-initializing Self-Operating Agent on Startup ===');

      // Get a model for the agent
      const models = await lm.selectChatModels({ vendor: 'copilot' });
      if (models.length === 0) {
        console.log('No models available for agent initialization on startup');
        return;
      }

      const model = models[0];
      await agentService.initialize(lm, model);

      if (agentService.isReady()) {
        console.log('Agent successfully initialized on startup');
        const config = agentService.getConfig();
        console.log('Agent configuration:', config);
      } else {
        console.log('Agent initialization failed on startup');
      }
    } catch (error) {
      console.error('Auto agent initialization error:', error);
    }
  }

  // 起動時のセットアップを非同期で実行
  setTimeout(async () => {
    await setupTestTools();
    await setupAgent();
  }, 1000); // 1秒後に実行（拡張機能の初期化が完了してから）

  // Register chat commands
  registerChatCommands(context, agentService, lm);

  context.subscriptions.push(
    agentService // Add agent service to disposables
  );

  return lm;
}
