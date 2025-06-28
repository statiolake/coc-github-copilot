import { ExtensionContext, LanguageClient, services } from 'coc.nvim';
import { CopilotAuthManager } from './auth';
import { createLanguageClient, configureClient } from './client';
import { registerCommands } from './commands';

let copilotClient: LanguageClient | undefined;
let authManager: CopilotAuthManager;

export async function activate(context: ExtensionContext): Promise<void> {
  copilotClient = createLanguageClient(context);
  context.subscriptions.push(services.registerLanguageClient(copilotClient));

  await copilotClient.onReady();
  await configureClient(copilotClient);
  
  authManager = new CopilotAuthManager(copilotClient);
  registerCommands(context, authManager);
}

export async function deactivate(): Promise<void> {
}