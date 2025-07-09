// Self-operating AI agent system for autonomous tool execution
// This system processes tool results and automatically determines next actions

import { z } from 'zod';
import type {
  CancellationToken,
  LanguageModelChat,
  LanguageModelChatResponse,
  LanguageModelToolInvocationOptions,
  LanguageModelToolInvocationToken,
  LanguageModelToolResult,
  LMNamespace,
} from './types';
import {
  LanguageModelChatMessage,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
} from './types';

// Configuration schema for agent behavior
const AgentConfigSchema = z.object({
  maxIterations: z.number().optional().default(10),
  maxDepth: z.number().optional().default(3),
  autoExecute: z.boolean().optional().default(true),
  timeout: z.number().optional().default(30000),
  enableLogging: z.boolean().optional().default(true),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

// Agent execution context
interface AgentExecutionContext {
  requestId: string;
  participantName: string;
  command?: string;
  iteration: number;
  depth: number;
  history: AgentAction[];
  startTime: number;
  token?: CancellationToken;
}

// Agent action tracking
interface AgentAction {
  type: 'tool_call';
  toolName?: string;
  input?: unknown;
  result?: LanguageModelToolResult;
  timestamp: number;
  success: boolean;
  error?: string;
}

export class SelfOperatingAgent {
  private config: AgentConfig;
  private lmNamespace: LMNamespace;
  private model: LanguageModelChat;
  private activeContexts = new Map<string, AgentExecutionContext>();

  constructor(config: AgentConfig, lmNamespace: LMNamespace, model: LanguageModelChat) {
    this.config = AgentConfigSchema.parse(config);
    this.lmNamespace = lmNamespace;
    this.model = model;
  }

  /**
   * Main entry point for autonomous agent execution
   * Simple loop: user message → AI response → if tool call, execute and continue
   */
  async executeAutonomously(
    toolName: string,
    options: LanguageModelToolInvocationOptions<object>,
    token?: CancellationToken
  ): Promise<LanguageModelToolResult> {
    const context = this.createExecutionContext(options.toolInvocationToken, token);
    this.activeContexts.set(context.requestId, context);

    try {
      this.log(`Starting autonomous execution for tool: ${toolName}`, context);

      // Execute initial tool
      const initialResult = await this.executeTool(toolName, options, context);

      // If autoExecute is disabled, return the initial result
      if (!this.config.autoExecute) {
        this.log('Auto-execute disabled, returning initial result', context);
        return initialResult;
      }

      // Create initial message with tool result
      const initialContent = initialResult.content
        .filter((c): c is LanguageModelTextPart => c instanceof LanguageModelTextPart)
        .map((c) => c.value)
        .join('\n');

      const messages = [
        LanguageModelChatMessage.User(`Tool "${toolName}" result: ${initialContent}`),
      ];

      // Start autonomous processing loop
      let finalResult = initialResult;

      while (context.iteration < this.config.maxIterations && !token?.isCancellationRequested) {
        this.log(`Iteration ${context.iteration}: Sending message to AI`, context);

        // Send message to AI with available tools
        const response = await this.sendMessageToAI(messages, context);

        // Process AI response
        const { hasToolCalls, toolResults, textContent } = await this.processAIResponse(
          response,
          context
        );

        if (!hasToolCalls) {
          // AI returned only text - we're done
          this.log('AI returned text only, finishing', context);
          if (textContent) {
            finalResult = {
              content: [
                ...finalResult.content,
                new LanguageModelTextPart(`\n\nAI Analysis: ${textContent}`),
              ],
            };
          }
          break;
        }

        // AI used tools - add results to conversation and continue
        this.log(`AI used ${toolResults.length} tools, continuing conversation`, context);

        // Add tool results to conversation
        const toolResultsText = toolResults
          .map((result) =>
            result.content
              .filter((c): c is LanguageModelTextPart => c instanceof LanguageModelTextPart)
              .map((c) => c.value)
              .join('\n')
          )
          .join('\n');

        messages.push(LanguageModelChatMessage.Assistant(textContent || ''));
        messages.push(LanguageModelChatMessage.User(`Tool results: ${toolResultsText}`));

        // Update final result
        finalResult = {
          content: [
            ...finalResult.content,
            new LanguageModelTextPart(`\n\nTool Results: ${toolResultsText}`),
          ],
        };

        context.iteration++;

        // Safety check for timeout
        if (Date.now() - context.startTime > this.config.timeout) {
          this.log('Agent execution timeout reached', context);
          break;
        }
      }

      this.log(`Autonomous execution completed after ${context.iteration} iterations`, context);
      return finalResult;
    } catch (error) {
      this.log(`Agent execution failed: ${error}`, context);
      throw error;
    } finally {
      this.activeContexts.delete(context.requestId);
    }
  }

  private createExecutionContext(
    invocationToken: LanguageModelToolInvocationToken,
    token?: CancellationToken
  ): AgentExecutionContext {
    return {
      requestId: invocationToken.requestId,
      participantName: invocationToken.participantName,
      command: invocationToken.command,
      iteration: 0,
      depth: 0,
      history: [],
      startTime: Date.now(),
      token,
    };
  }

  private async sendMessageToAI(
    messages: LanguageModelChatMessage[],
    context: AgentExecutionContext
  ): Promise<LanguageModelChatResponse> {
    // Get available tools in VS Code LM API format
    const availableTools = this.lmNamespace.tools.map((tool) => ({
      name: tool.name,
      description: this.getToolDescription(tool.name),
      inputSchema: this.getToolParameters(tool.name),
    }));

    // Send message to AI with tools
    const response = await this.model.sendRequest(messages, {
      tools: availableTools,
    });

    return response;
  }

  private getToolDescription(toolName: string): string {
    switch (toolName) {
      case 'getCurrentTime':
        return 'Get the current time in Japanese format';
      case 'calculate':
        return 'Perform mathematical calculations';
      case 'getWorkspaceInfo':
        return 'Get information about the current workspace';
      case 'testError':
        return 'A test tool that simulates an error requiring time check';
      default:
        return `Tool: ${toolName}`;
    }
  }

  private getToolParameters(toolName: string): object {
    switch (toolName) {
      case 'calculate':
        return {
          type: 'object',
          properties: {
            expression: {
              type: 'string',
              description: 'Mathematical expression to calculate (e.g., "2 + 3 * 4")',
            },
          },
          required: ['expression'],
        };
      case 'getCurrentTime':
      case 'getWorkspaceInfo':
      case 'testError':
        return {
          type: 'object',
          properties: {},
        };
      default:
        return {
          type: 'object',
          properties: {},
        };
    }
  }

  private async processAIResponse(
    response: LanguageModelChatResponse,
    context: AgentExecutionContext
  ): Promise<{
    hasToolCalls: boolean;
    toolResults: LanguageModelToolResult[];
    textContent: string;
  }> {
    let hasToolCalls = false;
    let textContent = '';
    const toolResults: LanguageModelToolResult[] = [];

    // Process streaming response
    for await (const part of response.stream) {
      if (part instanceof LanguageModelTextPart) {
        textContent += part.value;
      } else if (part instanceof LanguageModelToolCallPart) {
        hasToolCalls = true;
        this.log(`AI requested tool: ${part.name}`, context);

        // Execute the tool
        try {
          const toolResult = await this.lmNamespace.invokeTool(part.name, {
            input: part.input,
            toolInvocationToken: {
              requestId: context.requestId,
              participantName: context.participantName,
            },
          });
          toolResults.push(toolResult);
        } catch (error) {
          this.log(`Tool execution failed: ${error}`, context);
          // Add error as tool result
          toolResults.push({
            content: [new LanguageModelTextPart(`Tool error: ${error}`)],
          });
        }
      }
    }

    return { hasToolCalls, toolResults, textContent };
  }

  private async executeTool(
    toolName: string,
    options: LanguageModelToolInvocationOptions<object>,
    context: AgentExecutionContext
  ): Promise<LanguageModelToolResult> {
    const action: AgentAction = {
      type: 'tool_call',
      toolName,
      input: options.input,
      timestamp: Date.now(),
      success: false,
    };

    try {
      this.log(`Executing tool: ${toolName}`, context);
      const result = await this.lmNamespace.invokeTool(toolName, options, context.token);

      action.result = result;
      action.success = true;
      context.history.push(action);

      this.log(`Tool ${toolName} executed successfully`, context);
      return result;
    } catch (error) {
      action.error = error instanceof Error ? error.message : String(error);
      action.success = false;
      context.history.push(action);

      this.log(`Tool ${toolName} execution failed: ${action.error}`, context);
      throw error;
    }
  }

  private log(message: string, context: AgentExecutionContext): void {
    if (this.config.enableLogging) {
      console.log(`[Agent:${context.requestId}:${context.iteration}] ${message}`);
    }
  }
}
