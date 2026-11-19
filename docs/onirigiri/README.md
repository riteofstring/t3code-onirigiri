# Onirigiri for T3 Code

This fork replaces T3 Code's chat area with an [Onirigiri](https://github.com/riteofstring/onirigiri)
workspace: a niri-style canvas where every conversation, terminal, browser, file view and diff is a
pane you can arrange in rows and columns, pan across and zoom out to an overview. T3's sidebar,
settings and providers are unchanged. The spatial app lives in `apps/spatial`.

This is an alpha. Expect rough edges; the [root README](../../README.md#known-limits) lists the
known limits. To install a packaged build, download it from
[Releases](https://github.com/riteofstring/t3code-onirigiri/releases).

## Get it running

You need Git, [Node](https://nodejs.org) at the version pinned in `package.json` (`engines`) and
Corepack for pnpm. Node no longer bundles Corepack, so install it with
`npm install --global corepack`. The engine and the `onirigiri-t3-adapter` package are vendored as
tarballs in `apps/spatial/vendor`; each file name ends with the commit it was packed from, so
nothing else needs cloning.

```bash
git clone https://github.com/riteofstring/t3code-onirigiri.git
cd t3code-onirigiri
corepack pnpm install --frozen-lockfile --ignore-scripts
T3CODE_SINGLE_ORIGIN_DEV=1 npx vp run --filter @t3tools/spatial build
```

To change the engine or adapter, build and `pnpm pack` it, replace the tarball in
`apps/spatial/vendor`, update the path in `apps/spatial/package.json` and reinstall.

### As a packaged desktop app

`npx vp run dist:desktop:dmg:arm64` on a Mac with Rust installed writes an unsigned disk image to
`release/`; `dist:desktop:linux` and `dist:desktop:win:x64` build a Linux AppImage and a Windows
installer the same way. The `Onirigiri Desktop Alpha` workflow builds all three on GitHub and
attaches them to the run; for a tag named `onirigiri-alpha-*` it also collects them in a draft
prerelease. The app installs as "Onirigiri for T3 Code (Alpha)", while its own windows and menus
still say "T3 Code (Beta)". It reads and writes the same `~/.t3` data as T3 Code, so quit T3 Code
first and keep a copy of that folder. On Windows the installer uses T3 Code's installer identity
and install folder, so it replaces an installed T3 Code. The builds are unsigned: macOS asks you
to allow the app under System Settings → Privacy & Security, and Windows SmartScreen asks you to
choose "Run anyway". They carry no update feed, so the app does not update itself.

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

Pane pictures need WebGPU and Chrome's HTML-in-Canvas flag (`chrome://flags/#canvas-draw-element`);
the desktop app turns the feature on by itself. Without them every pane stays live and nothing else
changes.

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

## Troubleshooting pane pictures

The workspace has a readout that shows whether pictures are being taken: the browser version,
whether HTML-in-Canvas and WebGPU are available, and how many captures started, were saved or
failed. In the browser, add `?pictureStatus=1` to the address; `?pictureStatus=0` hides it again.
In the desktop app, open View → Toggle Developer Tools and run this in the Console:

```js
sessionStorage.setItem("onirigiri.pictureStatus", "1");
location.reload();
```

The Pane pictures button in the workspace controls turns pictures off and on, which reloads the
window, so you can compare the two.

`?otherPanes=pictures` is an experiment that also pictures terminal, file and browser panes while
they move. It is not supported, and `?otherPanes=live` switches it off again.

## Notes

Design constraints that span files are in [design.md](design.md).
