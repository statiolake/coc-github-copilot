# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a GitHub Copilot extension for coc.nvim that provides AI-powered code completion and chat functionality. The extension integrates with the official GitHub Copilot Language Server to provide inline completions and exposes a Language Model API for chat interactions.

## Architecture

The codebase is structured into two main functional areas:

1. **Language Model API** (`src/api/`): Implements the LM namespace for chat functionality
   - `chat.ts`: Chat model implementation using Copilot's streaming API
   - `config.ts`: Configuration management for chat features
   - `models.ts`: Model selection and management
   - `auth.ts`: Authentication token management
   - `types.ts`: TypeScript type definitions

2. **Suggestion System** (`src/suggestion/`): Handles inline completion via language server
   - Language server client setup and configuration
   - Authentication flow with GitHub device authentication
   - Command registration for sign-in/out, enable/disable
   - Status monitoring and user feedback

The main entry point (`src/index.ts`) initializes both systems and returns the LM namespace for coc.nvim integration.

## Development Commands

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Watch mode for development
npm run watch

# Code formatting and linting
npm run format        # Format code with Biome
npm run format:check  # Check formatting without changes
npm run lint          # Lint code
npm run lint:fix      # Fix linting issues
npm run check         # Run both formatting and linting checks
npm run check:fix     # Fix both formatting and linting issues
```

## Key Configuration

- **TypeScript**: CommonJS modules, ES2019 target, strict mode enabled
- **Biome**: Used for formatting and linting with 2-space indentation, 100-character line width
- **Output**: Compiled JavaScript goes to `lib/` directory
- **Dependencies**: Uses `@github/copilot-language-server` for core functionality

## Authentication Flow

The extension uses GitHub's device authentication flow:
1. User runs `:CocCommand copilot.signIn`
2. Extension requests device code from GitHub
3. User opens browser and enters the code
4. Extension polls for authentication completion
5. Language server receives auth token for API access

## Testing

Currently no test framework is configured. The package.json test script outputs an error message indicating tests need to be implemented.