// Main extension entry point - exports LM namespace directly for coc.nvim extensions
import { commands, type ExtensionContext, window, workspace } from 'coc.nvim';
import { createLMNamespace } from './api';
import type { LanguageModelChat, LanguageModelChatResponse, LMNamespace } from './api/types';
import {
  LanguageModelChatMessage,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
} from './api/types';
import { initializeSuggestionFeatures } from './suggestion';

export async function activate(context: ExtensionContext): Promise<LMNamespace> {
  // Initialize suggestion functionality (language server, auth, commands)
  await initializeSuggestionFeatures(context);

  const lm = createLMNamespace();

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
        const allModels = await lm.selectChatModels({});
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

        console.log('Registered tools:', lm.tools);
        window.showInformationMessage(
          `GitHub Copilot: ${lm.tools.length}個のテストツールを登録しました`
        );

        // ツールのdisposableを適切に管理
        context.subscriptions.push(timeToolDisposable, calcToolDisposable, fsInfoToolDisposable);
      } catch (error) {
        console.error('Tool registration error:', error);
        window.showErrorMessage(`ツール登録エラー: ${error}`);
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
        const models = await lm.selectChatModels({});
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

  context.subscriptions.push(testChatCommand, registerTestToolsCommand, testChatWithToolsCommand);

  // Create and return the LM namespace directly
  // This matches the lm.d.ts interface where the namespace is returned "as is"
  return lm;
}

export async function deactivate(): Promise<void> {}
