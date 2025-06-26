import { ExtensionContext, LanguageClient, LanguageClientOptions, ServerOptions, services, workspace, commands, window } from 'coc.nvim';
import * as path from 'path';

interface SignInResult {
  userCode: string;
  command: {
    command: string;
    arguments: any[];
    title: string;
  };
}

interface StatusNotification {
  message: string;
  kind: 'Normal' | 'Error' | 'Warning' | 'Inactive';
  busy?: boolean;
}

class CopilotAuthManager {
  private client: LanguageClient;
  private isSignedIn: boolean = false;
  private user: string | undefined;

  constructor(client: LanguageClient) {
    this.client = client;
    
    // Listen for status change notifications
    this.client.onNotification('didChangeStatus', (params: StatusNotification) => {
      // Update authentication status based on the kind
      if (params.kind === 'Normal') {
        this.isSignedIn = true;
        // Try to extract user from message
        if (params.message) {
          const match = params.message.match(/(?:signed in|logged in|authenticated)\s+as\s+(.+)/i);
          if (match) {
            this.user = match[1].trim();
          }
        }
      } else if (params.kind === 'Error') {
        this.isSignedIn = false;
        this.user = undefined;
      }
    });
  }

  async signIn(): Promise<boolean> {
    try {
      const result = await this.client.sendRequest('signIn', {}) as SignInResult;
      
      if (result && result.userCode) {
        // Show the user code to the user
        const proceed = await window.showInformationMessage(
          `GitHub Copilot: Go to https://github.com/login/device and enter code: ${result.userCode}`,
          'Open Browser and Continue'
        );
        
        if (proceed === 'Open Browser and Continue') {
          // Execute the finishDeviceFlow command
          try {
            await this.client.sendRequest('workspace/executeCommand', {
              command: result.command.command,
              arguments: result.command.arguments
            });
          } catch (commandError) {
            console.log('Failed to execute command:', commandError);
          }
          
          // Poll for authentication success
          const success = await this.pollForSignIn();
          if (success) {
            const userDisplay = this.user ? ` as ${this.user}` : '';
            window.showInformationMessage(`GitHub Copilot: Successfully signed in${userDisplay}`);
            return true;
          } else {
            window.showErrorMessage('GitHub Copilot: Authentication timed out. Please try again.');
          }
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

  private async pollForSignIn(): Promise<boolean> {
    const maxAttempts = 120; // 10 minutes with 5-second intervals
    let attempts = 0;

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      attempts++;

      if (this.isSignedIn) {
        return true;
      }
    }

    return false;
  }
}


let copilotClient: LanguageClient | undefined;
let authManager: CopilotAuthManager;

export async function activate(context: ExtensionContext): Promise<void> {
  const config = workspace.getConfiguration('copilot');
  
  const serverOptions: ServerOptions = {
    command: 'node',
    args: [
      context.asAbsolutePath('node_modules/@github/copilot-language-server/dist/language-server.js'),
      '--stdio'
    ],
    options: {
      env: {
        ...process.env,
      },
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: ['*'],
    initializationOptions: {
      editorInfo: {
        name: 'coc.nvim',
        version: '1.0.0'
      },
      editorPluginInfo: {
        name: 'coc-github-copilot',
        version: '1.0.0'
      }
    },
    outputChannelName: 'GitHub Copilot'
  };

  // Add tracing support
  const traceLevel = config.get('trace.server', 'off');
  if (traceLevel !== 'off') {
    clientOptions.outputChannel = window.createOutputChannel('GitHub Copilot Trace');
  }

  copilotClient = new LanguageClient(
    'copilot',
    'GitHub Copilot',
    serverOptions,
    clientOptions
  );

  context.subscriptions.push(services.registLanguageClient(copilotClient));

  // Wait for client to be ready
  await copilotClient.onReady();
  
  // Send initial configuration
  await copilotClient.sendNotification('workspace/didChangeConfiguration', {
    settings: {
      http: {
        proxy: config.get('http.proxy', ''),
        proxyStrictSSL: config.get('http.proxyStrictSSL', true)
      },
      telemetry: {
        telemetryLevel: config.get('telemetry.telemetryLevel', 'all')
      }
    }
  });
  
  // Initialize auth manager
  authManager = new CopilotAuthManager(copilotClient);

  // Register commands
  context.subscriptions.push(
    commands.registerCommand('copilot.signIn', async () => {
      await authManager.signIn();
    }),
    commands.registerCommand('copilot.signOut', async () => {
      await authManager.signOut();
    }),
    commands.registerCommand('copilot.status', async () => {
      if (authManager.isAuthenticated()) {
        const user = authManager.getUser();
        const userDisplay = user ? ` as ${user}` : '';
        window.showInformationMessage(`GitHub Copilot: Signed in${userDisplay}`);
      } else {
        window.showInformationMessage('GitHub Copilot: Not signed in');
      }
    }),
    commands.registerCommand('copilot.enable', async () => {
      const config = workspace.getConfiguration();
      await config.update('copilot.enable', true, true);
      window.showInformationMessage('GitHub Copilot: Enabled');
    }),
    commands.registerCommand('copilot.disable', async () => {
      const config = workspace.getConfiguration();
      await config.update('copilot.enable', false, true);
      window.showInformationMessage('GitHub Copilot: Disabled');
    })
  );

  // Auto sign-in on activation if not authenticated
  if (!authManager.isAuthenticated()) {
    window.showInformationMessage(
      'GitHub Copilot: Please sign in to use Copilot',
      'Sign In'
    ).then(selection => {
      if (selection === 'Sign In') {
        commands.executeCommand('copilot.signIn');
      }
    });
  }
}

export async function deactivate(): Promise<void> {
  // プラグインのクリーンアップ処理
}