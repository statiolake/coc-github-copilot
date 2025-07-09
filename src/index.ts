// Main extension entry point - exports LM namespace directly for coc.nvim extensions
import { commands, type ExtensionContext, window, workspace } from 'coc.nvim';
import { createAgentService } from './agent';
import { createLMNamespace } from './api';
import type {
  LanguageModelChat,
  LanguageModelChatResponse,
  LanguageModelToolResult,
  LMNamespace,
} from './api/types';
import {
  LanguageModelChatMessage,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
} from './api/types';
import { initializeSuggestionFeatures } from './suggestion';

export async function activate(context: ExtensionContext): Promise<LMNamespace> {
  // Initialize suggestion functionality (language server, auth, commands)
  await initializeSuggestionFeatures(context);

  // Create LM namespace (VS Code compatible)
  const lm = createLMNamespace();

  // Create separate agent service for autonomous capabilities
  const agentService = createAgentService({
    maxIterations: 5,
    maxDepth: 2,
    autoExecute: true,
    timeout: 60000,
    enableLogging: true,
  });

  // Monitor agent status changes
  context.subscriptions.push(
    agentService.onDidChangeAgentStatus((status) => {
      console.log(`Agent status changed: ${status}`);
    })
  );

  // 起動時に自動でテストツールを登録
  async function setupTestTools() {
    try {
      console.log('=== Auto-registering Test Tools on Startup ===');

      // ツール1: 現在時刻を取得
      const timeToolDisposable = lm.registerTool('getCurrentTime', {
        invoke: async (options, _token) => {
          console.log('getCurrentTime tool invoked with:', options.input);
          const now = new Date();
          return {
            content: [new LanguageModelTextPart(`現在時刻: ${now.toLocaleString('ja-JP')}`)],
          };
        },
      });

      // ツール2: 簡単な計算
      const calcToolDisposable = lm.registerTool('calculate', {
        invoke: async (options, _token) => {
          console.log('calculate tool invoked with:', options.input);

          // 型ガードを使用した安全な型チェック
          const isValidInput = (input: unknown): input is { expression: string } => {
            if (typeof input !== 'object' || input === null || !('expression' in input)) {
              return false;
            }
            const inputObj = input as Record<string, unknown>;
            return typeof inputObj.expression === 'string';
          };

          if (!isValidInput(options.input)) {
            return {
              content: [new LanguageModelTextPart('計算エラー: 不正な入力形式です')],
            };
          }

          const input = options.input;
          try {
            // 安全な計算のため、Function constructorを使用（evalより安全）
            const sanitized = input.expression.replace(/[^0-9+\-*/(). ]/g, '');
            if (sanitized !== input.expression) {
              return {
                content: [new LanguageModelTextPart('計算エラー: 不正な文字が含まれています')],
              };
            }
            const result = Function(`"use strict"; return (${sanitized})`)();
            return {
              content: [new LanguageModelTextPart(`計算結果: ${input.expression} = ${result}`)],
            };
          } catch (error) {
            return {
              content: [new LanguageModelTextPart(`計算エラー: ${error}`)],
            };
          }
        },
      });

      // ツール3: ファイルシステム情報
      const fsInfoToolDisposable = lm.registerTool('getWorkspaceInfo', {
        invoke: async (options, _token) => {
          console.log('getWorkspaceInfo tool invoked with:', options.input);
          const fs = require('node:fs');
          const _path = require('node:path');

          try {
            const currentDir = process.cwd();
            const files = fs.readdirSync(currentDir).slice(0, 10); // 最初の10ファイルのみ
            return {
              content: [
                new LanguageModelTextPart(
                  `現在のディレクトリ: ${currentDir}\nファイル一覧: ${files.join(', ')}`
                ),
              ],
            };
          } catch (error) {
            return {
              content: [new LanguageModelTextPart(`ファイルシステムエラー: ${error}`)],
            };
          }
        },
      });

      // ツール4: 追加のテストツール（エラーを発生させて、エージェントのフォローアップをテスト）
      const errorToolDisposable = lm.registerTool('testError', {
        invoke: async (options, _token) => {
          console.log('testError tool invoked with:', options.input);
          return {
            content: [
              new LanguageModelTextPart(
                'エラーが発生しました。時刻を確認してからリトライしてください。'
              ),
            ],
          };
        },
      });

      // ツールのdisposableを適切に管理
      context.subscriptions.push(
        timeToolDisposable,
        calcToolDisposable,
        fsInfoToolDisposable,
        errorToolDisposable
      );

      console.log('Auto-registered tools:', lm.tools);
      console.log(`Successfully registered ${lm.tools.length} test tools on startup`);
    } catch (error) {
      console.error('Auto tool registration error:', error);
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

  // チャットリクエストを実行する関数
  async function performChatRequest(model: LanguageModelChat) {
    console.log('=== Starting chat request ===');
    console.log('Model details:', { id: model.id, name: model.name, vendor: model.vendor });

    // メッセージを作成
    const messages = [
      LanguageModelChatMessage.User('こんにちは。Rust で FizzBuzz を書いた結果を教えてください'),
    ];
    console.log(
      'Created messages:',
      messages.map((m) => ({ role: m.role, content: m.content }))
    );

    // リクエストを送信
    console.log('Sending request to model...');
    const response = await model.sendRequest(messages, {});
    console.log('Received response object:', !!response, !!response.text, !!response.stream);

    // ストリーミングレスポンスを処理
    console.log('Starting to process streaming response...');
    let fullResponse = '';
    let chunkCount = 0;

    for await (const textChunk of response.text) {
      chunkCount++;
      console.log(`Received chunk ${chunkCount}:`, textChunk);
      fullResponse += textChunk;
    }

    console.log('Streaming complete. Total chunks received:', chunkCount);
    console.log('Full response length:', fullResponse.length);

    if (fullResponse.trim()) {
      // 結果を表示（長い場合は最初の部分のみ）
      const displayText =
        fullResponse.length > 200 ? `${fullResponse.substring(0, 200)}...` : fullResponse;

      window.showInformationMessage(`GitHub Copilot の回答: ${displayText}`);
      console.log('GitHub Copilot 完全な回答:', fullResponse);
    } else {
      console.log('Empty response received');
      window.showWarningMessage('GitHub Copilot: 回答が空でした');
    }
  }

  // LM API を使って Copilot Chat に「こんにちは。Rust で FizzBuzz を書いた結果を教えてください」と呼びかけ、結果を表示するコマンド
  const testChatCommand = commands.registerCommand('copilot.testChat', async () => {
    try {
      console.log('=== GitHub Copilot Chat Test Start ===');
      window.showInformationMessage('GitHub Copilot: チャットを開始しています...');

      // 利用可能なモデルを選択
      console.log('Requesting models with vendor: copilot');
      const models = await lm.selectChatModels({ vendor: 'copilot' });
      console.log(
        'Received models:',
        models.length,
        models.map((m) => ({ id: m.id, name: m.name, vendor: m.vendor, family: m.family }))
      );

      if (models.length === 0) {
        console.log('No models found, trying without vendor filter...');
        const allModels = await lm.selectChatModels({ vendor: 'copilot' });
        console.log(
          'All available models:',
          allModels.length,
          allModels.map((m) => ({ id: m.id, name: m.name, vendor: m.vendor, family: m.family }))
        );

        if (allModels.length === 0) {
          console.log('No models available at all - authentication or connection issue');
          window.showErrorMessage(
            'GitHub Copilot: モデルが全く利用できません。認証とネットワーク接続を確認してください。'
          );
        } else {
          console.log('Using first available model instead of copilot vendor');
          const model = allModels[0];
          console.log('Selected model:', {
            id: model.id,
            name: model.name,
            vendor: model.vendor,
            family: model.family,
          });
          await performChatRequest(model);
        }
        return;
      }

      const model = models[0];
      console.log('Selected model:', {
        id: model.id,
        name: model.name,
        vendor: model.vendor,
        family: model.family,
        maxInputTokens: model.maxInputTokens,
      });
      window.showInformationMessage(
        `GitHub Copilot: ${model.name} を使用してチャットを開始します...`
      );

      await performChatRequest(model);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('GitHub Copilot chat error:', error);
      console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      window.showErrorMessage(`GitHub Copilot チャットエラー: ${errorMessage}`);
    }
  });

  // テスト用ツールを登録するコマンド
  const registerTestToolsCommand = commands.registerCommand(
    'copilot.registerTestTools',
    async () => {
      try {
        console.log('=== Registering Test Tools ===');

        // ツール1: 現在時刻を取得
        const timeToolDisposable = lm.registerTool('getCurrentTime', {
          invoke: async (options, _token) => {
            console.log('getCurrentTime tool invoked with:', options.input);
            const now = new Date();
            return {
              content: [new LanguageModelTextPart(`現在時刻: ${now.toLocaleString('ja-JP')}`)],
            };
          },
        });

        // ツール2: 簡単な計算
        const calcToolDisposable = lm.registerTool('calculate', {
          invoke: async (options, _token) => {
            console.log('calculate tool invoked with:', options.input);

            // 型ガードを使用した安全な型チェック
            const isValidInput = (input: unknown): input is { expression: string } => {
              if (typeof input !== 'object' || input === null || !('expression' in input)) {
                return false;
              }
              const inputObj = input as Record<string, unknown>;
              return typeof inputObj.expression === 'string';
            };

            if (!isValidInput(options.input)) {
              return {
                content: [new LanguageModelTextPart('計算エラー: 不正な入力形式です')],
              };
            }

            const input = options.input;
            try {
              // 安全な計算のため、Function constructorを使用（evalより安全）
              const sanitized = input.expression.replace(/[^0-9+\-*/(). ]/g, '');
              if (sanitized !== input.expression) {
                return {
                  content: [new LanguageModelTextPart('計算エラー: 不正な文字が含まれています')],
                };
              }
              const result = Function(`"use strict"; return (${sanitized})`)();
              return {
                content: [new LanguageModelTextPart(`計算結果: ${input.expression} = ${result}`)],
              };
            } catch (error) {
              return {
                content: [new LanguageModelTextPart(`計算エラー: ${error}`)],
              };
            }
          },
        });

        // ツール3: ファイルシステム情報
        const fsInfoToolDisposable = lm.registerTool('getWorkspaceInfo', {
          invoke: async (options, _token) => {
            console.log('getWorkspaceInfo tool invoked with:', options.input);
            const fs = require('node:fs');
            const _path = require('node:path');

            try {
              const currentDir = process.cwd();
              const files = fs.readdirSync(currentDir).slice(0, 10); // 最初の10ファイルのみ
              return {
                content: [
                  new LanguageModelTextPart(
                    `現在のディレクトリ: ${currentDir}\nファイル一覧: ${files.join(', ')}`
                  ),
                ],
              };
            } catch (error) {
              return {
                content: [new LanguageModelTextPart(`ファイルシステムエラー: ${error}`)],
              };
            }
          },
        });

        // ツール4: 追加のテストツール（エラーを発生させて、エージェントのフォローアップをテスト）
        const errorToolDisposable = lm.registerTool('testError', {
          invoke: async (options, _token) => {
            console.log('testError tool invoked with:', options.input);
            return {
              content: [
                new LanguageModelTextPart(
                  'エラーが発生しました。時刻を確認してからリトライしてください。'
                ),
              ],
            };
          },
        });

        console.log('Registered tools:', lm.tools);
        window.showInformationMessage(
          `GitHub Copilot: ${lm.tools.length}個のテストツールを登録しました`
        );

        // ツールのdisposableを適切に管理
        context.subscriptions.push(
          timeToolDisposable,
          calcToolDisposable,
          fsInfoToolDisposable,
          errorToolDisposable
        );
      } catch (error) {
        console.error('Tool registration error:', error);
        window.showErrorMessage(`ツール登録エラー: ${error}`);
      }
    }
  );

  // 自律的なエージェントを初期化するコマンド
  const initializeAgentCommand = commands.registerCommand('copilot.initializeAgent', async () => {
    try {
      console.log('=== Initializing Self-Operating Agent ===');
      window.showInformationMessage('GitHub Copilot: 自律的なエージェントを初期化しています...');

      // Get a model for the agent
      const models = await lm.selectChatModels({ vendor: 'copilot' });
      if (models.length === 0) {
        throw new Error('No models available for agent initialization');
      }

      const model = models[0];
      await agentService.initialize(lm, model);

      if (agentService.isReady()) {
        window.showInformationMessage('GitHub Copilot: エージェントの初期化が完了しました');
        const config = agentService.getConfig();
        console.log('Agent configuration:', config);
      } else {
        throw new Error('Agent initialization failed');
      }
    } catch (error) {
      console.error('Agent initialization error:', error);
      window.showErrorMessage(`エージェント初期化エラー: ${error}`);
    }
  });

  // 自律的なエージェントをテストするコマンド
  const testAgentCommand = commands.registerCommand('copilot.testAgent', async () => {
    try {
      console.log('=== Testing Self-Operating Agent ===');
      window.showInformationMessage('GitHub Copilot: 自律的なエージェントをテストしています...');

      if (!agentService.isReady()) {
        throw new Error('Agent is not ready. Please initialize it first.');
      }

      // 新しいバッファを作成
      const { nvim } = workspace;
      await nvim.command('enew');
      await nvim.command('setfiletype markdown');
      await nvim.setLine('=== Self-Operating Agent Test ===');
      await nvim.call('append', [0, '']);

      // バッファに追記する関数
      const appendToBuffer = async (text: string) => {
        const lines = text.split('\n');
        const currentLineCount = await nvim.call('line', ['$']);
        await nvim.call('append', [currentLineCount, lines]);
      };

      await appendToBuffer('エージェントテスト開始...\n');
      await appendToBuffer(`エージェントステータス: ${agentService.getStatus()}\n`);

      // エラーツールを呼び出してエージェントの自律的な動作をテスト
      const result = await agentService.executeWithAgent('testError', {
        input: { message: 'テストメッセージ' },
        toolInvocationToken: {
          requestId: 'agent-test-request',
          participantName: 'copilot',
          command: 'testAgent',
        },
      });

      await appendToBuffer('\n## エージェントの実行結果\n');
      const resultText = result.content
        .filter((c): c is LanguageModelTextPart => c instanceof LanguageModelTextPart)
        .map((c) => c.value)
        .join('\n');

      await appendToBuffer(resultText);
      await appendToBuffer(`\n最終ステータス: ${agentService.getStatus()}\n`);
      await appendToBuffer('\n✅ エージェントテスト完了\n');

      window.showInformationMessage('GitHub Copilot: エージェントテストが完了しました');
    } catch (error) {
      console.error('Agent test error:', error);
      window.showErrorMessage(`エージェントテストエラー: ${error}`);
    }
  });

  // インタラクティブエージェントチャットコマンド
  const interactiveAgentCommand = commands.registerCommand('copilot.interactiveAgent', async () => {
    try {
      console.log('=== Starting Interactive Agent Chat ===');

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
      const initialMarkId = await nvim.call('nvim_buf_set_extmark', [
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

      console.log(`🔥 [interactiveAgent] Created initial extmark ${initialMarkId} at line 3`);

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

      window.showInformationMessage(
        'GitHub Copilot: インタラクティブエージェントが開始されました。'
      );
    } catch (error) {
      console.error('Interactive agent error:', error);
      window.showErrorMessage(`インタラクティブエージェントエラー: ${error}`);
    }
  });

  // メッセージ送信コマンド
  const sendMessageCommand = commands.registerCommand(
    'copilot.sendMessage',
    async (bufnr: number) => {
      try {
        console.log(`🔥 [sendMessage] Command started with bufnr: ${bufnr}`);

        if (!agentService.isReady()) {
          console.log(`🔥 [sendMessage] Agent not ready, status: ${agentService.getStatus()}`);
          window.showErrorMessage('Agent is not ready');
          return;
        }

        console.log('🔥 [sendMessage] Agent is ready, proceeding...');

        const { nvim } = workspace;

        // 現在のバッファが対象バッファかチェック
        const currentBufnr = await nvim.call('bufnr', ['%']);
        console.log(`🔥 [sendMessage] Current buffer: ${currentBufnr}, target buffer: ${bufnr}`);

        if (currentBufnr !== bufnr) {
          console.log('🔥 [sendMessage] Buffer mismatch, exiting');
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
        console.log(`🔥 [sendMessage] Found ${existingMarks.length} existing extmarks`);

        let userInputStartLine = 4; // デフォルトは4行目から（virt_lineの下の行）

        if (existingMarks.length > 0) {
          // 最後のextmark（最新のユーザー入力位置）を取得
          const lastMark = existingMarks[existingMarks.length - 1];
          // virt_linesの下の行から入力開始
          userInputStartLine = lastMark[1] + 2; // extmarkの行+2（virt_linesの下）から
          console.log(`🔥 [sendMessage] Using extmark position, start line: ${userInputStartLine}`);
        } else {
          console.log(
            `🔥 [sendMessage] No extmarks found, using default start line: ${userInputStartLine}`
          );
        }

        const lastLine = await nvim.call('line', ['$']);
        console.log(
          `🔥 [sendMessage] User input start line: ${userInputStartLine}, last line: ${lastLine}`
        );

        if (lastLine < userInputStartLine) {
          console.log('🔥 [sendMessage] No message found, exiting');
          return; // メッセージがない
        }

        // ユーザーメッセージを取得（extmarkの次の行以降）
        const messageLines = [];
        for (let i = userInputStartLine; i <= lastLine; i++) {
          const line = await nvim.call('getline', [i]);
          messageLines.push(line);
        }

        const userMessage = messageLines.join('\n').trim();
        console.log(`🔥 [sendMessage] User message: "${userMessage}"`);

        if (!userMessage) {
          console.log('🔥 [sendMessage] Empty user message, exiting');
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
            console.log(`🔥 [UI] onToolUse callback triggered! toolName: ${toolName}`);
            console.log('🔥 [UI] input:', input);
            console.log('🔥 [UI] result:', result);

            const toolResultText = result.content
              .filter((c): c is LanguageModelTextPart => c instanceof LanguageModelTextPart)
              .map((c: LanguageModelTextPart) => c.value)
              .join('\n');

            const limitedOutput = limitToolOutput(toolResultText);

            console.log(`🔥 [UI] Tool result text: ${limitedOutput}`);

            // バッファが有効かチェック
            const currentBufnr = await nvim.call('bufnr', ['%']);
            console.log(`🔥 [UI] Current buffer: ${currentBufnr}, target buffer: ${bufnr}`);

            if (currentBufnr !== bufnr) {
              console.log(`🔥 [UI] Switching to buffer ${bufnr} from ${currentBufnr}`);
              // 正しいバッファに切り替え
              await nvim.command(`buffer ${bufnr}`);
            }

            console.log('🔥 [UI] About to append tool display to buffer...');
            await appendToBuffer(`🔧 **${toolName}** ${JSON.stringify(input)}`);
            await appendToBuffer('```');
            await appendToBuffer(limitedOutput);
            await appendToBuffer('```');
            await appendToBuffer('');

            console.log(`🔥 [UI] Tool display updated for ${toolName} - SUCCESS!`);

            // バッファを再描画
            await nvim.command('redraw');
            console.log('🔥 [UI] Buffer redrawn');
          } catch (error) {
            console.error('🔥 [UI] Tool display error:', error);
          }
        };

        // ユーザーメッセージを直接AIに送信
        console.log(`🔥 [UI] Sending message to agent: "${userMessage}"`);
        console.log('🔥 [UI] onToolUse callback function defined:', typeof onToolUse);

        const result = await agentService.sendDirectMessage(
          userMessage,
          {
            requestId: `interactive-${Date.now()}`,
            participantName: 'copilot',
            command: 'interactiveAgent',
          },
          conversationId,
          undefined,
          onToolUse
        );

        console.log('🔥 [UI] Agent response received:', result);

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
        const markId = await nvim.call('nvim_buf_set_extmark', [
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

        console.log(`🔥 [sendMessage] Created new extmark ${markId} at line ${newPromptLine}`);

        // ユーザー入力用の空行を追加
        await appendToBuffer('');

        // カーソルを新しい入力エリアに移動（virt_lineの下の行）
        const finalLine = await nvim.call('line', ['$']);
        await nvim.call('cursor', [finalLine, 1]);
        await nvim.command('startinsert');
      } catch (error) {
        console.error('🔥 [sendMessage] Error occurred:', error);
        console.error(
          '🔥 [sendMessage] Error stack:',
          error instanceof Error ? error.stack : 'No stack'
        );
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

        const initialMarkId = await nvim.call('nvim_buf_set_extmark', [
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

        console.log(`🔥 [clearHistory] Reset extmark ${initialMarkId} at line 3`);

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

  // ツールを使ったチャットテストコマンド
  const testChatWithToolsCommand = commands.registerCommand(
    'copilot.testChatWithTools',
    async () => {
      try {
        console.log('=== GitHub Copilot Chat with Tools Test Start ===');
        window.showInformationMessage('GitHub Copilot: ツール付きチャットを開始しています...');

        // 新しいバッファを作成
        const { nvim } = workspace;
        await nvim.command('enew'); // 新しいバッファを作成
        await nvim.command('setfiletype markdown');
        await nvim.setLine('=== GitHub Copilot Chat with Tools Test ===');
        await nvim.call('append', [0, '']);

        // バッファに追記する関数
        const appendToBuffer = async (text: string) => {
          const lines = text.split('\n');
          const currentLineCount = await nvim.call('line', ['$']);
          await nvim.call('append', [currentLineCount, lines]);
        };

        await appendToBuffer('モデルを選択中...\n');

        // 利用可能なモデルを選択
        const models = await lm.selectChatModels({ vendor: 'copilot' });
        if (models.length === 0) {
          await appendToBuffer('❌ エラー: 利用可能なモデルがありません\n');
          window.showErrorMessage('GitHub Copilot: 利用可能なモデルがありません');
          return;
        }

        const model = models[0];
        console.log('Selected model for tools test:', model.id);
        await appendToBuffer(`✅ モデル選択完了: ${model.name} (${model.id})\n\n`);

        // ユーザーメッセージを表示
        const userMessage =
          '現在時刻を教えてください。また、2 + 3 * 4 の計算もしてください。ワークスペースの情報も知りたいです。';
        await appendToBuffer(`## ユーザーメッセージ\n${userMessage}\n\n`);

        // ツール情報を含むメッセージを作成
        const messages = [LanguageModelChatMessage.User(userMessage)];

        await appendToBuffer('## 利用可能なツール\n');
        lm.tools.forEach(async (tool, index) => {
          await appendToBuffer(
            `${index + 1}. **${tool.name}**: ${tool.description || 'ツール説明なし'}\n`
          );
        });
        await appendToBuffer('\n## GitHub Copilot の回答\n');

        // 利用可能なツールをオプションに含める（GitHub Copilot API形式）
        const chatTools = lm.tools.map((tool) => {
          let parameters: unknown = {
            type: 'object',
            properties: {},
          };

          // ツールごとに適切なパラメータスキーマを設定
          if (tool.name === 'calculate') {
            parameters = {
              type: 'object',
              properties: {
                expression: {
                  type: 'string',
                  description: '計算式（例: 2 + 3 * 4）',
                },
              },
              required: ['expression'],
            };
          } else if (tool.name === 'getCurrentTime' || tool.name === 'getWorkspaceInfo') {
            parameters = {
              type: 'object',
              properties: {},
            };
          }

          return {
            type: 'function',
            function: {
              name: tool.name,
              description:
                tool.name === 'getCurrentTime'
                  ? '現在の時刻を取得します'
                  : tool.name === 'calculate'
                    ? '数式を計算します'
                    : tool.name === 'getWorkspaceInfo'
                      ? 'ワークスペースの情報を取得します'
                      : tool.description,
              parameters,
            },
          };
        });

        console.log('Available tools for request:', chatTools);

        await appendToBuffer('リクエストを送信中...\n');

        // リクエストを送信（ツール付き）
        console.log('Sending request with tools...');

        // シンプルなタイムアウトPromise
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => {
            reject(new Error('Request timeout (30 seconds)'));
          }, 30000);
        });

        try {
          const response = (await Promise.race([
            model.sendRequest(messages, {
              tools: chatTools as never, // TODO: Remove when proper tool types are defined
            }),
            timeoutPromise,
          ])) as LanguageModelChatResponse; // TODO: Remove when Promise.race return type is properly typed

          console.log('Request successful, processing response...');
          await appendToBuffer('✅ レスポンス受信開始\n\n');

          // ストリーミングレスポンスを処理
          let fullResponse = '';
          const toolCalls: LanguageModelToolCallPart[] = [];
          let partCount = 0;

          console.log('Starting to iterate over response.stream...');

          const startTime = Date.now();
          const streamTimeout = 20000; // 20 seconds

          for await (const part of response.stream) {
            // Check for timeout
            if (Date.now() - startTime > streamTimeout) {
              console.log('Stream processing timeout reached, breaking...');
              await appendToBuffer('\n⚠️ ストリーム処理がタイムアウトしました\n');
              break;
            }

            partCount++;
            console.log(
              `🔥 MAIN LOOP: Processing part ${partCount}:`,
              typeof part,
              part?.constructor?.name
            );
            console.log('🔥 MAIN LOOP: Part details:', part);

            if (part instanceof LanguageModelTextPart) {
              fullResponse += part.value;
              console.log('✅ MAIN LOOP: Text part received:', part.value);
              await appendToBuffer(part.value);
            } else if (part instanceof LanguageModelToolCallPart) {
              toolCalls.push(part);
              console.log('🛠️ MAIN LOOP: Tool call received:', part);
              console.log(
                `🛠️ MAIN LOOP: Tool call details - name: ${part.name}, id: ${part.callId}, input:`,
                part.input
              );

              await appendToBuffer(`\n\n### 🛠️ ツール呼び出し: ${part.name}\n`);
              await appendToBuffer(`引数: ${JSON.stringify(part.input, null, 2)}\n`);

              // ツールを実行
              try {
                await appendToBuffer('実行中...\n');
                const result = await lm.invokeTool(part.name, {
                  input: part.input,
                  toolInvocationToken: {
                    requestId: 'test-request',
                    participantName: 'copilot',
                  },
                });
                console.log('Tool result:', result);
                const resultText = result.content
                  .filter((c): c is LanguageModelTextPart => c instanceof LanguageModelTextPart)
                  .map((c) => c.value)
                  .join('');
                await appendToBuffer(`結果: ${resultText}\n`);
              } catch (error) {
                console.error('Tool execution error:', error);
                await appendToBuffer(`❌ エラー: ${error}\n`);
              }
            }
          }

          console.log(
            `Stream processing completed. Parts processed: ${partCount}, Response length: ${fullResponse.length}, Tool calls: ${toolCalls.length}`
          );

          await appendToBuffer('\n\n## 処理完了\n');
          await appendToBuffer(`- 処理したパート数: ${partCount}\n`);
          await appendToBuffer(`- レスポンス長: ${fullResponse.length} 文字\n`);
          await appendToBuffer(`- ツール呼び出し数: ${toolCalls.length}\n`);
        } catch (requestError) {
          console.error('Request failed:', requestError);
          await appendToBuffer(`\n❌ リクエストエラー: ${requestError}\n`);

          // ツールなしでフォールバック
          await appendToBuffer('\n🔄 ツールなしでリトライ中...\n');
          console.log('Falling back to request without tools...');
          try {
            const fallbackResponse = await model.sendRequest(messages, {});
            await appendToBuffer('\n### フォールバック応答\n');
            for await (const textChunk of fallbackResponse.text) {
              await appendToBuffer(textChunk);
            }
            await appendToBuffer('\n\n✅ フォールバック完了\n');
          } catch (fallbackError) {
            await appendToBuffer(`\n❌ フォールバックも失敗: ${fallbackError}\n`);
            throw requestError; // 元のエラーを投げる
          }
        }
      } catch (error) {
        console.error('Chat with tools error:', error);
        window.showErrorMessage(`ツール付きチャットエラー: ${error}`);
      }
    }
  );

  context.subscriptions.push(
    testChatCommand,
    registerTestToolsCommand,
    testChatWithToolsCommand,
    initializeAgentCommand,
    testAgentCommand,
    interactiveAgentCommand,
    sendMessageCommand,
    clearHistoryCommand,
    agentService // Add agent service to disposables
  );

  // Create and return the LM namespace directly
  // This matches the lm.d.ts interface where the namespace is returned "as is"
  return lm;
}

export async function deactivate(): Promise<void> {}
