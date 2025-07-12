// ChatComponent type definitions for UI elements in conversation

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

// Chat state interface for conversation management
export interface ChatStateData {
  conversationId: string;
  components: ChatComponent[];
  createdAt: number;
  updatedAt: number;
}

// Display line information for rendering
export interface DisplayLine {
  lineNumber: number;
  content: string;
  isVirtual: boolean;
  virtualText?: string;
  virtualStyle?: string;
  eventId?: string;
}

// Render operation for differential updates
export type RenderOperation =
  | { type: 'insert'; lineNumber: number; lines: DisplayLine[] }
  | { type: 'update'; lineNumber: number; lines: DisplayLine[] }
  | { type: 'delete'; startLine: number; endLine: number }
  | { type: 'replace'; startLine: number; endLine: number; lines: DisplayLine[] };
