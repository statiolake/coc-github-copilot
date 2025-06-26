# @statiolake/coc-github-copilot

GitHub Copilot extension for coc.nvim using the official GitHub Copilot Language Server.

## Features

- 🤖 GitHub Copilot integration with coc.nvim
- 🔐 Device authentication flow
- ⚡ Automatic inline completions via Language Server
- 🛠️ Simple configuration
- 🔌 Seamless Language Server integration

## Installation

### From npm

```bash
npm install -g @statiolake/coc-github-copilot
```

Or in Vim/Neovim:

```vim
:CocInstall @statiolake/coc-github-copilot
```

### Prerequisites

- [coc.nvim](https://github.com/neoclide/coc.nvim) 0.0.82+
- Node.js 16+
- GitHub Copilot subscription

## Setup

1. Install the extension
2. Run `:CocCommand copilot.signIn` to authenticate with GitHub
3. Follow the device authentication flow
4. Start coding with Copilot suggestions!

## Commands

- `:CocCommand copilot.signIn` - Sign in to GitHub Copilot
- `:CocCommand copilot.signOut` - Sign out from GitHub Copilot
- `:CocCommand copilot.status` - Show current authentication status
- `:CocCommand copilot.enable` - Enable Copilot suggestions
- `:CocCommand copilot.disable` - Disable Copilot suggestions

## Configuration

The extension works out of the box with minimal configuration. All settings are managed through the Language Server.

## Usage

Once authenticated and enabled, Copilot will automatically provide completions in the coc.nvim completion menu.

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
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License

## Acknowledgments

- [GitHub Copilot](https://github.com/features/copilot) for the AI assistance
- [coc.nvim](https://github.com/neoclide/coc.nvim) for the extension framework
- [@github/copilot-language-server](https://www.npmjs.com/package/@github/copilot-language-server) for the language server
