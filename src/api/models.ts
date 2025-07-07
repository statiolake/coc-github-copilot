// Model-related types and model management

import { Emitter } from 'coc.nvim';
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
  maxContextWindowTokens?: number;
  maxOutputTokens?: number;
  maxPromptTokens?: number;
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
  model_picker_enabled: boolean;
}

interface ModelSchema {
  data: Model[];
}

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
      this.updateModels().catch((error) => {
        console.error('Failed to load models:', error);
      });
    }
  }

  async selectChatModels(
    selector: LanguageModelChatSelector,
    createChatModel: (model: Model) => LanguageModelChat
  ): Promise<LanguageModelChat[]> {
    console.log('selectChatModels called with selector:', selector);
    console.log('Current OAuth token status:', !!this.oauthToken);
    console.log('Current models status:', !!this.models, this.models?.length || 0);

    if (!this.models) {
      if (!this.oauthToken) {
        console.log('No OAuth token available, authentication required');
        throw LanguageModelError.NoPermissions(
          'Not authenticated. Please sign in to GitHub Copilot.'
        );
      }

      console.log('Models not loaded, attempting to update...');
      await this.updateModels();
    }

    if (!this.models) {
      console.log('Failed to load models after update attempt');
      throw LanguageModelError.NotFound('Failed to load models');
    }

    console.log(
      'Available models before filtering:',
      this.models.map((m) => ({
        id: m.id,
        name: m.name,
        vendor: m.vendor,
        family: m.capabilities.family,
      }))
    );

    const filteredModels = this.models.filter((model) => {
      console.log(
        `Filtering model: ${model.id} (vendor: ${model.vendor}, family: ${model.capabilities.family})`
      );

      // Vendor filtering - map VS Code vendors to GitHub Copilot vendors
      if (selector?.vendor) {
        const vendorMapping: Record<string, string> = {
          copilot: 'OpenAI',
          openai: 'OpenAI',
          anthropic: 'Anthropic',
          google: 'Google',
        };
        const mappedVendor = vendorMapping[selector.vendor.toLowerCase()];
        console.log(
          `Vendor filter: requested=${selector.vendor}, mapped=${mappedVendor}, model=${model.vendor}`
        );

        if (mappedVendor && model.vendor !== mappedVendor) {
          console.log(`Model ${model.id} filtered out by vendor mapping`);
          return false;
        }
        if (!mappedVendor && model.vendor !== selector.vendor) {
          console.log(`Model ${model.id} filtered out by direct vendor match`);
          return false;
        }
      }

      // Family filtering - exact match or partial match
      if (selector?.family) {
        if (!model.capabilities.family.toLowerCase().includes(selector.family.toLowerCase())) {
          console.log(`Model ${model.id} filtered out by family`);
          return false;
        }
      }

      // ID filtering - exact match
      if (selector?.id && model.id !== selector.id) {
        console.log(`Model ${model.id} filtered out by ID`);
        return false;
      }

      // Version filtering - currently all models are version 1.0
      if (selector?.version && selector.version !== '1.0') {
        console.log(`Model ${model.id} filtered out by version`);
        return false;
      }

      console.log(`Model ${model.id} passed all filters`);
      return true;
    });

    console.log(
      'Filtered models:',
      filteredModels.map((m) => ({ id: m.id, name: m.name, vendor: m.vendor }))
    );

    const chatModels = filteredModels.map((model) => createChatModel(model));
    console.log('Created chat models:', chatModels.length);

    return chatModels;
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
      console.log('updateModels: Getting API token...');
      const apiToken = await this.getApiToken();
      console.log('updateModels: Got API token, endpoint:', apiToken.apiEndpoint);

      const modelsUrl = this.config.modelsUrlFromEndpoint(apiToken.apiEndpoint);
      console.log('updateModels: Models URL:', modelsUrl);

      console.log('updateModels: Fetching models...');
      const response = await fetch(modelsUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiToken.apiKey}`,
          'Content-Type': 'application/json',
          'Copilot-Integration-Id': 'vscode-chat',
        },
      });

      console.log('updateModels: Response status:', response.status);
      if (!response.ok) {
        const errorText = await response.text();
        console.error('updateModels: Error response:', errorText);
        throw new Error(`Failed to fetch models: ${response.status} - ${errorText}`);
      }

      console.log('updateModels: Parsing response...');
      const data = (await response.json()) as ModelSchema;
      console.log('updateModels: Raw response data:', data);

      // Filter and sort models
      console.log('updateModels: Total models received:', data.data.length);
      console.log('updateModels: Sample model structure:', JSON.stringify(data.data[0], null, 2));

      let models = data.data.filter((model) => {
        // Zedエディタの実装を参考に正しくフィルタリング
        // model_picker_enabled が true かつ policy が存在しないか policy.state が 'enabled'
        const isPickerEnabled = model.model_picker_enabled === true;
        const hasPolicyEnabled = !model.policy || model.policy.state === 'enabled';
        const enabled = isPickerEnabled && hasPolicyEnabled;

        console.log(
          `Model ${model.id}: enabled=${enabled} (picker=${model.model_picker_enabled}, policy=${model.policy?.state || 'none'}, isPickerEnabled=${isPickerEnabled}, hasPolicyEnabled=${hasPolicyEnabled})`
        );
        return enabled;
      });
      console.log('updateModels: Models after filtering enabled:', models.length);

      // Remove duplicates by family (if capabilities exist)
      const seenFamilies = new Set<string>();
      models = models.filter((model) => {
        const family = model.capabilities.family;
        if (seenFamilies.has(family)) {
          console.log(`Removing duplicate family model: ${model.id} (family: ${family})`);
          return false;
        }
        seenFamilies.add(family);
        return true;
      });
      console.log('updateModels: Models after deduplication:', models.length);

      // Move default model to front
      const defaultModelIndex = models.findIndex((model) => model.id === DEFAULT_MODEL_ID);
      console.log('updateModels: Default model index:', defaultModelIndex);
      if (defaultModelIndex > 0) {
        const defaultModel = models.splice(defaultModelIndex, 1)[0];
        models.unshift(defaultModel);
        console.log('updateModels: Moved default model to front');
      }

      console.log(
        'updateModels: Final models list:',
        models.map((m) => ({
          id: m.id,
          name: m.name,
          vendor: m.vendor,
          family: m.capabilities.family,
        }))
      );

      this.models = models;
      this._onDidChangeChatModels.fire();
      console.log('updateModels: Successfully updated models and fired event');
    } catch (error) {
      console.error('updateModels: Failed to update models:', error);
      console.error(
        'updateModels: Error details:',
        error instanceof Error ? error.stack : 'No stack trace'
      );
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
      // Ignore errors, return undefined
    }
    return undefined;
  }
}
