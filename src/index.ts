import type { LmApi } from '@statiolake/coc-lm-api';
import type { Extension, ExtensionContext } from 'coc.nvim';
import {
  commands,
  extensions,
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  type StatusBarItem,
  services,
  window,
  workspace,
} from 'coc.nvim';
import { z } from 'zod';
import { CopilotLanguageModelChat } from './chat';
import { CopilotChatConfig } from './config';
import { GitHubCopilotModelManager } from './models';

// Zod schemas for GitHub Copilot Language Server - these are the source of truth
const SignInCommandSchema = z.object({
  command: z.string(),
  arguments: z.array(z.unknown()),
  title: z.string(),
});

const SignInResultSchema = z.object({
  userCode: z.string(),
  command: SignInCommandSchema,
});

// Export inferred types
export type SignInCommand = z.infer<typeof SignInCommandSchema>;
export type SignInResult = z.infer<typeof SignInResultSchema>;

export interface StatusNotification {
  message: string;
  kind: 'Normal' | 'Error' | 'Warning' | 'Inactive';
  busy?: boolean;
}

// Auth Manager for language server authentication
export class CopilotAuthManager {
  private client: LanguageClient;
  private isSignedIn = false;
  private user: string | undefined;
  private statusBarItem: StatusBarItem;
  private onStatusChangeCallback?: (isSignedIn: boolean) => void;

  constructor(client: LanguageClient) {
    this.client = client;
    this.statusBarItem = window.createStatusBarItem(0, { progress: false });
    this.updateStatusBar();

    this.client.onNotification('didChangeStatus', (params: StatusNotification) => {
      console.log('GitHub Copilot: Status notification received:', params);
      const wasSignedIn = this.isSignedIn;

      if (params.kind === 'Normal') {
        this.isSignedIn = true;
        if (params.message) {
          const match = params.message.match(/(?:signed in|logged in|authenticated)\s+as\s+(.+)/i);
          if (match) {
            this.user = match[1].trim();
          }
        }
      } else if (params.kind === 'Error' && params.message?.toLowerCase().includes('not signed')) {
        this.isSignedIn = false;
        this.user = undefined;
      }

      this.updateStatusBar();

      // Trigger callback if sign-in status changed
      if (wasSignedIn !== this.isSignedIn && this.onStatusChangeCallback) {
        console.log(
          `GitHub Copilot: Auth status changed from ${wasSignedIn} to ${this.isSignedIn}`
        );
        this.onStatusChangeCallback(this.isSignedIn);
      }
    });
  }

  async signIn(): Promise<boolean> {
    try {
      const rawResult = await this.client.sendRequest('signIn', {});
      const parseResult = SignInResultSchema.safeParse(rawResult);

      if (!parseResult.success) {
        throw new Error(`Invalid sign-in response format: ${parseResult.error.message}`);
      }

      const result = parseResult.data;

      if (result?.userCode) {
        const proceed = await window.showInformationMessage(
          `GitHub Copilot: Go to https://github.com/login/device and enter code: ${result.userCode}`,
          'Open Browser and Continue',
          'Copy Code'
        );

        if (proceed === 'Copy Code') {
          await this.copyToClipboard(result.userCode);
          window.showInformationMessage('GitHub Copilot: Code copied to clipboard');
          return false;
        }

        if (proceed === 'Open Browser and Continue') {
          try {
            await this.client.sendRequest('workspace/executeCommand', {
              command: result.command.command,
              arguments: result.command.arguments,
            });
          } catch (_commandError) {
            // Silently continue if command fails
          }

          const success = await this.pollForSignIn();
          if (success) {
            const userDisplay = this.user ? ` as ${this.user}` : '';
            window.showInformationMessage(`GitHub Copilot: Successfully signed in${userDisplay}`);
            return true;
          }
          window.showErrorMessage('GitHub Copilot: Authentication timed out. Please try again.');
        }
      }
    } catch (error) {
      window.showErrorMessage(`GitHub Copilot: Sign in failed - ${error}`);
    }
    return false;
  }

  async signOut(): Promise<void> {
    try {
      await this.client.sendRequest('signOut', {});
      this.isSignedIn = false;
      this.user = undefined;
      window.showInformationMessage('GitHub Copilot: Signed out');
    } catch (error) {
      window.showErrorMessage(`GitHub Copilot: Sign out failed - ${error}`);
    }
  }

  isAuthenticated(): boolean {
    return this.isSignedIn;
  }

  getUser(): string | undefined {
    return this.user;
  }

  onStatusChange(callback: (isSignedIn: boolean) => void): void {
    this.onStatusChangeCallback = callback;
  }

  private updateStatusBar(): void {
    if (this.isSignedIn) {
      const userDisplay = this.user ? ` (${this.user})` : '';
      this.statusBarItem.text = `Copilot: Ready${userDisplay}`;
    } else {
      this.statusBarItem.text = 'Copilot: N/A';
    }
    this.statusBarItem.show();
  }

  dispose(): void {
    this.statusBarItem.dispose();
  }

  private async copyToClipboard(text: string): Promise<void> {
    try {
      await workspace.nvim.call('setreg', ['+', text]);
    } catch (_error) {
      // Failed to copy to clipboard
    }
  }

  private async pollForSignIn(): Promise<boolean> {
    const maxAttempts = 120;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      if (this.isSignedIn) return true;
    }
    return false;
  }
}

