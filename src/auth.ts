// GitHub Copilot authentication token management

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { ApiToken } from './types';

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
  console.log(`Parsing apps.json content for domain: ${domain}`);

  const data = JSON.parse(appsContent);
  console.log('apps.json keys found:', Object.keys(data));

  // apps.json format: {"github.com:Iv1.xxx": {"oauth_token": "...", "user": "..."}}
  for (const [key, value] of Object.entries(data)) {
    console.log(`Checking key: ${key}`);
    if (key.startsWith(`${domain}:`)) {
      console.log(`Found matching domain key: ${key}`);
      if (typeof value === 'object' && value !== null) {
        const obj = value as Record<string, unknown>;
        console.log('Object keys:', Object.keys(obj));
        if (obj.oauth_token && typeof obj.oauth_token === 'string') {
          console.log('Found oauth_token in object');
          return obj.oauth_token;
        }
        console.log('No oauth_token found in object');
      }
    }
  }

  console.log('No matching domain key found in apps.json');
  return undefined;
}

export function extractOauthTokenFromConfig(configDir: string, domain: string): string {
  console.log(
    `Attempting to extract OAuth token for domain: ${domain} from config dir: ${configDir}`
  );

  // Try apps.json first
  const appsPath = join(configDir, 'apps.json');
  console.log(`Checking for apps.json at: ${appsPath}`);

  if (existsSync(appsPath)) {
    console.log('apps.json exists, attempting to read');
    const appsContent = readFileSync(appsPath, 'utf-8');
    console.log(`apps.json content length: ${appsContent.length}`);

    const token = extractOauthTokenFromApps(appsContent, domain);
    if (token) {
      console.log('Successfully extracted OAuth token from apps.json');
      return token;
    }
    console.log('No token found in apps.json');
  } else {
    console.log('apps.json does not exist');
  }

  // Try hosts.json as fallback
  const hostsPath = join(configDir, 'hosts.json');
  console.log(`Checking for hosts.json at: ${hostsPath}`);

  if (existsSync(hostsPath)) {
    console.log('hosts.json exists, attempting to read');
    const hostsContent = readFileSync(hostsPath, 'utf-8');
    console.log(`hosts.json content length: ${hostsContent.length}`);

    const hostsConfig = HostsConfigSchema.parse(JSON.parse(hostsContent));

    const hostConfig = hostsConfig[domain];
    if (hostConfig?.oauth_token) {
      console.log('Successfully extracted OAuth token from hosts.json');
      return hostConfig.oauth_token;
    }
    console.log('No token found in hosts.json');
  } else {
    console.log('hosts.json does not exist');
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
