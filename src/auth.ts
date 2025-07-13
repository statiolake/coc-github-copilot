// GitHub Copilot authentication token management
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { ApiToken } from './types';

export type { ApiToken };

const AppsConfigSchema = z.object({
  'github.com': z.object({
    oauth_token: z.string(),
  }),
});

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
  return join(homedir(), '.config', 'github-copilot');
}

export function extractOauthTokenFromConfig(configDir: string, domain: string): string {
  // Try apps.json first
  try {
    const appsPath = join(configDir, 'apps.json');
    const appsContent = readFileSync(appsPath, 'utf-8');
    const appsConfig = AppsConfigSchema.parse(JSON.parse(appsContent));
    
    if (domain === 'github.com' && appsConfig['github.com']?.oauth_token) {
      return appsConfig['github.com'].oauth_token;
    }
  } catch {
    // Try hosts.json
    try {
      const hostsPath = join(configDir, 'hosts.json');
      const hostsContent = readFileSync(hostsPath, 'utf-8');
      const hostsConfig = HostsConfigSchema.parse(JSON.parse(hostsContent));
      
      const hostConfig = hostsConfig[domain];
      if (hostConfig?.oauth_token) {
        return hostConfig.oauth_token;
      }
    } catch {
      // Both failed
    }
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