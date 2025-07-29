import { TextDecoder } from 'node:util';
import type {
  LanguageModelChat,
  LanguageModelChatMessage,
  LanguageModelChatRequestOptions,
  LanguageModelChatResponse,
  LmApi,
} from '@statiolake/coc-lm-api';
import {
  LanguageModelChatMessageRole,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
} from '@statiolake/coc-lm-api';
import { type CancellationToken, type Extension, extensions } from 'coc.nvim';
import { z } from 'zod';
import type { CopilotAuthManager } from './auth';
import type { CopilotChatConfig } from './config';
import { channel } from './log';
import { GitHubCopilotModelManager, type Model } from './models';

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
  private authManager: CopilotAuthManager;

  constructor(model: Model, config: CopilotChatConfig, authManager: CopilotAuthManager) {
    this.model = model;
    this.config = config;
    this.authManager = authManager;

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
    const apiToken = await this.authManager.getChatApiToken();
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
              channel.appendLine(`Parsed chunk: ${JSON.stringify(chunk, null, 2)}`);

              const parseResult = ChatCompletionChunkSchema.safeParse(chunk);

              if (parseResult.success) {
                const validChunk = parseResult.data;
                channel.appendLine(`Valid chunk with ${validChunk.choices.length} choices`);

                for (const choice of validChunk.choices) {
                  if (choice.delta.content) {
                    channel.appendLine(`Text content: ${choice.delta.content}`);
                    yield new LanguageModelTextPart(choice.delta.content);
                  }

                  if (choice.delta.tool_calls) {
                    channel.appendLine(
                      `Tool calls detected: ${JSON.stringify(choice.delta.tool_calls, null, 2)}`
                    );
                    const completedToolCalls = this.processToolCallChunks(
                      choice.delta.tool_calls,
                      toolCallChunks
                    );
                    if (completedToolCalls.length > 0) {
                      channel.appendLine(
                        `Yielding ${completedToolCalls.length} completed tool calls`
                      );
                    }
                    yield* completedToolCalls;
                  }
                }
              } else {
                channel.appendLine(`Chunk schema validation failed: ${parseResult.error.message}`);
                channel.appendLine(`Invalid chunk data: ${JSON.stringify(chunk, null, 2)}`);
              }
            } catch (jsonError) {
              channel.appendLine(`JSON parse error: ${jsonError}`);
              channel.appendLine(`Raw data that failed to parse: ${data}`);
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
    channel.appendLine(`Processing tool call chunks: ${JSON.stringify(toolCalls, null, 2)}`);

    for (const toolCall of toolCalls) {
      const index = toolCall.index ?? 0;
      channel.appendLine(`Processing tool call at index ${index}`);

      // Get or create chunk
      let chunk = toolCallChunks.get(index);
      if (!chunk) {
        channel.appendLine(`Creating new chunk for index ${index}`);
        chunk = {
          index,
          arguments: '',
        };
        toolCallChunks.set(index, chunk);
      }

      // Update chunk with new data
      if (toolCall.id) {
        channel.appendLine(`Setting chunk ID: ${toolCall.id}`);
        chunk.id = toolCall.id;
      }
      if (toolCall.type) {
        channel.appendLine(`Setting chunk type: ${toolCall.type}`);
        chunk.type = toolCall.type;
      }
      if (toolCall.function?.name) {
        channel.appendLine(`Setting chunk name: ${toolCall.function.name}`);
        chunk.name = toolCall.function.name;
      }
      if (toolCall.function?.arguments) {
        channel.appendLine(`Appending arguments: ${toolCall.function.arguments}`);
        chunk.arguments += toolCall.function.arguments;
      }

      channel.appendLine(`Current chunk state: ${JSON.stringify(chunk, null, 2)}`);
      channel.appendLine(`Is JSON complete? ${this.isCompleteJSON(chunk.arguments)}`);

      // Check if tool call is complete
      if (chunk.id && chunk.name && this.isCompleteJSON(chunk.arguments)) {
        try {
          const args = chunk.arguments ? JSON.parse(chunk.arguments) : {};
          channel.appendLine(
            `Creating tool call part: ${chunk.name} with args: ${JSON.stringify(args)}`
          );
          const toolCallPart = new LanguageModelToolCallPart(chunk.id, chunk.name, args);
          completedToolCalls.push(toolCallPart);
          toolCallChunks.delete(index);
          channel.appendLine('Tool call completed and added to results');
        } catch (parseError) {
          channel.appendLine(`Failed to parse tool arguments: ${parseError}`);
          channel.appendLine(`Arguments that failed to parse: ${chunk.arguments}`);
        }
      } else {
        channel.appendLine(
          `Tool call not yet complete - missing: ${JSON.stringify({
            hasId: !!chunk.id,
            hasName: !!chunk.name,
            hasCompleteJSON: this.isCompleteJSON(chunk.arguments),
          })}`
        );
      }
    }

    channel.appendLine(`Returning ${completedToolCalls.length} completed tool calls`);
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
      channel.appendLine('JSON string is empty or null');
      return false;
    }

    try {
      JSON.parse(jsonString);
      channel.appendLine('JSON is valid and complete');
      return true;
    } catch (error) {
      channel.appendLine(`JSON is incomplete or invalid: ${error} JSON: ${jsonString}`);
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

/**
 * Registers GitHub Copilot models with the LM API when authenticated.
 */
export async function registerModelsWithLMAPI(
  config: CopilotChatConfig,
  authManager: CopilotAuthManager
): Promise<void> {
  channel.appendLine('Starting model registration with LM API');

  // Note: getExtensionById() exists in coc.nvim implementation but not in type definitions
  // biome-ignore lint/suspicious/noExplicitAny: coc.nvim API limitation - getExtensionById exists at runtime
  const lmApiExtension: Extension<LmApi> = (extensions as any).getExtensionById(
    '@statiolake/coc-lm-api'
  );
  if (!lmApiExtension?.exports) {
    throw new Error('LM API extension not found or not activated');
  }
  const lmApi: LmApi = lmApiExtension.exports;
  channel.appendLine('Successfully obtained LM API reference');

  // Initialize GitHub Copilot model manager
  channel.appendLine('Creating configuration and model manager');
  const modelManager = new GitHubCopilotModelManager(config, authManager);

  channel.appendLine('Fetching available models');
  const models = await modelManager.getModels();
  channel.appendLine(`Found ${models.length} models`);

  // Register each model with LM API
  for (const model of models) {
    channel.appendLine(`Registering model ${model.id}`);
    const chatModel = new CopilotLanguageModelChat(model, config, authManager);

    lmApi.registerChatModel(chatModel);
    channel.appendLine(`Successfully registered model ${model.id}`);
  }

  channel.appendLine(`Registered ${models.length} models with LM API`);
}
