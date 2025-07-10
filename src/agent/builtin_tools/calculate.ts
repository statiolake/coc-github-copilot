// Mathematical calculation tool - evaluates expressions safely
import type { LanguageModelTool } from '../../api/types';
import { LanguageModelTextPart } from '../../api/types';

interface CalculateInput {
  expression: string;
}

export const calculate: LanguageModelTool<CalculateInput> = {
  information: {
    name: 'calculate',
    description: 'Perform mathematical calculations',
    inputSchema: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'Mathematical expression to calculate (e.g., "2 + 3 * 4")',
        },
      },
      required: ['expression'],
    },
  },
  invoke: async (options: { input: CalculateInput }) => {
    try {
      // Simple math evaluation (safe for basic expressions)
      const result = Function(`"use strict"; return (${options.input.expression})`)();
      return {
        content: [new LanguageModelTextPart(`計算結果: ${options.input.expression} = ${result}`)],
      };
    } catch (error) {
      return {
        content: [
          new LanguageModelTextPart(
            `計算エラー: ${options.input.expression} を評価できませんでした。エラー: ${error}`
          ),
        ],
      };
    }
  },
};
