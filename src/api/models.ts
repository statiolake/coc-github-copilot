// Model-related types and model management

import fetch from 'node-fetch';
import {
  type ApiToken,
  extractOauthTokenFromConfig,
  getCopilotConfigDir,
  requestApiToken,
} from './auth';
import type { CopilotChatConfig } from './config';
import type { LanguageModelChat, LanguageModelChatSelector } from './types';
import { LanguageModelError } from './types';

const DEFAULT_MODEL_ID = 'gpt-4.1';

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

interface ModelSchema {
  data: Model[];
}

export class LanguageModelManager {
  private config: CopilotChatConfig;
  private oauthToken?: string;
  private apiToken?: ApiToken;
  private models?: Model[];

  constructor(config: CopilotChatConfig) {
    this.config = config;
    this.oauthToken = this.loadOauthToken();

    if (this.oauthToken) {
      this.updateModels().catch((error) => {
        console.error('Failed to load models:', error);
      });
    }
  }

  async selectChatModels(
    selector: LanguageModelChatSelector,
    createChatModel: (model: Model) => LanguageModelChat
  ): Promise<LanguageModelChat[]> {
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

    return filteredModels.map((model) => createChatModel(model));
  }

  async getApiToken(): Promise<ApiToken> {
    if (!this.oauthToken) {
      throw LanguageModelError.NoPermissions('No OAuth token available');
    }

    if (this.apiToken && this.apiToken.expiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
      return this.apiToken;
    }

    const tokenUrl = this.config.tokenUrl();
    this.apiToken = await requestApiToken(this.oauthToken, tokenUrl);
    return this.apiToken;
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
      const configDir = getCopilotConfigDir();
      return extractOauthTokenFromConfig(configDir, this.config.oauthDomain());
    } catch {
      // Ignore errors, return undefined
    }
    return undefined;
  }
}
