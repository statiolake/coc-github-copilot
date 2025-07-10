// Workspace information tool - provides current directory and file info
import { workspace } from 'coc.nvim';
import type { LanguageModelTool } from '../../api/types';
import { LanguageModelTextPart } from '../../api/types';

export const getWorkspaceInfo: LanguageModelTool<object> = {
  information: {
    name: 'getWorkspaceInfo',
    description: 'Get information about the current workspace',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  invoke: async () => {
    const { nvim } = workspace;
    const cwd = await nvim.call('getcwd');
    const bufname = await nvim.call('expand', ['%:p']);
    return {
      content: [
        new LanguageModelTextPart(
          `ワークスペース情報:\n- 作業ディレクトリ: ${cwd}\n- 現在のファイル: ${bufname}`
        ),
      ],
    };
  },
};
