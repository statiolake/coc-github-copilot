// Language Model API implementation

import * as os from 'node:os';
import * as path from 'node:path';
import fetch, { type Response } from 'node-fetch';
import type {
  CancellationToken,
  LanguageModelChat,
  LanguageModelChatMessage,
  LanguageModelChatRequestOptions,
  LanguageModelChatResponse,
  LanguageModelChatSelector,
  LMNamespace,
} from './types';
import { LanguageModelError, LanguageModelTextPart, LanguageModelToolCallPart } from './types';

const DEFAULT_MODEL_ID = 'gpt-4.1';

// Internal configuration types for GitHub Copilot
export interface CopilotChatConfiguration {
  enterpriseUri?: string;
}

// Internal API types for GitHub Copilot communication
export enum ModelVendor {
  OpenAI = 'OpenAI',
  Google = 'Google',
  Anthropic = 'Anthropic',
}

export interface ModelCapabilities {
  family: string;
  limits: ModelLimits;
  supports: ModelSupportedFeatures;
}

export interface ModelLimits {
  maxContextWindowTokens: number;
  maxOutputTokens: number;
  maxPromptTokens: number;
}

export interface ModelSupportedFeatures {
  streaming: boolean;
  toolCalls: boolean;
  parallelToolCalls: boolean;
  vision: boolean;
}

export interface ModelPolicy {
  state: string;
}

export interface Model {
  capabilities: ModelCapabilities;
  id: string;
  name: string;
  policy?: ModelPolicy;
  vendor: ModelVendor;
  modelPickerEnabled: boolean;
}

export interface ApiTokenResponse {
  token: string;
  expiresAt: number;
  endpoints: ApiTokenResponseEndpoints;
}

export interface ApiTokenResponseEndpoints {
  api: string;
}

export interface ApiToken {
  apiKey: string;
  expiresAt: Date;
  apiEndpoint: string;
}

interface ModelSchema {
  data: Model[];
}

// GitHub Copilot configuration with logic
export class CopilotChatConfig {
  constructor(public config: CopilotChatConfiguration = {}) {}

  tokenUrl(): string {
    if (this.config.enterpriseUri) {
      const domain = this.parseDomain(this.config.enterpriseUri);
      return `https://api.${domain}/copilot_internal/v2/token`;
    }
    return 'https://api.github.com/copilot_internal/v2/token';
  }

  oauthDomain(): string {
    if (this.config.enterpriseUri) {
      return this.parseDomain(this.config.enterpriseUri);
    }
    return 'github.com';
  }

  apiUrlFromEndpoint(endpoint: string): string {
    return `${endpoint}/chat/completions`;
  }

  modelsUrlFromEndpoint(endpoint: string): string {
    return `${endpoint}/models`;
  }

  private parseDomain(enterpriseUri: string): string {
    const uri = enterpriseUri.replace(/\/$/, '');

    if (uri.startsWith('https://')) {
      return uri.substring(8).split('/')[0];
    }
    if (uri.startsWith('http://')) {
      return uri.substring(7).split('/')[0];
    }
    return uri.split('/')[0];
  }
}

// Helper function to extract OAuth token from GitHub Copilot config files
export function extractOauthTokenFromConfig(
  configDir: string,
  domain = 'github.com'
): string | undefined {
  const fs = require('node:fs');
  const path = require('node:path');

  try {
    // First try apps.json (preferred for newer Copilot versions)
    const appsPath = path.join(configDir, 'apps.json');
    if (fs.existsSync(appsPath)) {
      const content = fs.readFileSync(appsPath, 'utf8');
      const token = extractOauthTokenFromApps(content, domain);
      if (token) return token;
    }

    // Fallback to hosts.json (for older Copilot versions)
    const hostsPath = path.join(configDir, 'hosts.json');
    if (fs.existsSync(hostsPath)) {
      const content = fs.readFileSync(hostsPath, 'utf8');
      return extractOauthTokenFromHosts(content, domain);
    }
  } catch {
    // Ignore errors
  }
  return undefined;
}

function extractOauthTokenFromApps(contents: string, domain: string): string | undefined {
  try {
    const data = JSON.parse(contents);

    // apps.json format: {"github.com:Iv1.b507a08c87ecfe98": {"user": "statiolake", "oauth_token": "<token>", "githubAppId": "Iv1.b507a08c87ecfe98"}}
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith(`${domain}:`) && typeof value === 'object' && value !== null) {
        const obj = value as Record<string, unknown>;
        if (obj.oauth_token && typeof obj.oauth_token === 'string') {
          return obj.oauth_token;
        }
      }
    }
  } catch {
    // Ignore JSON parse errors
  }
  return undefined;
}

function extractOauthTokenFromHosts(contents: string, domain: string): string | undefined {
  try {
    const data = JSON.parse(contents);

    // hosts.json format: {"github.com": {"oauth_token": "<token>", "user": "statiolake"}}
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith(domain) && typeof value === 'object' && value !== null) {
        const obj = value as Record<string, unknown>;
        if (obj.oauth_token && typeof obj.oauth_token === 'string') {
          return obj.oauth_token;
        }
      }
    }
  } catch {
    // Ignore JSON parse errors
  }
  return undefined;
}

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

