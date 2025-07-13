// VS Code Language Model API compatible types for GitHub Copilot
export interface LanguageModelChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LanguageModelChatRequestOptions {
  messages: LanguageModelChatMessage[];
  tools?: LanguageModelTool[];
}

export interface LanguageModelChatResponse {
  stream: AsyncIterable<LanguageModelChatResponseFragment>;
}

export interface LanguageModelChatResponseFragment {
  index: number;
  part: LanguageModelChatResponseTextPart | LanguageModelChatResponseFunctionUsePart;
}

export interface LanguageModelChatResponseTextPart {
  kind: 'text';
  value: string;
}

export interface LanguageModelChatResponseFunctionUsePart {
  kind: 'function';
  name: string;
  parameters: object;
}

export interface LanguageModelChat {
  id: string;
  vendor: string;
  family: string;
  version: string;
  maxInputTokens: number;
  sendRequest(
    messages: LanguageModelChatMessage[],
    options?: LanguageModelChatRequestOptions,
    token?: CancellationToken
  ): Promise<LanguageModelChatResponse>;
}

export interface LanguageModelTool<T = unknown> {
  description: string;
  inputSchema: object;
  invoke(
    options: LanguageModelToolInvocationOptions<T>,
    token?: CancellationToken
  ): Promise<LanguageModelToolResult>;
}

export interface LanguageModelToolInvocationOptions<T = unknown> {
  input: T;
}

export interface LanguageModelToolResult {
  content: LanguageModelToolResultContent[];
}

export interface LanguageModelToolResultContent {
  kind: 'text' | 'image';
  value: string;
}

export interface CancellationToken {
  isCancellationRequested: boolean;
  onCancellationRequested: Event<void>;
}

export type Event<T> = (listener: (e: T) => void) => Disposable;

export interface Disposable {
  dispose(): void;
}

export interface LanguageModelChatSelector {
  vendor?: string;
  family?: string;
  id?: string;
  version?: string;
}

// GitHub Copilot specific types
export interface ApiToken {
  apiKey: string;
  apiEndpoint: string;
  expiresAt: Date;
}

export interface Model {
  id: string;
  name: string;
  vendor: string;
  capabilities: {
    family: string;
    limits: {
      max_context_window_tokens: number;
      max_output_tokens: number;
      max_prompt_tokens: number;
    };
    supports: {
      streaming: boolean;
      tool_calls: boolean;
      parallel_tool_calls: boolean;
      vision: boolean;
    };
  };
  model_picker_enabled: boolean;
  policy?: {
    state: string;
  };
}
