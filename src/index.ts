import { ExtensionContext, LanguageClient, LanguageClientOptions, ServerOptions, services, workspace, commands, window } from 'coc.nvim';

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
    
    this.client.onNotification('didChangeStatus', (params: StatusNotification) => {
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
    });
  }

  async signIn(): Promise<boolean> {
    try {
      const result = await this.client.sendRequest('signIn', {}) as SignInResult;
      
      if (result?.userCode) {
        const proceed = await window.showInformationMessage(
          `GitHub Copilot: Go to https://github.com/login/device and enter code: ${result.userCode}`,
          'Open Browser and Continue'
        );
        
        if (proceed === 'Open Browser and Continue') {
          try {
            await this.client.sendRequest('workspace/executeCommand', {
              command: result.command.command,
              arguments: result.command.arguments
            });
          } catch (commandError) {
            // Silently continue if command fails
          }
          
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
    const maxAttempts = 120;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      if (this.isSignedIn) return true;
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
    options: { env: process.env }
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: ['*'],
    initializationOptions: {
      editorInfo: { name: 'coc.nvim', version: '1.0.0' },
      editorPluginInfo: { name: 'coc-github-copilot', version: '1.0.0' }
    },
    outputChannelName: 'GitHub Copilot'
  };

  const traceLevel = config.get('trace.server', 'off');
  if (traceLevel !== 'off') {
    clientOptions.outputChannel = window.createOutputChannel('GitHub Copilot Trace');
  }

  copilotClient = new LanguageClient('copilot', 'GitHub Copilot', serverOptions, clientOptions);
  context.subscriptions.push(services.registerLanguageClient(copilotClient));

  await copilotClient.onReady();
  
  await copilotClient.sendNotification('workspace/didChangeConfiguration', {
    settings: {
      http: {
        proxy: config.get('http.proxy', ''),
        proxyStrictSSL: config.get('http.proxyStrictSSL', true)
      },
      telemetry: { telemetryLevel: config.get('telemetry.telemetryLevel', 'all') }
    }
  });
  
  authManager = new CopilotAuthManager(copilotClient);

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

export async function deactivate(): Promise<void> {
}