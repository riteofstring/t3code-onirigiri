<p align="center">
  <img src="docs/onirigiri/images/banner.jpg" alt="Onirigiri × T3 Code: spatial windows for T3 Code" width="880">
</p>

# Onirigiri for T3 Code (Alpha)

An unofficial fork of [T3 Code](https://github.com/pingdotgg/t3code) that replaces the chat area
with an [Onirigiri](https://github.com/riteofstring/onirigiri) spatial workspace. Every
conversation, terminal, browser, file view and diff is a pane on a niri-style canvas: arrange panes
in rows and columns, pan across them and zoom out to an overview. T3 Code's sidebar, settings and
providers are unchanged.

This is an alpha. It is not made, endorsed or supported by the T3 Code team.

## Install

Download the installer for your platform from
[Releases](https://github.com/riteofstring/t3code-onirigiri/releases).

| Platform              | File        | First launch                                                     |
| --------------------- | ----------- | ---------------------------------------------------------------- |
| macOS (Apple silicon) | `.dmg`      | Allow the app under System Settings → Privacy & Security         |
| Windows (x64)         | `.exe`      | In the SmartScreen prompt, choose "More info", then "Run anyway" |
| Linux (x64)           | `.AppImage` | Make the file executable, then run it                            |

The installers are unsigned, which is why macOS and Windows ask before the first launch. Where
Windows Smart App Control is on, it blocks the installer and offers no way to run it.

The app installs as "Onirigiri for T3 Code (Alpha)"; its own windows and menus still say
"T3 Code (Beta)". It reads and writes the same `~/.t3` data as T3 Code. Quit T3 Code before you
start it, and keep a copy of that folder. On Windows the installer uses T3 Code's installer identity
and install folder, so it replaces an installed T3 Code.

Like T3 Code, it drives the coding agents already installed and signed in on your machine. See
[Install and first run](docs/user/install.md) for the providers and how to set them up.

Unlike T3 Code, this fork sends no product usage data unless you set
`T3CODE_TELEMETRY_ENABLED=true`. [Product usage data](docs/user/telemetry.md) lists what T3 Code
sends.

To build from source or run it in a browser, see the [Onirigiri guide](docs/onirigiri/README.md).

## Using the workspace

The controls at the bottom right switch between the two-dimensional layout and a single strip, open
the overview, show the minimap and set row height and column width. On macOS use Option for the
shortcuts below; elsewhere use Alt.

| Keys                      | Action                                                     |
| ------------------------- | ---------------------------------------------------------- |
| Option + arrows           | Move between panes                                         |
| Shift + Option + arrows   | Move between panes while typing                            |
| Option + Control + arrows | Move the focused pane                                      |
| Option + O                | Overview                                                   |
| Option + N                | New pane                                                   |
| Enter                     | Leave the overview at the selection, or fill an empty cell |

The [Onirigiri guide](docs/onirigiri/README.md#using-the-workspace) covers the rest.

## Known limits

- Shortly after a move, about one key press in ten takes more than 100 ms to appear, and up to
  about 0.4 s, while a chat is pictured or a neighbour loads in the background.
- Terminal and file panes drop keys typed before their text field takes focus on arrival.
- Leaving a maximized pane measured slower in this build than in the one before it; the cause is
  not yet traced.
- With the processor slowed four times, about one move in twenty has a frame gap of about a second
  as it comes to rest.
- Only chats have pictures. Other panes stay live while moving and in the overview.
- 4K displays and graphics memory use are untested.
- The Windows build leaves out the runtime T3 Code installs into a WSL distro, so running agents
  in WSL is untested and may not work.
- The app does not update itself. Download newer builds from Releases.
- The fork follows T3 Code's `main` as of 7 November 2026.

## Reporting problems

Report problems with this fork in
[its own issues](https://github.com/riteofstring/t3code-onirigiri/issues), not in T3 Code's issue
tracker, Discussions or Discord.

## T3 Code

Everything outside the workspace is T3 Code, and its [documentation](docs/) applies unchanged. For
the standard app, its installers and its community, go to
[pingdotgg/t3code](https://github.com/pingdotgg/t3code).

The repository keeps T3 Code's [MIT license](LICENSE). The Onirigiri engine is licensed under
Apache 2.0.
