// Self-operating agent service - Independent from LM namespace for compatibility
// This service can be used as a separate extension feature

import { Emitter } from 'coc.nvim';
import { type AgentConfig, SelfOperatingAgent } from '../api/agent';
import type {
  CancellationToken,
  Event,
  LanguageModelChat,
  LanguageModelToolInvocationOptions,
  LanguageModelToolResult,
  LMNamespace,
} from '../api/types';

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
   * Update agent configuration
   */
  updateConfig(newConfig: Partial<AgentConfig>): void {
    this.config = { ...this.config, ...newConfig };
    // If agent is initialized, we might need to reinitialize it
    if (this.agent) {
      console.log('Agent configuration updated. Re-initialization may be required.');
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
