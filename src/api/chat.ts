// Chat implementation and streaming logic

// Native fetch Response type
type FetchResponse = Response;

import type { ApiToken } from './auth';
import type { CopilotChatConfig } from './config';
import type { Model } from './models';
import type {
  CancellationToken,
  LanguageModelChat,
  LanguageModelChatMessage,
  LanguageModelChatRequestOptions,
  LanguageModelChatResponse,
} from './types';
import { LanguageModelError, LanguageModelTextPart, LanguageModelToolCallPart } from './types';

// Internal types for GitHub Copilot API
interface CompletionRequest {
  intent: boolean;
  n: number;
  stream: boolean;
  temperature: number;
  model: string;
  messages: unknown[];
  tools?: unknown[];
  toolChoice?: unknown;
}

interface ResponseEvent {
  choices: ResponseChoice[];
  id: string;
  usage?: Usage;
}

interface Usage {
  completionTokens: number;
  promptTokens: number;
  totalTokens: number;
}

interface ResponseChoice {
  index: number;
  finishReason?: string;
  delta?: ResponseDelta;
  message?: ResponseDelta;
}

interface ResponseDelta {
  content?: string;
  role?: string;
  toolCalls?: unknown[];
}

export class CopilotLanguageModelChat implements LanguageModelChat {
  public readonly id: string;
  public readonly vendor: string;
  public readonly family: string;
  public readonly name: string;
  public readonly version: string;
  public readonly maxInputTokens: number;

  private config: CopilotChatConfig;
  private getApiToken: () => Promise<ApiToken>;

  constructor(model: Model, config: CopilotChatConfig, getApiToken: () => Promise<ApiToken>) {
    this.id = model.id;
    this.vendor = model.vendor;
    this.family = model.capabilities.family;
    this.name = model.name;
    this.version = '1.0'; // Default version
    this.maxInputTokens = model.capabilities.limits.maxPromptTokens;
    this.config = config;
    this.getApiToken = getApiToken;
  }

  async sendRequest(
    messages: LanguageModelChatMessage[],
    options: LanguageModelChatRequestOptions = {},
    token?: CancellationToken
  ): Promise<LanguageModelChatResponse> {
    try {
      if (token?.isCancellationRequested) {
        throw LanguageModelError.Blocked('Request was cancelled');
      }

      const apiToken = await this.getApiToken();
      const apiUrl = this.config.apiUrlFromEndpoint(apiToken.apiEndpoint);

      const chatMessages = messages.map((msg) => this.convertToChatMessage(msg));

      const request: CompletionRequest = {
        intent: true,
        n: 1,
        stream: true,
        temperature: (options.modelOptions?.temperature as number) ?? 0.1,
        model: this.id,
        messages: chatMessages,
        tools: options.tools || [],
        toolChoice: options.toolMode,
      };

      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiToken.apiKey}`,
        'Content-Type': 'application/json',
        'Copilot-Integration-Id': 'vscode-chat',
        'Editor-Version': 'coc.nvim/1.0.0',
      };

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal: token as unknown as AbortSignal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        if (response.status === 401 || response.status === 403) {
          throw LanguageModelError.NoPermissions(`Authentication failed: ${errorBody}`);
        }
        if (response.status === 404) {
          throw LanguageModelError.NotFound(`Model not found: ${errorBody}`);
        }
        throw LanguageModelError.Blocked(`Request failed: ${errorBody}`);
      }

      return {
        stream: this.createStreamIterator(response, token),
        text: this.createTextIterator(response, token),
      };
    } catch (error) {
      if (error instanceof LanguageModelError) {
        throw error;
      }

      if (token?.isCancellationRequested) {
        throw LanguageModelError.Blocked('Request was cancelled');
      }

      throw LanguageModelError.Blocked('Request failed');
    }
  }

  async countTokens(text: string | LanguageModelChatMessage): Promise<number> {
    // Simple token counting estimation
    const content =
      typeof text === 'string'
        ? text
        : text.content
            .map((part) =>
              part instanceof LanguageModelTextPart ? part.value : JSON.stringify(part)
            )
            .join('');

    // Rough estimation: ~4 characters per token
    return Math.ceil(content.length / 4);
  }

  private convertToChatMessage(msg: LanguageModelChatMessage): unknown {
    const content = msg.content
      .map((part) => {
        if (part instanceof LanguageModelTextPart) {
          return part.value;
        }
        return JSON.stringify(part);
      })
      .join('');

    return {
      role: msg.role === 1 ? 'user' : 'assistant',
      content,
      name: msg.name,
    };
  }

  private async *createStreamIterator(
    response: FetchResponse,
    token?: CancellationToken
  ): AsyncIterable<LanguageModelTextPart | LanguageModelToolCallPart | unknown> {
    if (!response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        if (token?.isCancellationRequested) return;

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');

        // Keep the last incomplete line in buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (token?.isCancellationRequested) return;

          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') return;

          try {
            const event: ResponseEvent = JSON.parse(data);
            const choice = event.choices[0];
            if (!choice) continue;

            const content = choice.delta?.content || choice.message?.content;
            if (content) {
              yield new LanguageModelTextPart(content);
            }

            const toolCalls = choice.delta?.toolCalls || choice.message?.toolCalls;
            if (toolCalls && Array.isArray(toolCalls)) {
              for (const toolCall of toolCalls) {
                const tc = toolCall as {
                  id?: string;
                  function?: { name?: string; arguments?: string };
                };
                if (tc.id && tc.function) {
                  try {
                    const args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
                    yield new LanguageModelToolCallPart(tc.id, tc.function.name || '', args);
                  } catch {
                    // Skip invalid tool call arguments
                  }
                }
              }
            }
          } catch {
            // Skip invalid JSON lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async *createTextIterator(
    response: FetchResponse,
    token?: CancellationToken
  ): AsyncIterable<string> {
    for await (const part of this.createStreamIterator(response, token)) {
      if (part instanceof LanguageModelTextPart) {
        yield part.value;
      }
    }
  }
}
