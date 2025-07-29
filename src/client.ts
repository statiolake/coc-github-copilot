// GitHub Copilot Language Client setup and configuration

import type { ExtensionContext } from 'coc.nvim';
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  services,
  workspace,
} from 'coc.nvim';

// Language Client creation and configuration
export function createLanguageClient(context: ExtensionContext): LanguageClient {
  const serverOptions: ServerOptions = {
    command: 'node',
    args: [
      context.asAbsolutePath(
        'node_modules/@github/copilot-language-server/dist/language-server.js'
      ),
      '--stdio',
    ],
    options: { env: process.env },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: ['*'],
    initializationOptions: {
      editorInfo: { name: 'coc.nvim', version: '1.0.0' },
      editorPluginInfo: { name: 'coc-github-copilot', version: '1.0.0' },
    },
    outputChannelName: 'GitHub Copilot Language Server',
  };

  return new LanguageClient('copilot', 'GitHub Copilot', serverOptions, clientOptions);
}

export async function configureClient(client: LanguageClient): Promise<void> {
  const config = workspace.getConfiguration('copilot');

  await client.sendNotification('workspace/didChangeConfiguration', {
    settings: {
      http: {
        proxy: config.get('http.proxy', ''),
        proxyStrictSSL: config.get('http.proxyStrictSSL', true),
      },
      telemetry: { telemetry: config.get('telemetry.telemetryLevel', 'all') },
    },
  });
}

export async function initializeLanguageClient(context: ExtensionContext): Promise<LanguageClient> {
  const copilotClient = createLanguageClient(context);
  context.subscriptions.push(services.registerLanguageClient(copilotClient));

  await copilotClient.onReady();
  await configureClient(copilotClient);

  return copilotClient;
}
