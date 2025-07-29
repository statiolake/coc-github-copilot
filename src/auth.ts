// GitHub Copilot authentication token management

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type LanguageClient, type StatusBarItem, window, workspace } from 'coc.nvim';
import { z } from 'zod';
import type { CopilotChatConfig } from './config';

// GitHub Copilot specific types
interface ApiToken {
  apiKey: string;
  apiEndpoint: string;
  expiresAt: Date;
}

export type { ApiToken };

// Original GitHub Copilot apps.json format: {"github.com:Iv1.xxx": {"oauth_token": "...", "user": "..."}}
// We parse this manually in extractOauthTokenFromApps instead of using a schema

const HostsConfigSchema = z.record(
  z.string(),
  z.object({
    oauth_token: z.string(),
    user: z.string(),
  })
);

const TokenResponseSchema = z.object({
  token: z.string(),
  expires_at: z.number(),
  endpoints: z.object({
    api: z.string(),
  }),
});

export function getCopilotConfigDir(): string {
  if (process.platform === 'win32') {
    return join(homedir(), 'AppData', 'Local', 'github-copilot');
  }
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  const configDir = xdgConfigHome || join(homedir(), '.config');
  return join(configDir, 'github-copilot');
}

function extractOauthTokenFromApps(appsContent: string, domain: string): string | undefined {
  const channel = window.createOutputChannel('GitHub Copilot');
  channel.appendLine(`Parsing apps.json content for domain: ${domain}`);

  const data = JSON.parse(appsContent);
  channel.appendLine(`apps.json keys found: ${Object.keys(data).join(', ')}`);

  // apps.json format: {"github.com:Iv1.xxx": {"oauth_token": "...", "user": "..."}}
  for (const [key, value] of Object.entries(data)) {
    channel.appendLine(`Checking key: ${key}`);
    if (key.startsWith(`${domain}:`)) {
      channel.appendLine(`Found matching domain key: ${key}`);
      if (typeof value === 'object' && value !== null) {
        const obj = value as Record<string, unknown>;
        channel.appendLine(`Object keys: ${Object.keys(obj).join(', ')}`);
        if (obj.oauth_token && typeof obj.oauth_token === 'string') {
          channel.appendLine('Found oauth_token in object');
          return obj.oauth_token;
        }
        channel.appendLine('No oauth_token found in object');
      }
    }
  }

  channel.appendLine('No matching domain key found in apps.json');
  return undefined;
}

export function extractOauthTokenFromConfig(configDir: string, domain: string): string {
  const channel = window.createOutputChannel('GitHub Copilot');
  channel.appendLine(`Attempting to extract OAuth token for domain: ${domain} from config dir: ${configDir}`);

  // Try apps.json first
  const appsPath = join(configDir, 'apps.json');
  channel.appendLine(`Checking for apps.json at: ${appsPath}`);

  if (existsSync(appsPath)) {
    channel.appendLine('apps.json exists, attempting to read');
    const appsContent = readFileSync(appsPath, 'utf-8');
    channel.appendLine(`apps.json content length: ${appsContent.length}`);

    const token = extractOauthTokenFromApps(appsContent, domain);
    if (token) {
      channel.appendLine('Successfully extracted OAuth token from apps.json');
      return token;
    }
    channel.appendLine('No token found in apps.json');
  } else {
    channel.appendLine('apps.json does not exist');
  }

  // Try hosts.json as fallback
  const hostsPath = join(configDir, 'hosts.json');
  channel.appendLine(`Checking for hosts.json at: ${hostsPath}`);

  if (existsSync(hostsPath)) {
    channel.appendLine('hosts.json exists, attempting to read');
    const hostsContent = readFileSync(hostsPath, 'utf-8');
    channel.appendLine(`hosts.json content length: ${hostsContent.length}`);

    const hostsConfig = HostsConfigSchema.parse(JSON.parse(hostsContent));

    const hostConfig = hostsConfig[domain];
    if (hostConfig?.oauth_token) {
      channel.appendLine('Successfully extracted OAuth token from hosts.json');
      return hostConfig.oauth_token;
    }
    channel.appendLine('No token found in hosts.json');
  } else {
    channel.appendLine('hosts.json does not exist');
  }

  throw new Error(`No OAuth token found for domain: ${domain}`);
}

export async function requestApiToken(oauthToken: string, tokenUrl: string): Promise<ApiToken> {
  const response = await fetch(tokenUrl, {
    method: 'GET',
    headers: {
      Authorization: `token ${oauthToken}`,
      'User-Agent': 'coc-github-copilot',
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get API token: ${response.status} - ${errorText}`);
  }

  const rawData = await response.json();
  const parseResult = TokenResponseSchema.safeParse(rawData);

  if (!parseResult.success) {
    throw new Error(`Invalid token response format: ${parseResult.error.message}`);
  }

  const data = parseResult.data;

  return {
    apiKey: data.token,
    apiEndpoint: data.endpoints.api,
    expiresAt: new Date(data.expires_at * 1000),
  };
}

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
  private apiToken?: ApiToken;
  private config: CopilotChatConfig;

  constructor(client: LanguageClient, config: CopilotChatConfig) {
    this.client = client;
    this.statusBarItem = window.createStatusBarItem(0, { progress: false });
    this.updateStatusBar();

    this.client.onNotification('didChangeStatus', (params: StatusNotification) => {
      const channel = window.createOutputChannel('GitHub Copilot');
      channel.appendLine(`Status notification received: ${JSON.stringify(params)}`);
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
        channel.appendLine(`Auth status changed from ${wasSignedIn} to ${this.isSignedIn}`);
        this.onStatusChangeCallback(this.isSignedIn);
      }
    });

    this.config = config;
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
    const oldCallback = this.onStatusChangeCallback;
    this.onStatusChangeCallback = (isSignedIn) => {
      oldCallback?.(isSignedIn);
      callback(isSignedIn);
    };
  }

  async getChatApiToken(): Promise<ApiToken> {
    // Refresh token if expires in less than 5 minutes
    if (this.apiToken && this.apiToken.expiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
      return this.apiToken;
    }

    const oauthToken = this.loadOauthToken();
    if (!oauthToken) {
      throw new Error('No OAuth token available');
    }

    const tokenUrl = this.config.tokenUrl();
    this.apiToken = await requestApiToken(oauthToken, tokenUrl);

    return this.apiToken;
  }

  private loadOauthToken(): string | undefined {
    try {
      const configDir = getCopilotConfigDir();
      return extractOauthTokenFromConfig(configDir, this.config.oauthDomain());
    } catch (e) {
      console.error('Failed to load OAuth token:', e);
      return undefined;
    }
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
