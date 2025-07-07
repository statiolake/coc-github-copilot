// Language Model API Types - Fully compatible with VS Code lm namespace

export type { CancellationToken, Disposable, Event } from 'coc.nvim';

import type { CancellationToken, Disposable, Event } from 'coc.nvim';

interface Thenable<T> extends PromiseLike<T> {}

// Main lm namespace interface - this is what gets exported
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

// Chat model selector
export interface LanguageModelChatSelector {
  vendor?: string;
  family?: string;
  version?: string;
  id?: string;
}

// Chat model interface
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

// Chat message class - matches VS Code API exactly
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

// Chat message role enum
export enum LanguageModelChatMessageRole {
  User = 1,
  Assistant = 2,
}

// Request options
export interface LanguageModelChatRequestOptions {
  justification?: string;
  modelOptions?: { [name: string]: unknown };
  tools?: LanguageModelChatTool[];
  toolMode?: LanguageModelChatToolMode;
}

// Response interface
export interface LanguageModelChatResponse {
  stream: AsyncIterable<LanguageModelTextPart | LanguageModelToolCallPart | unknown>;
  text: AsyncIterable<string>;
}

// Tool interfaces
export interface LanguageModelChatTool {
  name: string;
  description: string;
  inputSchema?: object | undefined;
}

export enum LanguageModelChatToolMode {
  Auto = 1,
  Required = 2,
}

// Tool registration interfaces
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

// Message part classes - simple data classes
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

// Error class
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
