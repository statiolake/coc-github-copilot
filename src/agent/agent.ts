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
} from '../api/types';
import {
  LanguageModelChatMessage,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
} from '../api/types';

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
      // Starting autonomous execution for tool

      // Execute initial tool
      const initialResult = await this.executeTool(toolName, options, context);

      // If autoExecute is disabled, return the initial result
      if (!this.config.autoExecute) {
        // Auto-execute disabled, returning initial result
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
        // Iteration ${context.iteration}: Sending message to AI

        // Send message to AI with available tools
        const response = await this.sendMessageToAI(messages, context);

        // Process AI response
        const { hasToolCalls, toolResults, textContent } = await this.processAIResponse(
          response,
          context
        );

        if (!hasToolCalls) {
          // AI returned only text - we're done
          // AI returned text only, finishing
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
        // AI used ${toolResults.length} tools, continuing conversation

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
          // Agent execution timeout reached
          break;
        }
      }

      // Autonomous execution completed after ${context.iteration} iterations
      return finalResult;
    } finally {
      this.activeContexts.delete(context.requestId);
    }
  }

  // Conversation history storage
  private conversationHistory = new Map<string, LanguageModelChatMessage[]>();

  /**
   * Send a message directly to AI for interactive chat with conversation history
   */
  async sendDirectMessage(
    message: string,
    invocationToken: LanguageModelToolInvocationToken,
    conversationId?: string,
    token?: CancellationToken,
    onToolUse?: (toolName: string, input: object, result: LanguageModelToolResult) => Promise<void>
  ): Promise<LanguageModelToolResult> {
    const context = this.createExecutionContext(invocationToken, token);
    this.activeContexts.set(context.requestId, context);

    try {
      // Sending direct message

      // Get or create conversation history
      const sessionId = conversationId || context.requestId;
      const existingMessages = this.conversationHistory.get(sessionId) || [];

      // Add user message to history
      const newUserMessage = LanguageModelChatMessage.User(message);
      const messages = [...existingMessages, newUserMessage];

      // Send message to AI with available tools
      const response = await this.sendMessageToAI(messages, context);

      // Process AI response
      const { hasToolCalls, toolResults, textContent } = await this.processAIResponse(
        response,
        context,
        onToolUse
      );

      let finalContent = textContent || '';
      const assistantMessage = textContent || '';

      if (hasToolCalls) {
        // AI used tools - continue the conversation with tool results
        const toolResultsText = toolResults
          .map((result) =>
            result.content
              .filter((c): c is LanguageModelTextPart => c instanceof LanguageModelTextPart)
              .map((c) => c.value)
              .join('\n')
          )
          .join('\n');

        // Add assistant message and tool results to conversation
        messages.push(LanguageModelChatMessage.Assistant(assistantMessage));
        messages.push(LanguageModelChatMessage.User(`Tool results: ${toolResultsText}`));

        // Get AI's final response after tool usage
        const finalResponse = await this.sendMessageToAI(messages, context);
        const finalResult = await this.processAIResponse(finalResponse, context, onToolUse);

        finalContent = finalResult.textContent || assistantMessage;
        // ツール結果は既にリアルタイムで表示されているので、ここでは追加しない
      }

      // Update conversation history
      const updatedMessages = [...messages];
      if (!hasToolCalls) {
        updatedMessages.push(LanguageModelChatMessage.Assistant(finalContent));
      } else {
        // Add final assistant response
        const finalAssistantMessage = LanguageModelChatMessage.Assistant(finalContent);
        updatedMessages.push(finalAssistantMessage);
      }

      this.conversationHistory.set(sessionId, updatedMessages);

      // Direct message completed
      return {
        content: [new LanguageModelTextPart(finalContent)],
      };
    } finally {
      this.activeContexts.delete(context.requestId);
    }
  }

  /**
   * Clear conversation history for a session
   */
  clearConversationHistory(conversationId: string): void {
    this.conversationHistory.delete(conversationId);
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
    _context: AgentExecutionContext
  ): Promise<LanguageModelChatResponse> {
    return await this.model.sendRequest(messages, {
      tools: this.lmNamespace.tools.slice(),
    });
  }

  private async processAIResponse(
    response: LanguageModelChatResponse,
    context: AgentExecutionContext,
    onToolUse?: (toolName: string, input: object, result: LanguageModelToolResult) => Promise<void>
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
        // AI requested tool: ${part.name}

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

          // Notify about tool use for real-time display
          if (onToolUse) {
            try {
              await onToolUse(part.name, part.input, toolResult);
            } catch (_callbackError) {
              // Tool callback failed
            }
          }
        } catch (error) {
          // Tool execution failed
          // Add error as tool result
          const errorResult = {
            content: [new LanguageModelTextPart(`Tool error: ${error}`)],
          };
          toolResults.push(errorResult);

          // Notify about tool error for real-time display
          if (onToolUse) {
            try {
              await onToolUse(part.name, part.input, errorResult);
            } catch (_callbackError) {
              // Tool error callback failed
            }
          }
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
      // Executing tool: ${toolName}
      const result = await this.lmNamespace.invokeTool(toolName, options, context.token);

      action.result = result;
      action.success = true;
      context.history.push(action);

      // Tool ${toolName} executed successfully
      return result;
    } catch (error) {
      action.error = error instanceof Error ? error.message : String(error);
      action.success = false;
      context.history.push(action);

      // Tool ${toolName} execution failed
      throw error;
    }
  }

  private log(message: string, context: AgentExecutionContext): void {
    if (this.config.enableLogging) {
      console.log(`[Agent:${context.requestId}:${context.iteration}] ${message}`);
    }
  }
}
