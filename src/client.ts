import {
  type ExtensionContext,
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  window,
  workspace,
} from 'coc.nvim';

export function createLanguageClient(context: ExtensionContext): LanguageClient {
  const config = workspace.getConfiguration('copilot');

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
    outputChannelName: 'GitHub Copilot',
  };

  const traceLevel = config.get('trace.server', 'off');
  if (traceLevel !== 'off') {
    clientOptions.outputChannel = window.createOutputChannel('GitHub Copilot Trace');
  }

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
      telemetry: { telemetryLevel: config.get('telemetry.telemetryLevel', 'all') },
    },
  });
}
