// GitHub Copilot model discovery and management
import { z } from 'zod';
import type { CopilotAuthManager } from './auth';
import type { CopilotChatConfig } from './config';

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
  data: z.array(ModelSchema),
});

type Model = z.infer<typeof ModelSchema>;

export class GitHubCopilotModelManager {
  private config: CopilotChatConfig;
  private authManager: CopilotAuthManager;
  private models?: Model[];

  constructor(config: CopilotChatConfig, authManager: CopilotAuthManager) {
    this.config = config;
    this.authManager = authManager;
  }

  async getModels(): Promise<Model[]> {
    if (this.models) return this.models;
    await this.updateModels();
    return this.models || [];
  }

  private async updateModels(): Promise<void> {
    const apiToken = await this.authManager.getChatApiToken();
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
  }
}

export type { Model };
