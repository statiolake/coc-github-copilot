# @statiolake/coc-github-copilot

GitHub Copilot integration for coc.nvim with inline completions and Language Model API support.

## Features

- 🤖 **GitHub Copilot Integration**: Official GitHub Copilot Language Server integration
- 🔐 **Device Authentication**: Secure GitHub device authentication flow
- ⚡ **Inline Completions**: Automatic code suggestions via Language Server
- 🗨️ **Language Model API**: Provides chat models for other extensions
- 📊 **Status Monitoring**: Real-time authentication and service status
- 🛠️ **Simple Configuration**: Works out of the box with minimal setup

## Installation

### Prerequisites

- [coc.nvim](https://github.com/neoclide/coc.nvim) 0.0.82+
- Node.js 16+
- GitHub Copilot subscription
- **[@statiolake/coc-lm-api](https://www.npmjs.com/package/@statiolake/coc-lm-api)**: Required dependency

### Install via coc.nvim

```vim
:CocInstall @statiolake/coc-lm-api @statiolake/coc-github-copilot
```

### Install via npm

```bash
npm install -g @statiolake/coc-lm-api @statiolake/coc-github-copilot
```

## Setup

1. Install both required extensions
2. Run `:CocCommand copilot.signIn` to authenticate with GitHub
3. Follow the device authentication flow in your browser
4. Start coding with Copilot suggestions!

## Commands

| Command | Description |
|---------|-------------|
| `:CocCommand copilot.signIn` | Sign in to GitHub Copilot |
| `:CocCommand copilot.signOut` | Sign out from GitHub Copilot |
| `:CocCommand copilot.status` | Show current authentication status |
| `:CocCommand copilot.enable` | Enable Copilot suggestions |
| `:CocCommand copilot.disable` | Disable Copilot suggestions |

## Configuration

Add to your coc-settings.json:

```json
{
  \"copilot.enable\": true,
  \"copilot.trace.server\": \"off\"
}
```

### Available Settings

- `copilot.enable` (boolean): Enable/disable GitHub Copilot (default: true)
- `copilot.trace.server` (string): Language server communication tracing level
  - `\"off\"`: No tracing (default)
  - `\"messages\"`: Log messages
  - `\"trace\"`: Verbose tracing

## Status Bar

The extension displays the current Copilot status in the coc.nvim status bar:

- `Copilot: N/A` - Not authenticated or service unavailable
- `Copilot: Ready (username)` - Authenticated and ready

## Language Model API Integration

This extension automatically registers GitHub Copilot chat models with the LM API, making them available to other extensions like [@statiolake/coc-lm-chat](https://www.npmjs.com/package/@statiolake/coc-lm-chat).

### Available Models

The extension provides access to GitHub Copilot's chat models:

- `gpt-4.1` - Latest GPT-4 variant
- `o1-preview` - Reasoning model preview
- `o1-mini` - Lightweight reasoning model

## Usage

### Inline Completions

Once authenticated, Copilot will automatically provide suggestions in the coc.nvim completion popup as you type.

### Language Model Access

Other extensions can access Copilot models through the LM API:

```typescript
import type { LmApi } from '@statiolake/coc-lm-api';

const lmApi: LmApi = extensions.getExtensionById('@statiolake/coc-lm-api').exports;
const models = lmApi.selectChatModels({ vendor: 'GitHub' });
```

## Troubleshooting

### Authentication Issues

1. Make sure you have a valid GitHub Copilot subscription
2. Try signing out and signing in again: `:CocCommand copilot.signOut` then `:CocCommand copilot.signIn`
3. Check the status: `:CocCommand copilot.status`

### No Completions

1. Verify Copilot is enabled: `:CocCommand copilot.enable`
2. Check your internet connection
3. Ensure the file type is supported by Copilot

### Extension Dependencies

If you see errors about missing LM API:

1. Install the required dependency: `:CocInstall @statiolake/coc-lm-api`
2. Restart coc.nvim: `:CocRestart`

## Development

```bash
# Clone the repository
git clone https://github.com/statiolake/coc-github-copilot.git
cd coc-github-copilot

# Install dependencies
npm install

# Build
npm run build

# Watch mode for development
npm run watch

# Run linting
npm run lint
```

## Related Extensions

- **[@statiolake/coc-lm-api](https://www.npmjs.com/package/@statiolake/coc-lm-api)**: Required Language Model API interface
- **[@statiolake/coc-lm-chat](https://www.npmjs.com/package/@statiolake/coc-lm-chat)**: Interactive chat interface using Copilot models

## License

MIT

## Repository

[GitHub](https://github.com/statiolake/coc-github-copilot)

## Acknowledgments

- [GitHub Copilot](https://github.com/features/copilot) for AI assistance
- [coc.nvim](https://github.com/neoclide/coc.nvim) for the extension framework
- [@github/copilot-language-server](https://www.npmjs.com/package/@github/copilot-language-server) for the language server