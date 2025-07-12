// ChatState management class for conversation flow

import type { ChatComponent, ChatStateData } from './chat-types';

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

  /**
   * Add a user message to the conversation
   */
  addUserMessage(content: string): ChatComponent {
    const component: ChatComponent = {
      id: this.generateComponentId(),
      type: 'message',
      role: 'user',
      content: content.trim(),
      timestamp: Date.now(),
    };

    this.data.components.push(component);
    this.data.updatedAt = Date.now();
    return component;
  }

  /**
   * Add an assistant message to the conversation
   */
  addAssistantMessage(content: string): ChatComponent {
    const component: ChatComponent = {
      id: this.generateComponentId(),
      type: 'message',
      role: 'assistant',
      content: content.trim(),
      timestamp: Date.now(),
    };

    this.data.components.push(component);
    this.data.updatedAt = Date.now();
    return component;
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
   * Start assistant message for streaming
   */
  startAssistantMessage(): ChatComponent {
    const component: ChatComponent = {
      id: this.generateComponentId(),
      type: 'message',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };

    this.data.components.push(component);
    this.data.updatedAt = Date.now();
    return component;
  }

  /**
   * Append text to the last assistant message
   */
  appendToLastAssistantMessage(text: string): void {
    const lastComponent = this.getLastComponent();
    if (lastComponent && lastComponent.type === 'message' && lastComponent.role === 'assistant') {
      lastComponent.content += text;
      this.data.updatedAt = Date.now();
    }
  }

  /**
   * Update the last assistant message content
   */
  updateLastAssistantMessage(content: string): void {
    const lastComponent = this.getLastComponent();
    if (lastComponent && lastComponent.type === 'message' && lastComponent.role === 'assistant') {
      lastComponent.content = content;
      this.data.updatedAt = Date.now();
    }
  }

  /**
   * Get all components in the conversation
   */
  getComponents(): ChatComponent[] {
    return [...this.data.components];
  }

  /**
   * Get the last component
   */
  getLastComponent(): ChatComponent | null {
    return this.data.components.length > 0
      ? this.data.components[this.data.components.length - 1]
      : null;
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
   * Check if last message is from assistant (potentially streaming)
   */
  isLastMessageFromAssistant(): boolean {
    const lastComponent = this.getLastComponent();
    return lastComponent?.type === 'message' && lastComponent.role === 'assistant';
  }

  /**
   * Add an empty user message for input
   */
  addEmptyUserMessage(): ChatComponent {
    const component: ChatComponent = {
      id: this.generateComponentId(),
      type: 'message',
      role: 'user',
      content: '',
      timestamp: Date.now(),
    };

    this.data.components.push(component);
    this.data.updatedAt = Date.now();
    return component;
  }

  /**
   * Update the last user message content
   */
  updateLastUserMessage(content: string): void {
    const lastComponent = this.getLastComponent();
    if (lastComponent && lastComponent.type === 'message' && lastComponent.role === 'user') {
      lastComponent.content = content;
      this.data.updatedAt = Date.now();
    }
  }

  /**
   * Clear all components (reset conversation)
   */
  clear(): void {
    this.data.components = [];
    this.data.updatedAt = Date.now();
    this.componentIdCounter = 0;
  }

  /**
   * Get conversation metadata
   */
  getMetadata(): Omit<ChatStateData, 'components'> {
    return {
      conversationId: this.data.conversationId,
      createdAt: this.data.createdAt,
      updatedAt: this.data.updatedAt,
    };
  }

  /**
   * Generate unique component ID
   */
  private generateComponentId(): string {
    return `${this.data.conversationId}-${++this.componentIdCounter}-${Date.now()}`;
  }
}
