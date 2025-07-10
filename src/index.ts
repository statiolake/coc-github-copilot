// Main extension entry point - exports LM namespace directly for coc.nvim extensions
import type { ExtensionContext } from 'coc.nvim';
import { initializeAgent } from './agent';
import { createLMNamespace } from './api';
import type { LMNamespace } from './api/types';
import { initializeSuggestion } from './suggestion';

export async function activate(context: ExtensionContext): Promise<LMNamespace> {
  await initializeSuggestion(context);

  const lm = createLMNamespace();

  await initializeAgent(context, lm);

  return lm;
}
