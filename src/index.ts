// Main extension entry point - exports LM namespace directly for coc.nvim extensions
import { commands, type ExtensionContext, window } from 'coc.nvim';
import { createLMNamespace } from './api';
import type { LanguageModelChat, LMNamespace } from './api/types';
import { LanguageModelChatMessage } from './api/types';
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

  context.subscriptions.push(testChatCommand);

  // Create and return the LM namespace directly
  // This matches the lm.d.ts interface where the namespace is returned "as is"
  return lm;
}

export async function deactivate(): Promise<void> {}
