# Onirigiri for T3 Code

This fork replaces T3 Code's chat area with an [Onirigiri](https://github.com/riteofstring/onirigiri)
workspace: a niri-style canvas where every conversation, terminal, browser, file view and diff is a
pane you can arrange in rows and columns, pan across and zoom out to an overview. T3's sidebar,
settings and providers are unchanged. The spatial app lives in `apps/spatial`.

This is a beta demo. Expect rough edges.

## Get it running

You need Git, [Node](https://nodejs.org) at the version pinned in `package.json` (`engines`) and
Corepack for pnpm. The engine and the `onirigiri-t3-adapter` package are vendored as tarballs in
`apps/spatial/vendor`; each file name ends with the commit it was packed from, so nothing else needs
cloning.

```bash
git clone --branch release/cleanup-base https://github.com/riteofstring/t3code-onirigiri.git
cd t3code-onirigiri
corepack pnpm install --frozen-lockfile --ignore-scripts
T3CODE_SINGLE_ORIGIN_DEV=1 npx vp run --filter @t3tools/spatial build
```

To change the engine or adapter, build and `pnpm pack` it, replace the tarball in
`apps/spatial/vendor`, update the path in `apps/spatial/package.json` and reinstall.

### As a packaged macOS app

`npx vp run dist:desktop:dmg:arm64` on a Mac with Rust installed writes an unsigned disk image to
`release/`. The `Onirigiri macOS Alpha` workflow does the same on GitHub and attaches the image to
the run. The app is named "Onirigiri for T3 Code (Alpha)" and installs beside T3 Code, but it reads
and writes the same `~/.t3` data, so quit T3 Code first and keep a copy of that folder. The image is
unsigned: macOS asks you to allow it under System Settings → Privacy & Security.

### In the browser

Start the backend in one terminal. It keeps its data in its own directory, separate from any T3 Code
installation:

```bash
npx vp run dev:server --port 5734 --dev-url http://localhost:5743 --home-dir "$HOME/.t3-onirigiri"
```

Serve the spatial app in a second terminal:

```bash
T3CODE_SINGLE_ORIGIN_DEV=1 T3CODE_PORT=5734 npx vp run --filter @t3tools/spatial preview --port 5743 --strictPort
```

Open the pairing URL the backend prints (`http://localhost:5743/pair#token=…`) in Chrome. Then add a
project and enable an installed, signed-in provider in Settings → Providers. Embedded browser panes
need the desktop app.

### In the desktop app

Keep the second terminal above running and start the desktop client in place of the backend:

```bash
npx vp run dev:desktop --port 5734 --dev-url http://127.0.0.1:5743 --home-dir "$HOME/.t3-onirigiri"
```

For hot reload while editing, replace the `preview` command with
`T3CODE_SINGLE_ORIGIN_DEV=1 T3CODE_PORT=5734 npx vp run --filter @t3tools/spatial dev`.

## Using the workspace

The controls at the bottom right switch between the two-dimensional layout and a single strip, open
the overview, show the minimap and set row height and column width. The keyboard button in the
advanced controls lists every shortcut. The main ones (Option on macOS, Alt elsewhere):

| Keys                      | Action                                                     |
| ------------------------- | ---------------------------------------------------------- |
| Option + arrows           | Move between panes                                         |
| Shift + Option + arrows   | Move between panes while typing                            |
| Option + Control + arrows | Move the focused pane                                      |
| Option + O                | Overview                                                   |
| Option + N                | New pane                                                   |
| Enter                     | Leave the overview at the selection, or fill an empty cell |

Click **New pane** in an empty cell to add a chat, terminal, browser, files, diff or other tool beside
the conversation it belongs to.

## Notes

Design constraints that span files are in [design.md](design.md). The root
[README](../../README.md) installs standard T3 Code, not this fork.
