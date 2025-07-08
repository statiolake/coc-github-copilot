// Chat implementation and streaming logic

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

// Internal types for GitHub Copilot API
interface CompletionRequest {
  intent: boolean;
  n: number;
  stream: boolean;
  temperature: number;
  model: string;
  messages: unknown[];
  tools?: unknown[];
  tool_choice?: string;
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
  tool_calls?: unknown[];
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
    this.maxInputTokens = model.capabilities.limits.maxPromptTokens || 128000;
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
        signal: token as unknown as AbortSignal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error('Chat API error response:', {
          status: response.status,
          statusText: response.statusText,
          body: errorBody,
          headers: response.headers
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
            await this.processLine(buffer.trim(), lineCount++);
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        
        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer
        
        for (const line of lines) {
          if (token?.isCancellationRequested) return;
          
          const result = await this.processLine(line, lineCount++);
          if (result === 'DONE') {
            console.log('createStreamIterator: Received [DONE], returning');
            return;
          } else if (result) {
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

  private async processLine(line: string, lineNum: number): Promise<LanguageModelTextPart | LanguageModelToolCallPart | 'DONE' | null> {
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
      const event: ResponseEvent = JSON.parse(data);
      console.log(`Line ${lineNum}: Parsed event:`, JSON.stringify(event, null, 2));
      
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
      if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
        console.log(`Line ${lineNum}: Found ${toolCalls.length} tool calls`);
        // Process the first tool call that has complete information
        const toolCall = toolCalls[0] as {
          id?: string;
          function?: { name?: string; arguments?: string };
          index?: number;
        };
        
        console.log(`Line ${lineNum}: Tool call details:`, toolCall);
        
        // Only yield when we have both id and function name (indicating a complete tool call start)
        if (toolCall.id && toolCall.function?.name) {
          try {
            // For streaming, arguments might be empty initially, so use empty object as default
            const argsString = toolCall.function.arguments || '{}';
            console.log(`Line ${lineNum}: Parsing tool call arguments: "${argsString}"`);
            const args = argsString ? JSON.parse(argsString) : {};
            console.log(`Line ${lineNum}: ✅ YIELDING TOOL CALL - id: ${toolCall.id}, name: ${toolCall.function.name}, args:`, args);
            const toolCallPart = new LanguageModelToolCallPart(toolCall.id, toolCall.function.name, args);
            console.log(`Line ${lineNum}: Created LanguageModelToolCallPart:`, toolCallPart);
            return toolCallPart;
          } catch (parseError) {
            console.log(`Line ${lineNum}: Failed to parse tool call arguments:`, parseError, 'arguments were:', toolCall.function.arguments);
            // Yield with empty args if parsing fails
            const toolCallPart = new LanguageModelToolCallPart(toolCall.id, toolCall.function.name, {});
            console.log(`Line ${lineNum}: ✅ YIELDING TOOL CALL (with empty args) - id: ${toolCall.id}, name: ${toolCall.function.name}`);
            return toolCallPart;
          }
        } else {
          console.log(`Line ${lineNum}: Tool call incomplete - id: ${toolCall.id}, name: ${toolCall.function?.name}`);
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
