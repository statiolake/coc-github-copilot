// Tool management for Language Model API

import { CancellationTokenSource, Emitter } from 'coc.nvim';
import type {
  CancellationToken,
  Disposable,
  Event,
  LanguageModelTool,
  LanguageModelToolInformation,
  LanguageModelToolInvocationOptions,
  LanguageModelToolResult,
} from './types';

interface RegisteredTool {
  tool: LanguageModelTool<unknown>;
  info: LanguageModelToolInformation;
}

export class LanguageModelToolManager {
  private registeredTools = new Map<string, RegisteredTool>();
  private _onDidChangeTools = new Emitter<void>();

  readonly onDidChangeTools: Event<void> = this._onDidChangeTools.event;

  get tools(): readonly LanguageModelToolInformation[] {
    return Array.from(this.registeredTools.values()).map(({ info }) => info);
  }

  registerTool<T>(name: string, tool: LanguageModelTool<T>): Disposable {
    // Extract tool information from tool object if it implements ToolInfo interface
    const toolWithInfo = tool as LanguageModelTool<T> & Partial<LanguageModelToolInformation>;
    const info: LanguageModelToolInformation = {
      name: toolWithInfo.name || name,
      description: toolWithInfo.description || `Tool: ${name}`,
      inputSchema: toolWithInfo.inputSchema,
    };

    this.registeredTools.set(name, { tool, info });
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
    const registeredTool = this.registeredTools.get(name);
    if (!registeredTool) {
      throw new Error(`Tool '${name}' not found`);
    }

    if (token?.isCancellationRequested) {
      throw new Error('Tool invocation was cancelled');
    }

    return registeredTool.tool.invoke(options, token ?? new CancellationTokenSource().token);
  }

  dispose(): void {
    this.registeredTools.clear();
    this._onDidChangeTools.dispose();
  }
}
