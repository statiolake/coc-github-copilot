// Language Model API implementation - Main entry point

import { CopilotLanguageModelChat } from './chat';
import { CopilotChatConfig, type CopilotChatConfiguration } from './config';
import { LanguageModelManager } from './models';
import type { LanguageModelChatSelector, LMNamespace } from './types';

// Create and export the LM namespace implementation
export function createLMNamespace(configuration: CopilotChatConfiguration = {}): LMNamespace {
  const config = new CopilotChatConfig(configuration);
  const manager = new LanguageModelManager(config);

  return {
    selectChatModels: async (selector: LanguageModelChatSelector = {}) => {
      return manager.selectChatModels(
        selector,
        (model) => new CopilotLanguageModelChat(model, config, () => manager.getApiToken())
      );
    },
  };
}
