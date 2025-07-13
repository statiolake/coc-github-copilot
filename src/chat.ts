// GitHub Copilot Language Model Chat implementation
import { z } from 'zod';
import type { 
  LanguageModelChat,
  LanguageModelChatMessage,
  LanguageModelChatRequestOptions,
  LanguageModelChatResponse,
  LanguageModelChatResponseFragment,
  CancellationToken,
  ApiToken,
  Model
} from './types';
import type { CopilotChatConfig } from './config';

// Zod schemas for response validation
const ChatCompletionChunkSchema = z.object({
  choices: z.array(z.object({
    index: z.number(),
    delta: z.object({
      content: z.string().optional(),
      tool_calls: z.array(z.object({
        function: z.object({
          name: z.string(),
          arguments: z.string(),
        }),
      })).optional(),
    }),
  })),
});

export class CopilotLanguageModelChat implements LanguageModelChat {
  readonly id: string;
  readonly vendor: string;
  readonly family: string;
  readonly version: string;
  readonly maxInputTokens: number;

  private model: Model;
  private config: CopilotChatConfig;
  private getApiToken: () => Promise<ApiToken>;

  constructor(
    model: Model,
    config: CopilotChatConfig,
    getApiToken: () => Promise<ApiToken>
  ) {
    this.model = model;
    this.config = config;
    this.getApiToken = getApiToken;
    
    this.id = model.id;
    this.vendor = model.vendor;
    this.family = model.capabilities.family;
    this.version = '1.0';
    this.maxInputTokens = model.capabilities.limits.max_context_window_tokens;
  }

  async sendRequest(
    messages: LanguageModelChatMessage[],
    options?: LanguageModelChatRequestOptions,
    token?: CancellationToken
  ): Promise<LanguageModelChatResponse> {
    const apiToken = await this.getApiToken();
    const completionsUrl = this.config.completionsUrlFromEndpoint(apiToken.apiEndpoint);

    const requestBody = {
      model: this.model.id,
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      stream: true,
      ...(options?.tools && { tools: options.tools }),
    };

    const response = await fetch(completionsUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken.apiKey}`,
        'Content-Type': 'application/json',
        'Copilot-Integration-Id': 'vscode-chat',
      },
      body: JSON.stringify(requestBody),
      signal: token?.isCancellationRequested ? AbortSignal.abort() : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Chat completion failed: ${response.status} - ${errorText}`);
    }

    if (!response.body) {
      throw new Error('No response body received');
    }

    return {
      stream: this.createStreamIterator(response.body, token),
    };
  }

  private async* createStreamIterator(
    body: ReadableStream<Uint8Array>,
    token?: CancellationToken
  ): AsyncIterable<LanguageModelChatResponseFragment> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        if (token?.isCancellationRequested) {
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              return;
            }

            try {
              const chunk = JSON.parse(data);
              const parseResult = ChatCompletionChunkSchema.safeParse(chunk);
              
              if (parseResult.success) {
                const validChunk = parseResult.data;
                
                for (const choice of validChunk.choices) {
                  if (choice.delta.content) {
                    yield {
                      index: choice.index,
                      part: {
                        kind: 'text',
                        value: choice.delta.content,
                      },
                    };
                  }

                  if (choice.delta.tool_calls) {
                    for (const toolCall of choice.delta.tool_calls) {
                      try {
                        const parameters = JSON.parse(toolCall.function.arguments);
                        yield {
                          index: choice.index,
                          part: {
                            kind: 'function',
                            name: toolCall.function.name,
                            parameters,
                          },
                        };
                      } catch {
                        // Ignore invalid tool call parameters
                      }
                    }
                  }
                }
              }
            } catch {
              // Ignore invalid JSON chunks
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}