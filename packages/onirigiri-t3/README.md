# Onirigiri workspace adapter

Private workspace package used by `apps/spatial`. It exports
`reconcileWorkspaceLayout` and its layout types directly from TypeScript
source, following the other T3 workspace packages. No separate build is needed.

## Layout reconciliation

A saved workspace layout is a list of project rows, each holding thread panes.
The layout outlives the data it refers to: projects are removed, threads are
archived or deleted, and new threads appear between live updates.
`reconcileWorkspaceLayout` brings a saved layout up to date with the live
projects and threads before the workspace renders it.

### Rules

- The user's arrangement wins. Saved rows keep their order, and saved panes
  keep their order within a row.
- Live data decides membership. A row survives only while its project is live,
  and a thread pane survives only in the row of its own live project while the
  thread is not archived. Everything else is dropped.
- New projects are appended and new threads lead. Projects without a saved
  row are added after the saved rows. Threads without a pane are added to the
  front of their project's row, since rows run from the most recent thread and
  a new thread is the most recent. Both keep the order the live data lists
  them in.
- Each project has one row and each thread one pane. The first saved
  occurrence wins; a thread found only in another project's row is treated as
  new in its own row.
- The result reconciles to itself, so the adapter can reconcile on every live
  update without the layout drifting.

### Boundaries

The function is pure and takes its own minimal types, not T3's or
Onirigiri's. `apps/spatial` maps T3's project and thread selectors to
`LiveWorkspace` and maps rows and panes to Onirigiri's layout, so neither
upstream's types nor Onirigiri's scene format leak into this package.
