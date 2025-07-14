class CopilotChatConfig {
  private readonly _baseUrl: string;
  private readonly _oauthDomain: string;

  constructor(
    opts: {
      baseUrl?: string;
      oauthDomain?: string;
    } = {}
  ) {
    this._baseUrl = opts.baseUrl || 'https://api.github.com';
    this._oauthDomain = opts.oauthDomain || 'github.com';
  }

  baseUrl(): string {
    return this._baseUrl;
  }

  oauthDomain(): string {
    return this._oauthDomain;
  }

  tokenUrl(): string {
    return `${this._baseUrl}/copilot_internal/v2/token`;
  }

  modelsUrlFromEndpoint(endpoint: string): string {
    return `${endpoint}/models`;
  }

  completionsUrlFromEndpoint(endpoint: string): string {
    return `${endpoint}/chat/completions`;
  }
}

export { CopilotChatConfig };
