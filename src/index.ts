import type { ExtensionContext } from 'coc.nvim';
import { commands, window, workspace } from 'coc.nvim';
import { CopilotAuthManager } from './auth';
import { registerModelsWithLMAPI } from './chat';
import { initializeLanguageClient } from './client';
import { CopilotChatConfig } from './config';
import { channel } from './log';

// Command registration
export function registerCommands(context: ExtensionContext, authManager: CopilotAuthManager): void {
  context.subscriptions.push(
    commands.registerCommand('copilot.signIn', () => authManager.signIn()),
    commands.registerCommand('copilot.signOut', () => authManager.signOut()),
    commands.registerCommand('copilot.status', () => {
      if (authManager.isAuthenticated()) {
        const user = authManager.getUser();
        const userDisplay = user ? ` as ${user}` : '';
        window.showInformationMessage(`GitHub Copilot: Signed in${userDisplay}`);
      } else {
        window.showInformationMessage('GitHub Copilot: Not signed in');
      }
    }),
    commands.registerCommand('copilot.enable', async () => {
      await workspace.getConfiguration().update('copilot.enable', true, true);
      window.showInformationMessage('GitHub Copilot: Enabled');
    }),
    commands.registerCommand('copilot.disable', async () => {
      await workspace.getConfiguration().update('copilot.enable', false, true);
      window.showInformationMessage('GitHub Copilot: Disabled');
    })
  );
}

export async function activate(context: ExtensionContext): Promise<void> {
  const config = new CopilotChatConfig();

  channel.appendLine('Initializing language client');
  const client = await initializeLanguageClient(context);

  channel.appendLine('Setting up authentication manager');
  const authManager = new CopilotAuthManager(client, config);
  context.subscriptions.push(authManager);

  channel.appendLine('Registering commands');
  registerCommands(context, authManager);

  channel.appendLine('Registering models');
  await registerModelsWithLMAPI(config, authManager);

  channel.appendLine('Extension activation completed');
}
