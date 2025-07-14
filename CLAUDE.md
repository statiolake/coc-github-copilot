# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a GitHub Copilot extension for coc.nvim that provides AI-powered code completion and chat functionality. The extension integrates with the official GitHub Copilot Language Server to provide inline completions and exposes a Language Model API for chat interactions.

## Architecture

The codebase is organized into core modules in the `src/` directory:

1. **Core Files**:
   - `index.ts`: Main entry point that initializes language client and LM API integration
   - `auth.ts`: Authentication management including CopilotAuthManager class and device flow
   - `chat.ts`: Chat model implementation using Copilot's streaming API
   - `config.ts`: Configuration management for chat features
   - `models.ts`: Model discovery and management

2. **Main Functionality**:
   - **Language Client**: Manages GitHub Copilot Language Server connection for inline completions
   - **LM API Integration**: Implements VS Code-compatible Language Model API for chat functionality
   - **Authentication**: Handles GitHub device authentication flow and token management
   - **Model Management**: Discovers and manages available Copilot models

The extension provides both inline code completion through the language server and chat functionality through the LM API.

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

## Code Quality Principles

When working with this codebase, follow these fundamental principles:

### 1. Comments Policy

- **Keep public API documentation**: Always document public methods, classes, and exported members with JSDoc/TSDoc
- **Remove meaningless "what" comments**: Never describe what the code does if it's already clear from reading the code
- **Keep only "why" comments**: Comments should explain the reasoning, constraints, or important design decisions
- **Remove implementation notes**: Delete temporary comments, development notes, and process documentation

### 2. DRY Principle (Don't Repeat Yourself)

- **Extract common patterns**: Create helper functions when you see repeated code patterns
- **Consolidate similar operations**: Merge functions that do similar things with small variations
- **Share utilities**: Create reusable utility functions for error handling, validation, etc.

### 3. Minimize Conditional Branching

- **Use early returns**: Reduce nesting by returning early from functions when conditions aren't met
- **Prefer ternary operators**: Use conditional expressions for simple branching
- **Consolidate switch statements**: Combine similar cases or extract common logic
- **Leverage modern JavaScript**: Use methods like `Array.at()`, optional chaining, and nullish coalescing

### 4. Code Organization

- **Group related functions**: Keep helper functions near their usage
- **Make functions focused**: Each function should have a single, clear responsibility
- **Standardize patterns**: Use consistent error handling and async patterns throughout

### 5. Architecture Constraints

- **No adhoc buffer manipulation**: Always use the renderer for buffer updates, never modify buffers directly
- **Maintain differential rendering**: Ensure `lastRendered` state stays synchronized with actual buffer content
- **Follow the ChatState → Renderer flow**: All UI updates must go through the proper state management and rendering pipeline

## Testing

Currently no test framework is configured. The package.json test script outputs an error message indicating tests need to be implemented.
