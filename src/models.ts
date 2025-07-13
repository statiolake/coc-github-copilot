// GitHub Copilot model discovery and management
import { z } from 'zod';
import {
  type ApiToken,
  extractOauthTokenFromConfig,
  getCopilotConfigDir,
  requestApiToken,
} from './auth';
import type { CopilotChatConfig } from './config';
import type { Model } from './types';

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

export class GitHubCopilotModelManager {
  private config: CopilotChatConfig;
  private apiToken?: ApiToken;
  private models?: Model[];

  constructor(config: CopilotChatConfig) {
    this.config = config;
  }

  async getModels(): Promise<Model[]> {
    if (!this.models) {
      const oauthToken = this.loadOauthToken();
      if (!oauthToken) {
        throw new Error('Not authenticated. Please sign in to GitHub Copilot.');
      }
      await this.updateModels();
    }

    return this.models || [];
  }

  async getApiToken(): Promise<ApiToken> {
    const oauthToken = this.loadOauthToken();
    if (!oauthToken) {
      throw new Error('No OAuth token available');
    }

    // Refresh token if expires in less than 5 minutes
    if (this.apiToken && this.apiToken.expiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
      return this.apiToken;
    }

    const tokenUrl = this.config.tokenUrl();
    this.apiToken = await requestApiToken(oauthToken, tokenUrl);
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
        throw new Error(`Invalid model response format: ${parseResult.error.message}`);
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
    } catch (error) {
      console.log('Error in updateModels:', error);
      throw new Error(`Failed to load models: ${error}`);
    }
  }

  private loadOauthToken(): string | undefined {
    try {
      const configDir = getCopilotConfigDir();
      return extractOauthTokenFromConfig(configDir, this.config.oauthDomain());
    } catch (e) {
      console.error('Failed to load OAuth token:', e);
      return undefined;
    }
  }
}

export type { Model };
