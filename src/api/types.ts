// Language Model API Types - Maintains compatibility with VS Code lm namespace for extension interoperability

export type { CancellationToken, Disposable, Event } from 'coc.nvim';

import type { CancellationToken, Disposable, Event } from 'coc.nvim';

interface Thenable<T> extends PromiseLike<T> {}

export interface LMNamespace {
  readonly tools: readonly LanguageModelToolInformation[];
  readonly onDidChangeChatModels: Event<void>;
  selectChatModels(selector?: LanguageModelChatSelector): Thenable<LanguageModelChat[]>;
  registerTool<T>(name: string, tool: LanguageModelTool<T>): Disposable;
  invokeTool(
    name: string,
    options: LanguageModelToolInvocationOptions<object>,
    token?: CancellationToken
  ): Thenable<LanguageModelToolResult>;
}

export interface LanguageModelChatSelector {
  vendor?: string;
  family?: string;
  version?: string;
  id?: string;
}

export interface LanguageModelChat {
  readonly name: string;
  readonly id: string;
  readonly vendor: string;
  readonly family: string;
  readonly version: string;
  readonly maxInputTokens: number;
  sendRequest(
    messages: LanguageModelChatMessage[],
    options?: LanguageModelChatRequestOptions,
    token?: CancellationToken
  ): Thenable<LanguageModelChatResponse>;
  countTokens(text: string | LanguageModelChatMessage, token?: CancellationToken): Thenable<number>;
}

// Uses class structure to match VS Code API expectations exactly
export class LanguageModelChatMessage {
  role: LanguageModelChatMessageRole;
  content: Array<LanguageModelTextPart | LanguageModelToolResultPart | LanguageModelToolCallPart>;
  name: string | undefined;

  constructor(
    role: LanguageModelChatMessageRole,
    content:
      | string
      | Array<LanguageModelTextPart | LanguageModelToolResultPart | LanguageModelToolCallPart>,
    name?: string
  ) {
    this.role = role;
    this.name = name;

    if (typeof content === 'string') {
      this.content = [new LanguageModelTextPart(content)];
    } else {
      this.content = content;
    }
  }

  static User(
    content: string | Array<LanguageModelTextPart | LanguageModelToolResultPart>,
    name?: string
  ): LanguageModelChatMessage {
    return new LanguageModelChatMessage(LanguageModelChatMessageRole.User, content, name);
  }

  static Assistant(
    content: string | Array<LanguageModelTextPart | LanguageModelToolCallPart>,
    name?: string
  ): LanguageModelChatMessage {
    return new LanguageModelChatMessage(LanguageModelChatMessageRole.Assistant, content, name);
  }
}

export enum LanguageModelChatMessageRole {
  User = 1,
  Assistant = 2,
}

export interface LanguageModelChatRequestOptions {
  justification?: string;
  modelOptions?: { [name: string]: unknown };
  tools?: LanguageModelChatTool[];
  toolMode?: LanguageModelChatToolMode;
}

export interface LanguageModelChatResponse {
  stream: AsyncIterable<LanguageModelTextPart | LanguageModelToolCallPart | unknown>;
  text: AsyncIterable<string>;
}

export interface LanguageModelChatTool {
  name: string;
  description: string;
  inputSchema?: object | undefined;
}

export enum LanguageModelChatToolMode {
  Auto = 1,
  Required = 2,
}

export interface LanguageModelToolInformation {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: object;
}

export interface LanguageModelTool<T> {
  invoke(
    options: LanguageModelToolInvocationOptions<T>,
    token: CancellationToken
  ): Thenable<LanguageModelToolResult>;
}

export interface LanguageModelToolInvocationOptions<T> {
  readonly input: T;
  readonly toolInvocationToken: LanguageModelToolInvocationToken;
}

export interface LanguageModelToolInvocationToken {
  readonly requestId: string;
  readonly participantName: string;
  readonly command?: string;
}

export interface LanguageModelToolResult {
  readonly content: Array<LanguageModelTextPart | LanguageModelToolResultPart>;
}

// Combines tool metadata and implementation for convenience in agent tooling
export interface ToolInfo<T = object> extends LanguageModelToolInformation, LanguageModelTool<T> {}

export class LanguageModelTextPart {
  value: string;

  constructor(value: string) {
    this.value = value;
  }
}

export class LanguageModelToolResultPart {
  callId: string;
  content: Array<LanguageModelTextPart | unknown>;

  constructor(callId: string, content: Array<LanguageModelTextPart | unknown>) {
    this.callId = callId;
    this.content = content;
  }
}

export class LanguageModelToolCallPart {
  callId: string;
  name: string;
  input: object;

  constructor(callId: string, name: string, input: object) {
    this.callId = callId;
    this.name = name;
    this.input = input;
  }
}

export class LanguageModelError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'LanguageModelError';
    this.code = code;
  }

  static NoPermissions(message = 'No permissions to access language model'): LanguageModelError {
    return new LanguageModelError(message, 'NoPermissions');
  }

  static Blocked(message = 'Request was blocked'): LanguageModelError {
    return new LanguageModelError(message, 'Blocked');
  }

  static NotFound(message = 'Language model not found'): LanguageModelError {
    return new LanguageModelError(message, 'NotFound');
  }
}
