// Main extension entry point - exports LM namespace directly for coc.nvim extensions
import type { ExtensionContext } from 'coc.nvim';
import { createLMNamespace } from './api';
import type { LMNamespace } from './api/types';
import { initializeSuggestionFeatures } from './suggestion';

export async function activate(context: ExtensionContext): Promise<LMNamespace> {
  // Initialize suggestion functionality (language server, auth, commands)
  await initializeSuggestionFeatures(context);

  // Create and return the LM namespace directly
  // This matches the lm.d.ts interface where the namespace is returned "as is"
  return createLMNamespace();
}

export async function deactivate(): Promise<void> {}
