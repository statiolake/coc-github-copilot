export type ChatComponent = { id: string } & (
  | {
      type: 'message';
      role: 'user' | 'assistant';
      content: string;
      timestamp: number;
    }
  | {
      type: 'tool';
      toolName: string;
      toolInput: object;
      toolResponse: string;
      timestamp: number;
    }
);

export interface ChatStateData {
  conversationId: string;
  components: ChatComponent[];
  createdAt: number;
  updatedAt: number;
}
