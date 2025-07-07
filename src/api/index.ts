// Language Model API implementation - Main entry point

import { CopilotLanguageModelChat } from './chat';
import { CopilotChatConfig, type CopilotChatConfiguration } from './config';
import { LanguageModelManager } from './models';
import { LanguageModelToolManager } from './tools';
import type {
  CancellationToken,
  Disposable,
  LanguageModelChatSelector,
  LanguageModelTool,
  LanguageModelToolInvocationOptions,
  LanguageModelToolResult,
  LMNamespace,
} from './types';

// Create and export the LM namespace implementation
export function createLMNamespace(configuration: CopilotChatConfiguration = {}): LMNamespace {
  const config = new CopilotChatConfig(configuration);
  const manager = new LanguageModelManager(config);
  const toolManager = new LanguageModelToolManager();

  return {
    get tools() {
      return toolManager.tools;
    },

    get onDidChangeChatModels() {
      return manager.onDidChangeChatModels;
    },

    selectChatModels: async (selector: LanguageModelChatSelector = {}) => {
      return manager.selectChatModels(
        selector,
        (model) => new CopilotLanguageModelChat(model, config, () => manager.getApiToken())
      );
    },

    registerTool: <T>(name: string, tool: LanguageModelTool<T>): Disposable => {
      return toolManager.registerTool(name, tool);
    },

    invokeTool: async (
      name: string,
      options: LanguageModelToolInvocationOptions<object>,
      token?: CancellationToken
    ): Promise<LanguageModelToolResult> => {
      return toolManager.invokeTool(name, options, token);
    },
  };
}
