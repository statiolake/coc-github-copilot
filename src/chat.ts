// GitHub Copilot Language Model Chat implementation
import { TextDecoder } from 'node:util';
import type {
  CancellationToken,
  LanguageModelChat,
  LanguageModelChatMessage,
  LanguageModelChatRequestOptions,
  LanguageModelChatResponse,
} from '@statiolake/coc-lm-api';
import {
  LanguageModelChatMessageRole,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
} from '@statiolake/coc-lm-api';
import { z } from 'zod';
import type { CopilotChatConfig } from './config';
import type { ApiToken, Model } from './types';

// Zod schemas for response validation
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

const ChatCompletionChunkSchema = z.object({
  choices: z.array(
    z.object({
      index: z.number(),
      delta: z.object({
        content: z.string().nullable().optional(),
        role: z.string().optional(),
        tool_calls: z.array(ToolCallSchema).optional(),
      }),
      finish_reason: z.string().optional(),
    })
  ),
  created: z.number().optional(),
  id: z.string().optional(),
  model: z.string().optional(),
  system_fingerprint: z.string().optional(),
  usage: z
    .object({
      completion_tokens: z.number(),
      prompt_tokens: z.number(),
      total_tokens: z.number(),
      completion_tokens_details: z
        .object({
          accepted_prediction_tokens: z.number(),
          rejected_prediction_tokens: z.number(),
        })
        .optional(),
      prompt_tokens_details: z
        .object({
          cached_tokens: z.number(),
        })
        .optional(),
    })
    .optional(),
  prompt_filter_results: z.array(z.unknown()).optional(),
});

// Interface for accumulating tool call chunks
interface ToolCallChunk {
  index: number;
  id?: string;
  type?: string;
  name?: string;
  arguments: string;
}

export class CopilotLanguageModelChat implements LanguageModelChat {
  readonly id: string;
  readonly name: string;
  readonly vendor: string;
  readonly family: string;
  readonly version: string;
  readonly maxInputTokens: number;

  private model: Model;
  private config: CopilotChatConfig;
  private getApiToken: () => Promise<ApiToken>;

