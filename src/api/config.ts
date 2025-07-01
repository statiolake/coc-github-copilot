// GitHub Copilot configuration management

export interface CopilotChatConfiguration {
  enterpriseUri?: string;
}

export class CopilotChatConfig {
  constructor(public config: CopilotChatConfiguration = {}) {}

  tokenUrl(): string {
    if (this.config.enterpriseUri) {
      const domain = this.parseDomain(this.config.enterpriseUri);
      return `https://api.${domain}/copilot_internal/v2/token`;
    }
    return 'https://api.github.com/copilot_internal/v2/token';
  }

  oauthDomain(): string {
    if (this.config.enterpriseUri) {
      return this.parseDomain(this.config.enterpriseUri);
    }
    return 'github.com';
  }

  apiUrlFromEndpoint(endpoint: string): string {
    return `${endpoint}/chat/completions`;
  }

  modelsUrlFromEndpoint(endpoint: string): string {
    return `${endpoint}/models`;
  }

  private parseDomain(enterpriseUri: string): string {
    const uri = enterpriseUri.replace(/\/$/, '');

    if (uri.startsWith('https://')) {
      return uri.substring(8).split('/')[0];
    }
    if (uri.startsWith('http://')) {
      return uri.substring(7).split('/')[0];
    }
    return uri.split('/')[0];
  }
}
