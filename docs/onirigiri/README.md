# Onirigiri spatial workspace

This fork's spatial app lives in `apps/spatial`. Use each repository's pinned Node
and pnpm versions (Node 25.2.1 for the engine, Node 24 for T3), and Vite+ (see the
[root README](../../README.md)). Clone the engine's `beta` branch beside this
repository using the exact sibling directory name `onirigiri-beta`:

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

For a step-by-step trial on a fresh Mac, written for a setup agent, see
[the macOS beta trial](beta-trial-macos.md).

The pinned Vite+ 1.0.0 toolchain contains editor-launch vulnerabilities:
[Windows percent expansion](https://github.com/vitejs/launch-editor/security/advisories/GHSA-698v-4r3x-3vcv),
[a Windows existence-check bypass](https://github.com/vitejs/launch-editor/security/advisories/GHSA-587h-7wmj-h5pm)
and [WSL editor argument injection](https://github.com/vitejs/launch-editor/security/advisories/GHSA-r825-w8mm-5pxw).
The Windows combination does not require an attacker-created file. Loopback
binding alone does not prevent malicious local-page requests, and `--share`
additionally exposes a development server to tailnet peers.

Web, spatial and marketing development servers disable Vite's editor-launch
HTTP endpoint before its middleware can handle a request. The development error
overlay's source-file links therefore do not launch an editor. T3's own editor
commands, hot reload and production UI retain their behavior. The built spatial
frontend served with `preview` has no editor-launch endpoint. Custom Vite server
configurations must include `scripts/lib/disable-dev-editor.ts` until the
bundled dependency is updated.

Reviewed by Codex on 2026-10-20: retain the pinned toolchain with this mitigation
and update Vite+ and its pinned core together to 1.1.0 by 2026-11-07, after the fix
reaches 30 days on 2026-11-06. The HTTP tests prove endpoint rejection, not safe
Windows parsing in the affected launcher. Remove the temporary mitigation and
this note after verifying the dependency update.

The existing `dev`, `dev:web`, and desktop commands retain their upstream entry
points unless the explicit spatial URL above is supplied. Embedded Browser
panes require the desktop client. The upstream installation instructions in the
[root README](../../README.md) install standard T3 Code. See
[development setup](../operations/development.md) for authentication and data
directory details.

Design constraints that span files are recorded in [design.md](design.md).
