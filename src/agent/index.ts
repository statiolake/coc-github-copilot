// Self-operating agent service - Independent from LM namespace for compatibility
// This service can be used as a separate extension feature

import { Emitter, type ExtensionContext, window } from 'coc.nvim';
import type {
  CancellationToken,
  Event,
  LanguageModelChat,
  LanguageModelToolInvocationOptions,
  LanguageModelToolInvocationToken,
  LanguageModelToolResult,
  LMNamespace,
} from '../api/types';
import { type AgentConfig, SelfOperatingAgent } from './agent';
import { registerChatCommands } from './chat';
import { registerAgentTools } from './tools';

export class AgentService {
  private _onDidChangeAgentStatus = new Emitter<AgentStatus>();
  private agent?: SelfOperatingAgent;
  private config: AgentConfig;
  private status: AgentStatus = AgentStatus.NotInitialized;

  readonly onDidChangeAgentStatus: Event<AgentStatus> = this._onDidChangeAgentStatus.event;

  constructor(config: Partial<AgentConfig> = {}) {
    this.config = {
      maxIterations: 10,
      maxDepth: 3,
      autoExecute: true,
      timeout: 30000,
      enableLogging: true,
      ...config,
    };
  }

  /**
   * Initialize the agent with a language model and LM namespace
   */
  async initialize(lmNamespace: LMNamespace, model: LanguageModelChat): Promise<void> {
    try {
      this.setStatus(AgentStatus.Initializing);
      this.agent = new SelfOperatingAgent(this.config, lmNamespace, model);
      this.setStatus(AgentStatus.Ready);
    } catch (error) {
      this.setStatus(AgentStatus.Error);
      throw error;
    }
  }

  /**
   * Execute a tool with autonomous follow-up capabilities
   */
  async executeWithAgent(
    toolName: string,
    options: LanguageModelToolInvocationOptions<object>,
    token?: CancellationToken
  ): Promise<LanguageModelToolResult> {
    if (!this.agent) {
      throw new Error('Agent not initialized. Call initialize() first.');
    }

    if (this.status !== AgentStatus.Ready) {
      throw new Error(`Agent is not ready. Current status: ${this.status}`);
    }

    try {
      this.setStatus(AgentStatus.Executing);
      const result = await this.agent.executeAutonomously(toolName, options, token);
      this.setStatus(AgentStatus.Ready);
      return result;
    } catch (error) {
      this.setStatus(AgentStatus.Error);
      throw error;
    }
  }

  /**
   * Send a message directly to the agent for interactive chat
   */
  async sendDirectMessage(
    message: string,
    invocationToken: LanguageModelToolInvocationToken,
    conversationId?: string,
    token?: CancellationToken,
    onToolUse?: (toolName: string, input: object, result: LanguageModelToolResult) => Promise<void>
  ): Promise<LanguageModelToolResult> {
    if (!this.agent) {
      throw new Error('Agent not initialized. Call initialize() first.');
    }

    if (this.status !== AgentStatus.Ready) {
      throw new Error(`Agent is not ready. Current status: ${this.status}`);
    }

    try {
      this.setStatus(AgentStatus.Executing);
      const result = await this.agent.sendDirectMessage(
        message,
        invocationToken,
        conversationId,
        token,
        onToolUse
      );
      this.setStatus(AgentStatus.Ready);
      return result;
    } catch (error) {
      this.setStatus(AgentStatus.Error);
      throw error;
    }
  }

  /**
   * Clear conversation history for a session
   */
  clearConversationHistory(conversationId: string): void {
    if (this.agent) {
      this.agent.clearConversationHistory(conversationId);
    }
  }

  /**
   * Update agent configuration
   */
  updateConfig(newConfig: Partial<AgentConfig>): void {
    this.config = { ...this.config, ...newConfig };
    // If agent is initialized, we might need to reinitialize it
    if (this.agent) {
      // Re-initialization may be required for config changes
    }
  }

  /**
   * Get current agent configuration
   */
  getConfig(): AgentConfig {
    return { ...this.config };
  }

  /**
   * Get current agent status
   */
  getStatus(): AgentStatus {
    return this.status;
  }

  /**
   * Check if agent is ready for execution
   */
  isReady(): boolean {
    return this.status === AgentStatus.Ready;
  }

  /**
   * Reset agent to initial state
   */
  reset(): void {
    this.agent = undefined;
    this.setStatus(AgentStatus.NotInitialized);
  }

  /**
   * Dispose the agent service
   */
  dispose(): void {
    this.reset();
    this._onDidChangeAgentStatus.dispose();
  }

  private setStatus(status: AgentStatus): void {
    if (this.status !== status) {
      this.status = status;
      this._onDidChangeAgentStatus.fire(status);
    }
  }
}

export enum AgentStatus {
  NotInitialized = 'notInitialized',
  Initializing = 'initializing',
  Ready = 'ready',
  Executing = 'executing',
  Error = 'error',
}

// Factory function to create agent service
export function createAgentService(config: Partial<AgentConfig> = {}): AgentService {
  return new AgentService(config);
}

/**
 * Initialize agent functionality including tools, commands, and auto-startup
 */
export async function initializeAgent(
  context: ExtensionContext,
  lm: LMNamespace
): Promise<AgentService> {
  // Register agent tools with LM namespace
  async function setupAgentTools() {
    try {
      await registerAgentTools(lm);
    } catch (error) {
      window.showErrorMessage(`エージェントツールセットアップエラー: ${error}`);
    }
  }

  // Create agent service
  const agentService = createAgentService();

  // 起動時に自動でエージェントを初期化
  async function setupAgent() {
    try {
      // Get a model for the agent
      const models = await lm.selectChatModels({ vendor: 'copilot' });
      if (models.length === 0) {
        return;
      }

      const model = models[0];
      await agentService.initialize(lm, model);
    } catch (_error) {
      // Agent initialization failed - will retry on first use
    }
  }

  // Register chat commands
  registerChatCommands(context, agentService, lm);

  // Add agent service to disposables
  context.subscriptions.push(agentService);

  // 起動時のセットアップを非同期で実行
  setTimeout(async () => {
    await setupAgentTools();
    await setupAgent();
  }, 1000); // 1秒後に実行（拡張機能の初期化が完了してから）

  return agentService;
}