// Language Client creation and configuration
export function createLanguageClient(context: ExtensionContext): LanguageClient {
  const config = workspace.getConfiguration('copilot');

  const serverOptions: ServerOptions = {
    command: 'node',
    args: [
      context.asAbsolutePath(
        'node_modules/@github/copilot-language-server/dist/language-server.js'
      ),
      '--stdio',
    ],
    options: { env: process.env },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: ['*'],
    initializationOptions: {
      editorInfo: { name: 'coc.nvim', version: '1.0.0' },
      editorPluginInfo: { name: 'coc-github-copilot', version: '1.0.0' },
    },
    outputChannelName: 'GitHub Copilot',
  };

  const traceLevel = config.get('trace.server', 'off');
  if (traceLevel !== 'off') {
    clientOptions.outputChannel = window.createOutputChannel('GitHub Copilot Trace');
  }

  return new LanguageClient('copilot', 'GitHub Copilot', serverOptions, clientOptions);
}

export async function configureClient(client: LanguageClient): Promise<void> {
  const config = workspace.getConfiguration('copilot');

  await client.sendNotification('workspace/didChangeConfiguration', {
    settings: {
      http: {
        proxy: config.get('http.proxy', ''),
        proxyStrictSSL: config.get('http.proxyStrictSSL', true),
      },
      telemetry: { telemetry: config.get('telemetry.telemetryLevel', 'all') },
    },
  });
}

// Main suggestion functionality initialization
export async function initializeLanguageClient(context: ExtensionContext): Promise<LanguageClient> {
  const copilotClient = createLanguageClient(context);
  context.subscriptions.push(services.registerLanguageClient(copilotClient));

  await copilotClient.onReady();
  await configureClient(copilotClient);

  return copilotClient;
}

/**
 * Registers GitHub Copilot models with the LM API when authenticated.
 */
async function registerModelsWithLMAPI(): Promise<void> {
  console.log('GitHub Copilot: Starting model registration with LM API');

  // Note: getExtensionById() exists in coc.nvim implementation but not in type definitions
  // biome-ignore lint/suspicious/noExplicitAny: coc.nvim API limitation - getExtensionById exists at runtime
  const lmApiExtension: Extension<LmApi> = (extensions as any).getExtensionById(
    '@statiolake/coc-lm-api'
  );
  if (!lmApiExtension?.exports) {
    throw new Error('LM API extension not found or not activated');
  }
  const lmApi: LmApi = lmApiExtension.exports;
  console.log('GitHub Copilot: Successfully obtained LM API reference');

  // Initialize GitHub Copilot model manager
  console.log('GitHub Copilot: Creating configuration and model manager');
  const config = new CopilotChatConfig();
  const modelManager = new GitHubCopilotModelManager(config);

  console.log('GitHub Copilot: Fetching available models');
  const models = await modelManager.getModels();
  console.log(`GitHub Copilot: Found ${models.length} models`);

  // Register each model with LM API
  for (const model of models) {
    console.log(`GitHub Copilot: Registering model ${model.id}`);
    const chatModel = new CopilotLanguageModelChat(model, config, () => modelManager.getApiToken());

    lmApi.registerChatModel(chatModel);
    console.log(`GitHub Copilot: Successfully registered model ${model.id}`);
  }

  console.log(`GitHub Copilot: Registered ${models.length} models with LM API`);
}

/**
 * Handles authentication status changes and manages model registration.
 */
function setupAuthStatusHandler(authManager: CopilotAuthManager): void {
  authManager.onStatusChange(async (isSignedIn: boolean) => {
    if (isSignedIn) {
      console.log('GitHub Copilot: Authenticated, starting model registration');
      try {
        await registerModelsWithLMAPI();
      } catch (error) {
        console.log('GitHub Copilot: Failed to register models after authentication:', error);
        window.showErrorMessage(`GitHub Copilot: Failed to register models - ${error}`);
      }
    } else {
      console.log('GitHub Copilot: Not authenticated, skipping model registration');
    }
  });
}

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
  console.log('GitHub Copilot extension activation started');

  console.log('GitHub Copilot: Initializing language client');
  const client = await initializeLanguageClient(context);
  console.log('GitHub Copilot: Language client initialized');

  console.log('GitHub Copilot: Setting up authentication manager');
  const authManager = new CopilotAuthManager(client);
  context.subscriptions.push(authManager);

  console.log('GitHub Copilot: Registering commands');
  registerCommands(context, authManager);

  console.log('GitHub Copilot: Setting up auth status handler');
  setupAuthStatusHandler(authManager);

  // Schedule model registration after CocNvimInit
  workspace.registerAutocmd({
    event: 'User CocNvimInit',
    callback: async () => {
      console.log('GitHub Copilot: CocNvimInit event received, starting model registration');
      // Try initial model registration if already authenticated
      if (authManager.isAuthenticated()) {
        console.log('GitHub Copilot: Already authenticated, attempting initial model registration');
        try {
          await registerModelsWithLMAPI();
        } catch (error) {
          console.log(
            'GitHub Copilot: Initial model registration failed (will retry on auth change):',
            error
          );
        }
      } else {
        console.log('GitHub Copilot: Not authenticated yet, waiting for authentication');
      }
    },
  });

  console.log('GitHub Copilot extension activation completed');
}
