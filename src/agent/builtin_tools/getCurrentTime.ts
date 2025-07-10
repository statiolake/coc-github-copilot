// Get current time tool - returns Japanese formatted time
import type { LanguageModelTool, LanguageModelToolInformation } from '../../api/types';
import { LanguageModelTextPart } from '../../api/types';

export const getCurrentTime: LanguageModelToolInformation & LanguageModelTool<object> = {
  name: 'getCurrentTime',
  description: 'Get the current time in Japanese format',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  invoke: async () => {
    const now = new Date();
    return {
      content: [
        new LanguageModelTextPart(
          `現在の日時は ${now.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} です。`
        ),
      ],
    };
  },
};
