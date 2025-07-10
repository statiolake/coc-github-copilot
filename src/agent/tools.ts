import type { LMNamespace } from '../api/types';
import { calculate } from './builtin_tools/calculate';
import { getCurrentTime } from './builtin_tools/getCurrentTime';
import { getWorkspaceInfo } from './builtin_tools/getWorkspaceInfo';

/**
 * Register all builtin agent tools with the LM namespace
 */
export async function registerAgentTools(lm: LMNamespace): Promise<void> {
  try {
    console.log('=== Registering builtin tools ===');

    lm.registerTool(getCurrentTime.name, getCurrentTime);
    lm.registerTool(calculate.name, calculate);
    lm.registerTool(getWorkspaceInfo.name, getWorkspaceInfo);

    console.log('=== Registering builtin tools successfully ===');
  } catch (error) {
    console.error('Agent tools registration error:', error);
    throw new Error(`Failed to register agent tools: ${error}`);
  }
}
