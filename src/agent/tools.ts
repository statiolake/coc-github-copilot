import type { LMNamespace } from '../api/types';
import { calculate } from './builtin_tools/calculate';
import { getCurrentTime } from './builtin_tools/getCurrentTime';
import { getWorkspaceInfo } from './builtin_tools/getWorkspaceInfo';

/**
 * Register all builtin agent tools with the LM namespace
 */
export async function registerAgentTools(lm: LMNamespace): Promise<void> {
  try {
    lm.registerTool(getCurrentTime.name, getCurrentTime);
    lm.registerTool(calculate.name, calculate);
    lm.registerTool(getWorkspaceInfo.name, getWorkspaceInfo);
  } catch (error) {
    throw new Error(`Failed to register agent tools: ${error}`);
  }
}