  constructor(model: Model, config: CopilotChatConfig, getApiToken: () => Promise<ApiToken>) {
    this.model = model;
    this.config = config;
    this.getApiToken = getApiToken;

    this.id = model.id;
    this.name = model.name;
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

    // Convert messages to GitHub Copilot format
    const chatMessages = messages.map((msg) => this.convertToChatMessage(msg));

    // Convert tools to GitHub Copilot format
    const copilotTools = (options?.tools || []).map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema || { type: 'object', properties: {} },
      },
    }));

    const requestBody = {
      model: this.model.id,
      messages: chatMessages,
      stream: true,
      ...(copilotTools.length > 0 && { tools: copilotTools }),
      ...(copilotTools.length > 0 && { tool_choice: 'auto' }),
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

    const streamIterator = this.createStreamIterator(response.body, token);
    return {
      stream: streamIterator,
      text: this.createTextIteratorFromStream(streamIterator),
    };
  }

  private async *createStreamIterator(
    body: ReadableStream<Uint8Array>,
    token?: CancellationToken
  ): AsyncIterable<LanguageModelTextPart | LanguageModelToolCallPart> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const toolCallChunks = new Map<number, ToolCallChunk>();

    try {
      while (true) {
        if (token?.isCancellationRequested) {
          break;
        }

        const { done, value } = await reader.read();
        if (done) {
          // Yield any remaining completed tool calls
          yield* this.getCompletedToolCalls(toolCallChunks);
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              yield* this.getCompletedToolCalls(toolCallChunks);
              return;
            }

            try {
              const chunk = JSON.parse(data);
              console.log('GitHub Copilot: Parsed chunk:', JSON.stringify(chunk, null, 2));

              const parseResult = ChatCompletionChunkSchema.safeParse(chunk);

              if (parseResult.success) {
                const validChunk = parseResult.data;
                console.log(
                  'GitHub Copilot: Valid chunk with',
                  validChunk.choices.length,
                  'choices'
                );

                for (const choice of validChunk.choices) {
                  if (choice.delta.content) {
                    console.log('GitHub Copilot: Text content:', choice.delta.content);
                    yield new LanguageModelTextPart(choice.delta.content);
                  }

                  if (choice.delta.tool_calls) {
                    console.log(
                      'GitHub Copilot: Tool calls detected:',
                      JSON.stringify(choice.delta.tool_calls, null, 2)
                    );
                    const completedToolCalls = this.processToolCallChunks(
                      choice.delta.tool_calls,
                      toolCallChunks
                    );
                    if (completedToolCalls.length > 0) {
                      console.log(
                        'GitHub Copilot: Yielding',
                        completedToolCalls.length,
                        'completed tool calls'
                      );
                    }
                    yield* completedToolCalls;
                  }
                }
              } else {
                console.log(
                  'GitHub Copilot: Chunk schema validation failed:',
                  parseResult.error.message
                );
                console.log('GitHub Copilot: Invalid chunk data:', JSON.stringify(chunk, null, 2));
              }
            } catch (jsonError) {
              console.log('GitHub Copilot: JSON parse error:', jsonError);
              console.log('GitHub Copilot: Raw data that failed to parse:', data);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async *createTextIteratorFromStream(
    streamIterator: AsyncIterable<LanguageModelTextPart | LanguageModelToolCallPart>
  ): AsyncIterable<string> {
    for await (const part of streamIterator) {
      if (part instanceof LanguageModelTextPart) {
        yield part.value;
      }
    }
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
      role: msg.role === LanguageModelChatMessageRole.User ? 'user' : 'assistant',
      content,
      name: msg.name,
    };
  }

  private processToolCallChunks(
    toolCalls: Array<{
      id?: string;
      type?: string;
      index?: number;
      function?: { name?: string; arguments?: string };
    }>,
    toolCallChunks: Map<number, ToolCallChunk>
  ): LanguageModelToolCallPart[] {
    const completedToolCalls: LanguageModelToolCallPart[] = [];
    console.log('GitHub Copilot: Processing tool call chunks:', JSON.stringify(toolCalls, null, 2));

    for (const toolCall of toolCalls) {
      const index = toolCall.index ?? 0;
      console.log('GitHub Copilot: Processing tool call at index', index);

      // Get or create chunk
      let chunk = toolCallChunks.get(index);
      if (!chunk) {
        console.log('GitHub Copilot: Creating new chunk for index', index);
        chunk = {
          index,
          arguments: '',
        };
        toolCallChunks.set(index, chunk);
      }

      // Update chunk with new data
      if (toolCall.id) {
        console.log('GitHub Copilot: Setting chunk ID:', toolCall.id);
        chunk.id = toolCall.id;
      }
      if (toolCall.type) {
        console.log('GitHub Copilot: Setting chunk type:', toolCall.type);
        chunk.type = toolCall.type;
      }
      if (toolCall.function?.name) {
        console.log('GitHub Copilot: Setting chunk name:', toolCall.function.name);
        chunk.name = toolCall.function.name;
      }
      if (toolCall.function?.arguments) {
        console.log('GitHub Copilot: Appending arguments:', toolCall.function.arguments);
        chunk.arguments += toolCall.function.arguments;
      }

      console.log('GitHub Copilot: Current chunk state:', JSON.stringify(chunk, null, 2));
      console.log('GitHub Copilot: Is JSON complete?', this.isCompleteJSON(chunk.arguments));

      // Check if tool call is complete
      if (chunk.id && chunk.name && this.isCompleteJSON(chunk.arguments)) {
        try {
          const args = chunk.arguments ? JSON.parse(chunk.arguments) : {};
          console.log('GitHub Copilot: Creating tool call part:', chunk.name, 'with args:', args);
          const toolCallPart = new LanguageModelToolCallPart(chunk.id, chunk.name, args);
          completedToolCalls.push(toolCallPart);
          toolCallChunks.delete(index);
          console.log('GitHub Copilot: Tool call completed and added to results');
        } catch (parseError) {
          console.log('GitHub Copilot: Failed to parse tool arguments:', parseError);
          console.log('GitHub Copilot: Arguments that failed to parse:', chunk.arguments);
        }
      } else {
        console.log('GitHub Copilot: Tool call not yet complete - missing:', {
          hasId: !!chunk.id,
          hasName: !!chunk.name,
          hasCompleteJSON: this.isCompleteJSON(chunk.arguments),
        });
      }
    }

    console.log('GitHub Copilot: Returning', completedToolCalls.length, 'completed tool calls');
    return completedToolCalls;
  }

  private getCompletedToolCalls(
    toolCallChunks: Map<number, ToolCallChunk>
  ): LanguageModelToolCallPart[] {
    const completedToolCalls: LanguageModelToolCallPart[] = [];

    for (const [index, chunk] of toolCallChunks.entries()) {
      if (chunk.id && chunk.name && this.isCompleteJSON(chunk.arguments)) {
        try {
          const args = chunk.arguments ? JSON.parse(chunk.arguments) : {};
          const toolCallPart = new LanguageModelToolCallPart(chunk.id, chunk.name, args);
          completedToolCalls.push(toolCallPart);
          toolCallChunks.delete(index);
        } catch {
          // Ignore incomplete tool calls
        }
      }
    }

    return completedToolCalls;
  }

  private isCompleteJSON(jsonString: string): boolean {
    if (!jsonString || jsonString.trim() === '') {
      console.log('GitHub Copilot: JSON string is empty or null');
      return false;
    }

    try {
      JSON.parse(jsonString);
      console.log('GitHub Copilot: JSON is valid and complete');
      return true;
    } catch (error) {
      console.log('GitHub Copilot: JSON is incomplete or invalid:', error, 'JSON:', jsonString);
      return false;
    }
  }

  async countTokens(
    text: string | LanguageModelChatMessage,
    _token?: CancellationToken
  ): Promise<number> {
    // Simple token counting approximation
    // For more accurate counting, you would need the actual tokenizer
    const textToCount =
      typeof text === 'string'
        ? text
        : text.content
            .map((part) =>
              part instanceof LanguageModelTextPart ? part.value : JSON.stringify(part)
            )
            .join('');
    return Math.ceil(textToCount.length / 4); // Rough approximation: 1 token per 4 characters
  }
}
