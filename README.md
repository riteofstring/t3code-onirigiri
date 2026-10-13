# T3 Code

T3 Code is an "agent harness control surface". It enables control of the agents on your machine with a best-in-class mobile app ([iOS](https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824), [Android](https://play.google.com/store/apps/details?id=com.t3tools.t3code)), [web app](https://app.t3.codes) and [Electron-based desktop app](https://t3.codes).

Works with your subscriptions on Claude Code, Codex, Cursor, Grok Build, OpenCode, and Google Antigravity. If they're set up on your computer, T3 Code can control them.

## "Wait, what are you selling me?"

Nothing. We built T3 Code because we wanted the best possible development experience with agents. We were inspired by existing solutions like the Codex desktop app, Conductor, Claude Desktop and Cursor Glass, but none met our bar.

We wanted something performant, remote-ready, and truly open. If we ever go the wrong direction, we want you to have everything you need to fork and build the editor that you want.

## Onirigiri spatial workspace

This fork's spatial app lives in `apps/spatial`. Use each repository's pinned Node
and pnpm versions (Node 25.2.1 for the engine, Node 24 for T3), and Vite+ (see below). Clone the
engine's `beta` branch beside this repository using the exact sibling directory
name `onirigiri-beta`:

```bash
git clone --branch beta https://github.com/riteofstring/onirigiri.git onirigiri-beta
git clone git@github.com:riteofstring/t3code-onirigiri.git t3code-onirigiri
cd onirigiri-beta
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
cd ../t3code-onirigiri
vp install --frozen-lockfile
```

The engine exports compiled files, so rebuild it after changing its source. The
workspace layout adapter is included in `packages/onirigiri-t3` and needs no
separate clone or build.

For a local beta trial, build the production frontend so navigation does not
include development-mode overhead:

```bash
T3CODE_SINGLE_ORIGIN_DEV=1 vp run --filter @t3tools/spatial build
```

For the complete macOS experience, including embedded Browser panes, start the
production frontend in one terminal:

```bash
T3CODE_SINGLE_ORIGIN_DEV=1 T3CODE_PORT=5734 vp run --filter @t3tools/spatial preview --host 127.0.0.1 --port 5743 --strictPort
```

In another terminal in this repository, launch the desktop client against it:

```bash
vp run dev:desktop --port 5734 --dev-url http://127.0.0.1:5743 --home-dir "$HOME/.t3-onirigiri"
```

This starts Electron and its local backend, with separate trial data in
`~/.t3-onirigiri/userdata`. Keep both terminals running. Add a project and enable
an installed, authenticated provider in Settings → Providers. No existing T3
installation is required. Device panes additionally require T3's normal Device
setup, and pull-request panes require a linked repository and provider account.

For a browser-only trial, use the following backend command instead of the
desktop command. It uses the same separate trial data directory:

```bash
vp run dev:server --port 5734 --dev-url http://localhost:5743 --home-dir "$HOME/.t3-onirigiri"
```

In a second terminal in the same repository, serve the built spatial app:

```bash
T3CODE_SINGLE_ORIGIN_DEV=1 T3CODE_PORT=5734 vp run --filter @t3tools/spatial preview --port 5743 --strictPort
```

Open the backend's complete startup pairing URL in Chrome. The bare frontend
URL does not authenticate a new browser. After pairing, open
`http://localhost:5743/?layout=strip` for one row or
`http://localhost:5743/?layout=rows` for the two-dimensional workspace. Add a
project and enable an installed, authenticated provider in Settings → Providers.
No existing T3 installation is required.

The frontend proxies API and WebSocket requests to that backend. Keep both
terminals running; stop them with Control+C. Rebuild the frontend after updating
the checkout. For hot reload while editing, use this instead of the preview
command:

```bash
T3CODE_SINGLE_ORIGIN_DEV=1 T3CODE_PORT=5734 vp run --filter @t3tools/spatial dev
```

The existing `dev`, `dev:web`, and desktop commands retain their upstream entry
points unless the explicit spatial URL above is supplied. Embedded Browser
panes require the desktop client. The upstream installation instructions below
install standard T3 Code. See
[development setup](docs/operations/development.md) for authentication and data
directory details.

## Installation

> [!WARNING]
> T3 Code currently supports Codex, Claude, Cursor, Grok Build, OpenCode, and Antigravity. Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
> - Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
> - Cursor: install [Cursor CLI](https://cursor.com/cli) and run `agent login`
> - Grok Build: install [Grok Build CLI](https://x.ai/cli) and run `grok login`
> - OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`
> - Antigravity: enable it in Settings, then use **Install Antigravity** and **Sign in with Google**. No CLI is required.

### Command line

```bash
curl -fsSL https://t3.codes/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://t3.codes/install.ps1 | iex
```

Then run `t3` to start the server and open the local web app. `t3 service install` keeps it running in the background, `t3 update` moves to a newer release, and `t3 --help` has the full reference.

To try it once without installing, run `npx t3@latest` instead.

### Desktop app

Install the latest version of the desktop app from [GitHub Releases](https://github.com/pingdotgg/t3code/releases), or from your favorite package registry:

#### Windows (`winget`)

```bash
winget install T3Tools.T3Code
```

#### macOS (Homebrew)

```bash
brew install --cask t3-code
```

#### Debian, Ubuntu (`.deb`)

Download the `.deb` from [GitHub Releases](https://github.com/pingdotgg/t3code/releases), then:

```bash
sudo apt install ./T3-Code-*.deb
```

#### Arch Linux (AUR)

Stable:

```bash
yay -S t3code-bin
```

Nightly:

```bash
yay -S t3code-nightly-bin
```

The AUR packaging is maintained in this repository under [`packaging/aur`](./packaging/aur).

## Some notes

We are very very early in this project. Expect bugs.

We are (mostly) not accepting contributions yet. Small fixes may be considered. Big features will not be.

## Documentation

Full docs live in [docs/](./docs). There's no docs site yet.

- [Install and first run](./docs/user/install.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Project settings](./docs/user/project-settings.md)
- [Remote access from a phone or another machine](./docs/user/remote-access.md)
- [Keeping app and server in sync](./docs/user/updating.md)
- [Source control integrations](./docs/user/source-control.md)
- Multiple accounts: [Codex](./docs/user/providers-codex.md) · [Claude](./docs/user/providers-claude.md)
- [Run T3 Code as a background service](./docs/user/background-service.md)

Building from source? Start at [docs/internals/overview.md](./docs/internals/overview.md).

## If you REALLY want to contribute still.... read this first

### Install `vp`

T3 Code uses Vite+ so you'll need to install the global `vp` command-line tool.

#### macOS / Linux

```bash
curl -fsSL https://vite.plus | bash
```

#### Windows

```bash
irm https://vite.plus/ps1 | iex
```

Checkout their getting started guide for more information: https://viteplus.dev/guide/

### Install dependencies

```bash
vp i
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before reporting a bug or opening a PR.

Have a feature request? Start an [Ideas discussion](https://github.com/pingdotgg/t3code/discussions/categories/ideas).

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
