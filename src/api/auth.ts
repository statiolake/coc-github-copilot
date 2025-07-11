// OAuth token extraction and API token management

import * as os from 'node:os';
import * as path from 'node:path';
import { z } from 'zod';
import { LanguageModelError } from './types';

// Zod schemas for GitHub Copilot API - these are the source of truth
const ApiTokenResponseEndpointsSchema = z.object({
  api: z.string(),
});

const ApiTokenResponseSchema = z.object({
  token: z.string(),
  expires_at: z.number(),
  endpoints: ApiTokenResponseEndpointsSchema,
});

// Export inferred types
export type ApiTokenResponseEndpoints = z.infer<typeof ApiTokenResponseEndpointsSchema>;
export type ApiTokenResponse = z.infer<typeof ApiTokenResponseSchema>;

export interface ApiToken {
  apiKey: string;
  expiresAt: Date;
  apiEndpoint: string;
}

// Helper function to extract OAuth token from GitHub Copilot config files
export function extractOauthTokenFromConfig(
  configDir: string,
  domain = 'github.com'
): string | undefined {
  const fs = require('node:fs');
  const path = require('node:path');

  try {
    // First try apps.json (preferred for newer Copilot versions)
    const appsPath = path.join(configDir, 'apps.json');
    if (fs.existsSync(appsPath)) {
      const content = fs.readFileSync(appsPath, 'utf8');
      const token = extractOauthTokenFromApps(content, domain);
      if (token) return token;
    }

    // Fallback to hosts.json (for older Copilot versions)
    const hostsPath = path.join(configDir, 'hosts.json');
    if (fs.existsSync(hostsPath)) {
      const content = fs.readFileSync(hostsPath, 'utf8');
      return extractOauthTokenFromHosts(content, domain);
    }
  } catch {
    // Ignore errors
  }
  return undefined;
}

function extractOauthTokenFromApps(contents: string, domain: string): string | undefined {
  try {
    const data = JSON.parse(contents);

    // apps.json format: {"github.com:Iv1.b507a08c87ecfe98": {"user": "statiolake", "oauth_token": "<token>", "githubAppId": "Iv1.b507a08c87ecfe98"}}
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith(`${domain}:`) && typeof value === 'object' && value !== null) {
        const obj = value as Record<string, unknown>;
        if (obj.oauth_token && typeof obj.oauth_token === 'string') {
          return obj.oauth_token;
        }
      }
    }
  } catch {
    // Ignore JSON parse errors
  }
  return undefined;
}

function extractOauthTokenFromHosts(contents: string, domain: string): string | undefined {
  try {
    const data = JSON.parse(contents);

    // hosts.json format: {"github.com": {"oauth_token": "<token>", "user": "statiolake"}}
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith(domain) && typeof value === 'object' && value !== null) {
        const obj = value as Record<string, unknown>;
        if (obj.oauth_token && typeof obj.oauth_token === 'string') {
          return obj.oauth_token;
        }
      }
    }
  } catch {
    // Ignore JSON parse errors
  }
  return undefined;
}

export function getCopilotConfigDir(): string {
  if (process.platform === 'win32') {
    return path.join(os.homedir(), 'AppData', 'Local', 'github-copilot');
  }
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  const configDir = xdgConfigHome || path.join(os.homedir(), '.config');
  return path.join(configDir, 'github-copilot');
}

export async function requestApiToken(oauthToken: string, authUrl: string): Promise<ApiToken> {
  const response = await fetch(authUrl, {
    method: 'GET',
    headers: {
      Authorization: `token ${oauthToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw LanguageModelError.NoPermissions(`Failed to request API token: ${errorBody}`);
  }

  const rawData = await response.json();
  const parseResult = ApiTokenResponseSchema.safeParse(rawData);

  if (!parseResult.success) {
    throw LanguageModelError.NoPermissions(
      `Invalid API token response format: ${JSON.stringify(parseResult.error.issues, null, 2)}`
    );
  }

  const data = parseResult.data;

  return {
    apiKey: data.token,
    expiresAt: new Date(data.expires_at * 1000),
    apiEndpoint: data.endpoints.api,
  };
}