class CopilotLanguageModelChat implements LanguageModelChat {
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
        text: this.createTextIterator(response, token as unknown as AbortSignal),
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
    response: Response,
    token?: CancellationToken
  ): AsyncIterable<LanguageModelTextPart | LanguageModelToolCallPart | unknown> {
    if (!response.body) return;

    const reader = (response.body as unknown as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        if (token?.isCancellationRequested) return;

        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (token?.isCancellationRequested) return;

          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') return;

          try {
            const event: ResponseEvent = JSON.parse(data);
            const content = event.choices[0]?.delta?.content;
            if (content) {
              yield new LanguageModelTextPart(content);
            }

            const toolCalls = event.choices[0]?.delta?.toolCalls;
            if (toolCalls && Array.isArray(toolCalls)) {
              for (const toolCall of toolCalls) {
                const tc = toolCall as {
                  id?: string;
                  function?: { name?: string; arguments?: string };
                };
                if (tc.id && tc.function) {
                  yield new LanguageModelToolCallPart(
                    tc.id,
                    tc.function.name || '',
                    JSON.parse(tc.function.arguments || '{}')
                  );
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
    response: Response,
    token?: AbortSignal
  ): AsyncIterable<string> {
    for await (const part of this.createStreamIterator(
      response,
      token as unknown as CancellationToken
    )) {
      if (part instanceof LanguageModelTextPart) {
        yield part.value;
      }
    }
  }
}

class LanguageModelManager {
  private config: CopilotChatConfig;
  private oauthToken?: string;
  private apiToken?: ApiToken;
  private models?: Model[];

  constructor(configuration: CopilotChatConfiguration = {}) {
    this.config = new CopilotChatConfig(configuration);
    this.oauthToken = this.loadOauthToken();

    if (this.oauthToken) {
      this.updateModels().catch((error) => {
        console.error('Failed to load models:', error);
      });
    }
  }

  async selectChatModels(selector: LanguageModelChatSelector = {}): Promise<LanguageModelChat[]> {
    if (!this.models) {
      if (!this.oauthToken) {
        throw LanguageModelError.NoPermissions(
          'Not authenticated. Please sign in to GitHub Copilot.'
        );
      }

      await this.updateModels();
    }

    if (!this.models) {
      throw LanguageModelError.NotFound('Failed to load models');
    }

    const filteredModels = this.models.filter((model) => {
      if (selector.vendor && model.vendor !== selector.vendor) return false;
      if (selector.family && !model.capabilities.family.includes(selector.family)) return false;
      if (selector.id && model.id !== selector.id) return false;
      if (selector.version && selector.version !== '1.0') return false; // Default version matching
      return true;
    });

    return filteredModels.map(
      (model) => new CopilotLanguageModelChat(model, this.config, () => this.getApiToken())
    );
  }

  private async getApiToken(): Promise<ApiToken> {
    if (!this.oauthToken) {
      throw LanguageModelError.NoPermissions('No OAuth token available');
    }

    if (this.apiToken && this.apiToken.expiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
      return this.apiToken;
    }

    const tokenUrl = this.config.tokenUrl();
    this.apiToken = await this.requestApiToken(this.oauthToken, tokenUrl);
    return this.apiToken;
  }

  private async requestApiToken(oauthToken: string, authUrl: string): Promise<ApiToken> {
    const response = await fetch(authUrl, {
      method: 'GET',
      headers: {
        Authorization: `token ${oauthToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw LanguageModelError.NoPermissions(`Failed to request API token: ${errorBody}`);
    }

    const data = (await response.json()) as ApiTokenResponse;
    return {
      apiKey: data.token,
      expiresAt: new Date(data.expiresAt * 1000),
      apiEndpoint: data.endpoints.api,
    };
  }

  private async updateModels(): Promise<void> {
    try {
      const apiToken = await this.getApiToken();
      const modelsUrl = this.config.modelsUrlFromEndpoint(apiToken.apiEndpoint);

      const response = await fetch(modelsUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiToken.apiKey}`,
          'Content-Type': 'application/json',
          'Copilot-Integration-Id': 'vscode-chat',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status}`);
      }

      const data = (await response.json()) as ModelSchema;

      // Filter and sort models
      let models = data.data.filter(
        (model) => model.modelPickerEnabled && (!model.policy || model.policy.state === 'enabled')
      );

      // Remove duplicates by family
      const seenFamilies = new Set<string>();
      models = models.filter((model) => {
        if (seenFamilies.has(model.capabilities.family)) {
          return false;
        }
        seenFamilies.add(model.capabilities.family);
        return true;
      });

      // Move default model to front
      const defaultModelIndex = models.findIndex((model) => model.id === DEFAULT_MODEL_ID);
      if (defaultModelIndex > 0) {
        const defaultModel = models.splice(defaultModelIndex, 1)[0];
        models.unshift(defaultModel);
      }

      this.models = models;
    } catch (error) {
      console.error('Failed to update models:', error);
      throw LanguageModelError.NotFound('Failed to load models');
    }
  }

  private loadOauthToken(): string | undefined {
    try {
      const configDir = this.getCopilotConfigDir();
      return extractOauthTokenFromConfig(configDir, this.config.oauthDomain());
    } catch {
      // Ignore errors, return undefined
    }
    return undefined;
  }

  private getCopilotConfigDir(): string {
    if (process.platform === 'win32') {
      return path.join(os.homedir(), 'AppData', 'Local', 'github-copilot');
    }
    const xdgConfigHome = process.env.XDG_CONFIG_HOME;
    const configDir = xdgConfigHome || path.join(os.homedir(), '.config');
    return path.join(configDir, 'github-copilot');
  }
}

// Create and export the LM namespace implementation
export function createLMNamespace(configuration: CopilotChatConfiguration = {}): LMNamespace {
  const manager = new LanguageModelManager(configuration);

  return {
    selectChatModels: async (selector: LanguageModelChatSelector = {}) => {
      return manager.selectChatModels(selector);
    },
  };
}
