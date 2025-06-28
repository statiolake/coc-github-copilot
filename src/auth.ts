import { LanguageClient, window } from 'coc.nvim';
import { SignInResult, StatusNotification } from './types';

export class CopilotAuthManager {
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