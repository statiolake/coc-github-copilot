// Tool management for Language Model API

import { Emitter } from 'coc.nvim';
import type {
  CancellationToken,
  Disposable,
  Event,
  LanguageModelTool,
  LanguageModelToolInformation,
  LanguageModelToolInvocationOptions,
  LanguageModelToolResult,
} from './types';

export class LanguageModelToolManager {
  private registeredTools = new Map<string, LanguageModelTool<unknown>>();
  private _onDidChangeTools = new Emitter<void>();

  readonly onDidChangeTools: Event<void> = this._onDidChangeTools.event;

  get tools(): readonly LanguageModelToolInformation[] {
    return Array.from(this.registeredTools.entries()).map(([name, _tool]) => ({
      name,
      description: `Tool: ${name}`,
      inputSchema: undefined,
    }));
  }

  registerTool<T>(name: string, tool: LanguageModelTool<T>): Disposable {
    this.registeredTools.set(name, tool);
    this._onDidChangeTools.fire();

    return {
      dispose: () => {
        this.registeredTools.delete(name);
        this._onDidChangeTools.fire();
      },
    };
  }

  async invokeTool(
    name: string,
    options: LanguageModelToolInvocationOptions<object>,
    token?: CancellationToken
  ): Promise<LanguageModelToolResult> {
    const tool = this.registeredTools.get(name);
    if (!tool) {
      throw new Error(`Tool '${name}' not found`);
    }

    if (token?.isCancellationRequested) {
      throw new Error('Tool invocation was cancelled');
    }

    return tool.invoke(options, token!);
  }

  dispose(): void {
    this.registeredTools.clear();
    this._onDidChangeTools.dispose();
  }
}
