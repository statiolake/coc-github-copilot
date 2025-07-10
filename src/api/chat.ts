// GitHub Copilot chat implementation with streaming support

import { z } from 'zod';

type FetchResponse = Response;

// Node.js compatibility shim for TextDecoder
const TextDecoder = globalThis.TextDecoder || require('node:util').TextDecoder;

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

// Schema definitions for GitHub Copilot API validation
const ToolCallFunctionSchema = z.object({
  name: z.string().optional(),
  arguments: z.string().optional(),
});

const ToolCallSchema = z.object({
  id: z.string().optional(),
  type: z.string().optional(),
  index: z.number().optional(),
  function: ToolCallFunctionSchema.optional(),
});

const ResponseDeltaSchema = z.object({
  content: z.string().nullable().optional(),
  role: z.string().optional(),
  tool_calls: z.array(ToolCallSchema).optional(),
});

const UsageSchema = z.object({
  completion_tokens: z.number().optional(),
  prompt_tokens: z.number().optional(),
  total_tokens: z.number().optional(),
});

const ResponseChoiceSchema = z.object({
  index: z.number(),
  finish_reason: z.string().nullable().optional(),
  delta: ResponseDeltaSchema.optional(),
  message: ResponseDeltaSchema.optional(),
});

const ResponseEventSchema = z.object({
  choices: z.array(ResponseChoiceSchema),
  id: z.string(),
  created: z.number().optional(),
  model: z.string().optional(),
  system_fingerprint: z.string().optional(),
  usage: UsageSchema.optional(),
});

const CompletionRequestSchema = z.object({
  intent: z.boolean(),
  n: z.number(),
  stream: z.boolean(),
  temperature: z.number(),
  model: z.string(),
  messages: z.array(z.unknown()),
  tools: z.array(z.unknown()).optional(),
  tool_choice: z.string().optional(),
});

export type ToolCallFunction = z.infer<typeof ToolCallFunctionSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
export type ResponseDelta = z.infer<typeof ResponseDeltaSchema>;
export type Usage = z.infer<typeof UsageSchema>;
export type ResponseChoice = z.infer<typeof ResponseChoiceSchema>;
export type ResponseEvent = z.infer<typeof ResponseEventSchema>;
export type CompletionRequest = z.infer<typeof CompletionRequestSchema>;

// Accumulates tool call fragments during streaming
interface ToolCallChunk {
  index: number;
  id?: string;
  type?: string;
  name?: string;
  arguments: string;
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
    this.vendor = 'copilot';
    this.family = model.capabilities.family;
    this.name = model.name;
    this.version = '1.0';
    this.maxInputTokens = model.capabilities.limits.max_prompt_tokens ?? 128000;
    this.config = config;
    this.getApiToken = getApiToken;
  }

  private createAbortSignal(token?: CancellationToken): AbortSignal | undefined {
    if (!token) {
      return undefined;
    }

    if (token.isCancellationRequested) {
      return AbortSignal.abort();
    }

    const controller = new AbortController();
    token.onCancellationRequested(() => {
      controller.abort();
    });

    return controller.signal;
  }

  private isCompleteJSON(jsonString: string): boolean {
    if (!jsonString || jsonString.trim() === '') {
      return false;
    }

    try {
      JSON.parse(jsonString);
      return true;
    } catch {
      return false;
    }
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

      const copilotTools = (options.tools || []).map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema || { type: 'object', properties: {} },
        },
      }));

      const request: CompletionRequest = {
        intent: true,
        n: 1,
        stream: true,
        temperature: 0.1,
        model: this.id,
        messages: chatMessages,
        tools: copilotTools,
        tool_choice: copilotTools.length > 0 ? 'auto' : undefined,
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
        signal: this.createAbortSignal(token),
      });

      if (!response.ok) {
        const errorBody = await response.text();

        if (response.status === 401 || response.status === 403) {
          throw LanguageModelError.NoPermissions(`Authentication failed: ${errorBody}`);
        }
        if (response.status === 404) {
          throw LanguageModelError.NotFound(`Model not found: ${errorBody}`);
        }
        throw LanguageModelError.Blocked(`Request failed (${response.status}): ${errorBody}`);
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
    if (!response.body) {
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lineCount = 0;

    const toolCallChunks = new Map<number, ToolCallChunk>();

    try {
      while (true) {
        if (token?.isCancellationRequested) {
          return;
        }

        const { done, value } = await reader.read();

        if (done) {
          if (buffer.trim()) {
            await this.processLine(buffer.trim(), lineCount++, toolCallChunks);
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (token?.isCancellationRequested) return;

          const result = await this.processLine(line, lineCount++, toolCallChunks);
          if (result === 'DONE') {
            return;
          }
          if (result) {
            yield result;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async processLine(
    line: string,
    _lineNum: number,
    toolCallChunks: Map<number, ToolCallChunk>
  ): Promise<LanguageModelTextPart | LanguageModelToolCallPart | 'DONE' | null> {
    const trimmed = line.trim();
    if (!trimmed) return null;

    const dataPrefix = 'data: ';
    if (!trimmed.startsWith(dataPrefix)) {
      return null;
    }

    const data = trimmed.slice(dataPrefix.length);

    if (data.startsWith('[DONE]')) {
      return 'DONE';
    }

    try {
      const rawData = JSON.parse(data);
      const parseResult = ResponseEventSchema.safeParse(rawData);

      if (!parseResult.success) {
        return null;
      }

      const event: ResponseEvent = parseResult.data;

      if (!event.choices || event.choices.length === 0) {
        return null;
      }

      const choice = event.choices[0];

      const content = choice.delta?.content || choice.message?.content;
      if (content) {
        return new LanguageModelTextPart(content);
      }

      const toolCalls = choice.delta?.tool_calls || choice.message?.tool_calls;
      if (toolCalls && toolCalls.length > 0) {
        const completedToolCalls: LanguageModelToolCallPart[] = [];

        for (const toolCall of toolCalls) {
          const index = toolCall.index ?? 0;
          let chunk = toolCallChunks.get(index);

          if (!chunk) {
            chunk = {
              index,
              arguments: '',
            };
            toolCallChunks.set(index, chunk);
          }

          if (toolCall.id) {
            chunk.id = toolCall.id;
          }
          if (toolCall.type) {
            chunk.type = toolCall.type;
          }
          if (toolCall.function?.name) {
            chunk.name = toolCall.function.name;
          }
          if (toolCall.function?.arguments) {
            chunk.arguments += toolCall.function.arguments;
          }

          if (chunk.id && chunk.name && this.isCompleteJSON(chunk.arguments)) {
            try {
              const args = chunk.arguments ? JSON.parse(chunk.arguments) : {};
              const toolCallPart = new LanguageModelToolCallPart(chunk.id, chunk.name, args);
              completedToolCalls.push(toolCallPart);
              toolCallChunks.delete(index);
            } catch (_parseError) {
              // Ignore incomplete tool calls
            }
          }
        }

        if (completedToolCalls.length > 0) {
          return completedToolCalls[0];
        }
      }

      return null;
    } catch (_jsonError) {
      return null;
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
