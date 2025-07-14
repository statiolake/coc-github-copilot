import type { ExtensionContext } from 'coc.nvim';
import { commands, window, workspace } from 'coc.nvim';
import { CopilotAuthManager } from './auth';
import { initializeLanguageClient } from './client';
import { CopilotChatConfig } from './config';

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

  console.log('GitHub Copilot: Initializing language client');
  const client = await initializeLanguageClient(context);

  console.log('GitHub Copilot: Setting up authentication manager');
  const authManager = new CopilotAuthManager(client, config);
  context.subscriptions.push(authManager);

  console.log('GitHub Copilot: Registering commands');
  registerCommands(context, authManager);

  // Schedule model registration after CocNvimInit and after the status is
  // changed to Ready, to ensure @statiolake/coc-lm-api extension is activated
  // and have access to the models.
  // We shouldn't wait for completion here. If we do, that will cause a
  // deadlock.

  workspace.registerAutocmd({
    event: 'User CocNvimInit',
    callback: () => {
      console.log('GitHub Copilot: received CocNvimInit event');
    },
  });
  // void Promise.all([
  //   new Promise<void>((resolve) => {
  //     workspace.registerAutocmd({
  //       event: 'User CocNvimInit',
  //       callback: () => {
  //         console.log('GitHub Copilot: received CocNvimInit event');
  //         resolve();
  //       },
  //     });
  //   }),
  //   // new Promise<void>((resolve) => {
  //   //   if (authManager.isAuthenticated()) {
  //   //     resolve();
  //   //     return;
  //   //   }
  //   //
  //   //   authManager.onStatusChange((isSignedIn: boolean) => {
  //   //     if (isSignedIn) {
  //   //       console.log('GitHub Copilot: User signed in');
  //   //       resolve();
  //   //     }
  //   //   });
  //   // }),
  // ]).then(async () => {
  //   console.log('GitHub Copilot: Registering models');
  //   await registerModelsWithLMAPI(config, authManager);
  // });

  console.log('GitHub Copilot extension activation completed');
}
