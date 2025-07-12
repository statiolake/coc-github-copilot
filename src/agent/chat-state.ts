import type { ChatComponent, ChatStateData } from './chat-types';

/**
 * Manages chat conversation state including messages and tool usage
 */
export class ChatState {
  private data: ChatStateData;
  private componentIdCounter = 0;

  constructor(conversationId: string) {
    this.data = {
      conversationId,
      components: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  private addMessage(role: 'user' | 'assistant', content: string): ChatComponent {
    const component: ChatComponent = {
      id: this.generateComponentId(),
      type: 'message',
      role,
      content: content.trim(),
      timestamp: Date.now(),
    };

    this.data.components.push(component);
    this.data.updatedAt = Date.now();
    return component;
  }

  /**
   * Add a user message to the conversation
   */
  addUserMessage(content: string): ChatComponent {
    return this.addMessage('user', content);
  }

  /**
   * Add an assistant message to the conversation
   */
  addAssistantMessage(content: string): ChatComponent {
    return this.addMessage('assistant', content);
  }

  /**
   * Add a tool usage event to the conversation
   */
  addToolComponent(toolName: string, toolInput: object, toolResponse: string): ChatComponent {
    const component: ChatComponent = {
      id: this.generateComponentId(),
      type: 'tool',
      toolName,
      toolInput,
      toolResponse: toolResponse.trim(),
      timestamp: Date.now(),
    };

    this.data.components.push(component);
    this.data.updatedAt = Date.now();
    return component;
  }

  /**
   * Start an empty assistant message for streaming
   */
  startAssistantMessage(): ChatComponent {
    return this.addMessage('assistant', '');
  }

  /**
   * Add an empty user message for input
   */
  addEmptyUserMessage(): ChatComponent {
    return this.addMessage('user', '');
  }

  private updateLastMessage(
    role: 'user' | 'assistant',
    updater: (content: string) => string
  ): void {
    const lastComponent = this.getLastComponent();
    if (lastComponent?.type === 'message' && lastComponent.role === role) {
      lastComponent.content = updater(lastComponent.content);
      this.data.updatedAt = Date.now();
    }
  }

  /**
   * Append text to the last assistant message (for streaming)
   */
  appendToLastAssistantMessage(text: string): void {
    this.updateLastMessage('assistant', (content) => content + text);
  }

  /**
   * Update the last assistant message content
   */
  updateLastAssistantMessage(content: string): void {
    this.updateLastMessage('assistant', () => content);
  }

  /**
   * Update the last user message content
   */
  updateLastUserMessage(content: string): void {
    this.updateLastMessage('user', () => content);
  }

  /**
   * Get all components in the conversation
   */
  getComponents(): ChatComponent[] {
    return [...this.data.components];
  }

  /**
   * Get the last component in the conversation
   */
  getLastComponent(): ChatComponent | null {
    return this.data.components.at(-1) ?? null;
  }

  /**
   * Get components of a specific type
   */
  getComponentsByType<T extends ChatComponent['type']>(
    type: T
  ): Extract<ChatComponent, { type: T }>[] {
    return this.data.components.filter(
      (component): component is Extract<ChatComponent, { type: T }> => component.type === type
    );
  }

  /**
   * Check if the last message is from assistant
   */
  isLastMessageFromAssistant(): boolean {
    const lastComponent = this.getLastComponent();
    return lastComponent?.type === 'message' && lastComponent.role === 'assistant';
  }

  /**
   * Clear all components and reset conversation
   */
  clear(): void {
    this.data.components = [];
    this.data.updatedAt = Date.now();
    this.componentIdCounter = 0;
  }

  /**
   * Get conversation metadata without components
   */
  getMetadata(): Omit<ChatStateData, 'components'> {
    return {
      conversationId: this.data.conversationId,
      createdAt: this.data.createdAt,
      updatedAt: this.data.updatedAt,
    };
  }

  private generateComponentId(): string {
    return `${this.data.conversationId}-${++this.componentIdCounter}-${Date.now()}`;
  }
}
