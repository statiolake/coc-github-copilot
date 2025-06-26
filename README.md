# coc-github-copilot

GitHub Copilot extension for coc.nvim with inline completion support.

## Features

- GitHub Copilot integration with coc.nvim
- Device authentication flow for GitHub
- Inline completions support
- Configurable settings
- Commands for managing Copilot status

## Installation

### Prerequisites

- [coc.nvim](https://github.com/neoclide/coc.nvim) installed
- Node.js 16+ 
- GitHub Copilot subscription

### Install from source

```bash
git clone https://github.com/your-username/coc-github-copilot.git
cd coc-github-copilot
npm install
npm run build
npm link
```

Then in your vim/neovim config, add the extension:

```vim
:CocInstall coc-github-copilot
```

Or add to your coc-settings.json:

```json
{
  "coc.preferences.extensionUpdateCheck": "daily"
}
```

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

Add these settings to your `coc-settings.json`:

```json
{
  "copilot.enable": true,
  "copilot.priority": 1000,
  "copilot.limit": 10,
  "copilot.shortcut": "Cop"
}
```

### Settings

- `copilot.enable` (boolean, default: `true`) - Enable/disable GitHub Copilot
- `copilot.priority` (number, default: `1000`) - Priority of copilot completion source
- `copilot.limit` (number, default: `10`) - Maximum number of completion items
- `copilot.shortcut` (string, default: `"Cop"`) - Shortcut text shown in completion menu

## Usage

Once authenticated and enabled, Copilot will automatically provide completions in the coc.nvim completion menu.

### Keybindings  

You can add custom keybindings in your vim configuration:

```vim
" Accept completion 
inoremap <silent><expr> <Tab> coc#pum#visible() ? coc#pum#confirm() : "\<Tab>"

" Trigger completion manually
inoremap <silent><expr> <C-Space> coc#refresh()

" Navigate completions
inoremap <silent><expr> <C-n> coc#pum#visible() ? coc#pum#next(1) : "\<C-n>"
inoremap <silent><expr> <C-p> coc#pum#visible() ? coc#pum#prev(1) : "\<C-p>"

" Toggle Copilot
nnoremap <leader>ct :CocCommand copilot.enable<CR>
nnoremap <leader>cd :CocCommand copilot.disable<CR>
```

## Troubleshooting

### Authentication Issues

If you're having trouble signing in:

1. Make sure you have a GitHub Copilot subscription
2. Check your internet connection  
3. Try signing out and signing in again: `:CocCommand copilot.signOut` then `:CocCommand copilot.signIn`

### No Completions

If you're not getting completions:

1. Check if Copilot is enabled: `:CocCommand copilot.status`
2. Verify your authentication status
3. Check the coc.nvim output: `:CocCommand workspace.showOutput`
4. Try triggering completion manually with `Ctrl+Space`

### Performance Issues

If you experience performance issues:

1. Reduce `copilot.limit` to a lower number (e.g., 5)
2. Adjust `copilot.priority` to control source ordering
3. Adjust coc.nvim completion settings

## Development

```bash
# Clone the repository
git clone https://github.com/your-username/coc-github-copilot.git
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