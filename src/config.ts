// GitHub Copilot configuration management
export interface CopilotChatConfiguration {
  baseUrl?: string;
  oauthDomain?: string;
}

export class CopilotChatConfig {
  private config: Required<CopilotChatConfiguration>;

  constructor(configuration: CopilotChatConfiguration = {}) {
    this.config = {
      baseUrl: configuration.baseUrl || 'https://api.githubcopilot.com',
      oauthDomain: configuration.oauthDomain || 'github.com',
    };
  }

  baseUrl(): string {
    return this.config.baseUrl;
  }

  oauthDomain(): string {
    return this.config.oauthDomain;
  }

  tokenUrl(): string {
    return `${this.config.baseUrl}/chat/token`;
  }

  modelsUrlFromEndpoint(endpoint: string): string {
    return `${endpoint}/models`;
  }

  completionsUrlFromEndpoint(endpoint: string): string {
    return `${endpoint}/chat/completions`;
  }
}