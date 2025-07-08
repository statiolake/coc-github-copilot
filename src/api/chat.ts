// Chat implementation and streaming logic

import { z } from 'zod';

// Native fetch Response type
type FetchResponse = Response;

// Node.js compatible TextDecoder
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

// Zod schemas for GitHub Copilot API - these are the source of truth
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

// Export inferred types
export type ToolCallFunction = z.infer<typeof ToolCallFunctionSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
export type ResponseDelta = z.infer<typeof ResponseDeltaSchema>;
export type Usage = z.infer<typeof UsageSchema>;
export type ResponseChoice = z.infer<typeof ResponseChoiceSchema>;
export type ResponseEvent = z.infer<typeof ResponseEventSchema>;
export type CompletionRequest = z.infer<typeof CompletionRequestSchema>;

// Tool call chunk accumulator for streaming
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
    this.vendor = model.vendor;
    this.family = model.capabilities.family;
    this.name = model.name;
    this.version = '1.0'; // Default version
    this.maxInputTokens = model.capabilities.limits.max_prompt_tokens ?? 128000;
    this.config = config;
    this.getApiToken = getApiToken;
  }

  private createAbortSignal(token?: CancellationToken): AbortSignal | undefined {
    if (!token) {
      return undefined;
    }

    // 既にキャンセルされている場合は即座にabort
    if (token.isCancellationRequested) {
      return AbortSignal.abort();
    }

    const controller = new AbortController();

    // キャンセルイベントを監視
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

      const request: CompletionRequest = {
        intent: true,
        n: 1,
        stream: true,
        temperature: 0.1,
        model: this.id,
        messages: chatMessages,
        tools: options.tools || [],
        tool_choice: options.tools && options.tools.length > 0 ? 'auto' : undefined,
      };

      console.log('Chat request details:', JSON.stringify(request, null, 2));

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
        console.error('Chat API error response:', {
          status: response.status,
          statusText: response.statusText,
          body: errorBody,
          headers: response.headers,
        });

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
    console.log('createStreamIterator: Starting stream processing');
    console.log('createStreamIterator: Response body available:', !!response.body);

    if (!response.body) {
      console.log('createStreamIterator: No response body, returning');
      return;
    }

    // Use ReadableStream approach similar to Zed's BufReader.lines()
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lineCount = 0;

    // Tool call chunk accumulator for this stream
    const toolCallChunks = new Map<number, ToolCallChunk>();

    console.log('createStreamIterator: Starting line-by-line processing...');

    try {
      while (true) {
        if (token?.isCancellationRequested) {
          console.log('createStreamIterator: Cancellation requested, returning');
          return;
        }

        const { done, value } = await reader.read();

        if (done) {
          console.log('createStreamIterator: Stream done, processing final buffer');
          // Process any remaining buffer content
          if (buffer.trim()) {
            await this.processLine(buffer.trim(), lineCount++, toolCallChunks);
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (token?.isCancellationRequested) return;

          const result = await this.processLine(line, lineCount++, toolCallChunks);
          if (result === 'DONE') {
            console.log('createStreamIterator: Received [DONE], returning');
            return;
          }
          if (result) {
            yield result;
          }
        }
      }
    } finally {
      console.log(`createStreamIterator: Finally block - processed ${lineCount} lines`);
      reader.releaseLock();
    }

    console.log('createStreamIterator: Stream processing complete');
  }

  private async processLine(
    line: string,
    lineNum: number,
    toolCallChunks: Map<number, ToolCallChunk>
  ): Promise<LanguageModelTextPart | LanguageModelToolCallPart | 'DONE' | null> {
    const trimmed = line.trim();
    if (!trimmed) return null;

    console.log(`Line ${lineNum}: "${trimmed}"`);

    // Check for data prefix (following Zed's approach)
    const dataPrefix = 'data: ';
    if (!trimmed.startsWith(dataPrefix)) {
      console.log(`Line ${lineNum}: Not a data line, skipping`);
      return null;
    }

    const data = trimmed.slice(dataPrefix.length);
    console.log(`Line ${lineNum}: Data content: "${data}"`);

    // Check for done marker (following Zed's approach)
    if (data.startsWith('[DONE]')) {
      console.log(`Line ${lineNum}: Found [DONE] marker`);
      return 'DONE';
    }

    try {
      // Parse and validate JSON using Zod schema
      const rawData = JSON.parse(data);
      const parseResult = ResponseEventSchema.safeParse(rawData);

      if (!parseResult.success) {
        console.log(`Line ${lineNum}: Zod validation failed:`, parseResult.error);
        console.log(`Line ${lineNum}: Raw data was:`, rawData);
        return null;
      }

      const event: ResponseEvent = parseResult.data;
      console.log(`Line ${lineNum}: Parsed and validated event:`, JSON.stringify(event, null, 2));

      // Following Zed: filter out events with empty choices
      if (!event.choices || event.choices.length === 0) {
        console.log(`Line ${lineNum}: Empty choices, skipping`);
        return null;
      }

      const choice = event.choices[0];
      console.log(`Line ${lineNum}: Processing choice:`, JSON.stringify(choice, null, 2));

      // Process text content
      const content = choice.delta?.content || choice.message?.content;
      if (content) {
        console.log(`Line ${lineNum}: Yielding text content: "${content}"`);
        return new LanguageModelTextPart(content);
      }

      // Process tool calls (note: GitHub Copilot API uses snake_case)
      const toolCalls = choice.delta?.tool_calls || choice.message?.tool_calls;
      if (toolCalls && toolCalls.length > 0) {
        console.log(`Line ${lineNum}: Found ${toolCalls.length} tool calls`);

        // Process all tool calls and accumulate chunks
        const completedToolCalls: LanguageModelToolCallPart[] = [];

        for (const toolCall of toolCalls) {
          console.log(`Line ${lineNum}: Processing tool call:`, toolCall);

          const index = toolCall.index ?? 0;
          let chunk = toolCallChunks.get(index);

          if (!chunk) {
            // Create new chunk
            chunk = {
              index,
              arguments: '',
            };
            toolCallChunks.set(index, chunk);
          }

          // Update chunk with new information
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

          console.log(`Line ${lineNum}: Updated chunk for index ${index}:`, chunk);

          // Check if we have a complete tool call
          if (chunk.id && chunk.name && this.isCompleteJSON(chunk.arguments)) {
            console.log(`Line ${lineNum}: Tool call complete for index ${index}`);

            try {
              const args = chunk.arguments ? JSON.parse(chunk.arguments) : {};
              console.log(
                `Line ${lineNum}: ✅ YIELDING TOOL CALL - id: ${chunk.id}, name: ${chunk.name}, args:`,
                args
              );

              const toolCallPart = new LanguageModelToolCallPart(chunk.id, chunk.name, args);
              completedToolCalls.push(toolCallPart);

              // Remove completed chunk
              toolCallChunks.delete(index);
            } catch (parseError) {
              console.log(
                `Line ${lineNum}: Failed to parse tool call arguments:`,
                parseError,
                'arguments were:',
                chunk.arguments
              );
              // Don't yield incomplete tool calls
            }
          }
        }

        // Return the first completed tool call (if any)
        if (completedToolCalls.length > 0) {
          console.log(`Line ${lineNum}: Returning completed tool call:`, completedToolCalls[0]);
          return completedToolCalls[0];
        }
      }

      return null;
    } catch (jsonError) {
      console.log(`Line ${lineNum}: Failed to parse JSON:`, jsonError, 'Data was:', data);
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
