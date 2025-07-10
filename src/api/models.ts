// Model discovery and management from GitHub Copilot API

import { Emitter } from 'coc.nvim';
import { z } from 'zod';
import {
  type ApiToken,
  extractOauthTokenFromConfig,
  getCopilotConfigDir,
  requestApiToken,
} from './auth';
import type { CopilotChatConfig } from './config';
import type { Event, LanguageModelChat, LanguageModelChatSelector } from './types';
import { LanguageModelError } from './types';

const DEFAULT_MODEL_ID = 'gpt-4.1';

const ModelLimitsSchema = z.object({
  max_context_window_tokens: z.number().default(0),
  max_output_tokens: z.number().default(0),
  max_prompt_tokens: z.number().default(0),
});

const ModelSupportedFeaturesSchema = z.object({
  streaming: z.boolean().default(false),
  tool_calls: z.boolean().default(false),
  parallel_tool_calls: z.boolean().default(false),
  vision: z.boolean().default(false),
});

const ModelCapabilitiesSchema = z.object({
  family: z.string(),
  limits: ModelLimitsSchema.default({}),
  supports: ModelSupportedFeaturesSchema,
});

const ModelPolicySchema = z.object({
  state: z.string(),
});

const ModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  vendor: z.string(),
  capabilities: ModelCapabilitiesSchema,
  model_picker_enabled: z.boolean(),
  policy: ModelPolicySchema.optional(),
});

// Transforms raw API response, filtering out invalid models
const ModelResponseSchema = z.object({
  data: z.array(z.unknown()).transform((rawModels) => {
    const validModels: Model[] = [];

    for (const rawModel of rawModels) {
      const parseResult = ModelSchema.safeParse(rawModel);
      if (parseResult.success) {
        validModels.push(parseResult.data);
      }
    }

    return validModels;
  }),
});

export type ModelLimits = z.infer<typeof ModelLimitsSchema>;
export type ModelSupportedFeatures = z.infer<typeof ModelSupportedFeaturesSchema>;
export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>;
export type ModelPolicy = z.infer<typeof ModelPolicySchema>;
export type Model = z.infer<typeof ModelSchema>;
export type ModelResponse = z.infer<typeof ModelResponseSchema>;

export class LanguageModelManager {
  private config: CopilotChatConfig;
  private oauthToken?: string;
  private apiToken?: ApiToken;
  private models?: Model[];
  private _onDidChangeChatModels = new Emitter<void>();

  readonly onDidChangeChatModels: Event<void> = this._onDidChangeChatModels.event;

  constructor(config: CopilotChatConfig) {
    this.config = config;
    this.oauthToken = this.loadOauthToken();

    if (this.oauthToken) {
      this.updateModels().catch(() => {
        // Ignore initial load failures
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
      // Only support 'copilot' vendor from this extension
      if (selector?.vendor) {
        if (selector.vendor.toLowerCase() !== 'copilot') {
          return false;
        }
      }

      if (selector?.family) {
        if (!model.capabilities.family.toLowerCase().includes(selector.family.toLowerCase())) {
          return false;
        }
      }

      if (selector?.id && model.id !== selector.id) {
        return false;
      }

      // Currently all models are version 1.0
      if (selector?.version && selector.version !== '1.0') {
        return false;
      }

      return true;
    });

    return filteredModels.map((model) => createChatModel(model));
  }

  async getApiToken(): Promise<ApiToken> {
    if (!this.oauthToken) {
      throw LanguageModelError.NoPermissions('No OAuth token available');
    }

    // Refresh token if expires in less than 5 minutes
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
        const errorText = await response.text();
        throw new Error(`Failed to fetch models: ${response.status} - ${errorText}`);
      }

      const rawData = await response.json();
      const parseResult = ModelResponseSchema.safeParse(rawData);

      if (!parseResult.success) {
        throw LanguageModelError.NoPermissions(
          `Invalid model response format: ${parseResult.error.message}`
        );
      }

      const data = parseResult.data;

      // Filter enabled models only
      let models = data.data.filter((model) => {
        const isPickerEnabled = model.model_picker_enabled === true;
        const hasPolicyEnabled = !model.policy || model.policy.state === 'enabled';
        return isPickerEnabled && hasPolicyEnabled;
      });

      // Deduplicate by family
      const seenFamilies = new Set<string>();
      models = models.filter((model) => {
        const family = model.capabilities.family;
        if (seenFamilies.has(family)) {
          return false;
        }
        seenFamilies.add(family);
        return true;
      });

      // Prioritize default model
      const defaultModelIndex = models.findIndex((model) => model.id === DEFAULT_MODEL_ID);
      if (defaultModelIndex > 0) {
        const defaultModel = models.splice(defaultModelIndex, 1)[0];
        models.unshift(defaultModel);
      }

      this.models = models;
      this._onDidChangeChatModels.fire();
    } catch (_error) {
      throw LanguageModelError.NotFound('Failed to load models');
    }
  }

  dispose(): void {
    this._onDidChangeChatModels.dispose();
  }

  private loadOauthToken(): string | undefined {
    try {
      const configDir = getCopilotConfigDir();
      return extractOauthTokenFromConfig(configDir, this.config.oauthDomain());
    } catch {
      return undefined;
    }
  }
}
