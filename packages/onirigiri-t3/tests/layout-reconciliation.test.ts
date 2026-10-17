import { describe, expect, it } from "vite-plus/test";

import { reconcileWorkspaceLayout, type WorkspaceLayout } from "../src/index.js";
import type { LiveThread } from "../src/workspace-layout.js";

function thread(id: string, projectId: string, archived = false): LiveThread {
  return { id, projectId, archived };
}

function rowThreads(layout: WorkspaceLayout): Record<string, string[]> {
  return Object.fromEntries(
    layout.rows.map((row) => [row.projectId, row.panes.map((pane) => pane.threadId)]),
  );
}

describe("reconcileWorkspaceLayout", () => {
  it("builds one row per live project with its active threads when nothing is saved", () => {
    const layout = reconcileWorkspaceLayout(
      { rows: [] },
      {
        projects: [{ id: "api" }, { id: "web" }],
        threads: [
          thread("t1", "web"),
          thread("t2", "api"),
          thread("t3", "web"),
          thread("t4", "api", true),
        ],
      },
    );

    expect(layout).toEqual({
      rows: [
        { projectId: "api", panes: [{ threadId: "t2" }] },
        {
          projectId: "web",
          panes: [{ threadId: "t1" }, { threadId: "t3" }],
        },
      ],
    });
  });

  it("keeps the saved row and pane order and puts new threads first in their row", () => {
    const layout = reconcileWorkspaceLayout(
      {
        rows: [
          {
            projectId: "web",
            panes: [{ threadId: "t3" }, { threadId: "t1" }],
          },
          { projectId: "api", panes: [{ threadId: "t2" }] },
        ],
      },
      {
        projects: [{ id: "api" }, { id: "web" }],
        threads: [
          thread("t1", "web"),
          thread("t2", "api"),
          thread("t3", "web"),
          thread("t5", "web"),
          thread("t6", "api"),
        ],
      },
    );

    expect(rowThreads(layout)).toEqual({
      web: ["t5", "t3", "t1"],
      api: ["t6", "t2"],
    });
    expect(layout.rows.map((row) => row.projectId)).toEqual(["web", "api"]);
  });

  it("drops archived and unknown threads and rows of removed projects", () => {
    const layout = reconcileWorkspaceLayout(
      {
        rows: [
          { projectId: "gone", panes: [{ threadId: "g1" }] },
          {
            projectId: "web",
            panes: [{ threadId: "t1" }, { threadId: "deleted" }, { threadId: "t2" }],
          },
        ],
      },
      {
        projects: [{ id: "web" }],
        threads: [thread("g1", "gone"), thread("t1", "web", true), thread("t2", "web")],
      },
    );

    expect(layout).toEqual({
      rows: [{ projectId: "web", panes: [{ threadId: "t2" }] }],
    });
  });

  it("appends rows for new projects after the saved rows in live order", () => {
    const layout = reconcileWorkspaceLayout(
      { rows: [{ projectId: "web", panes: [] }] },
      {
        projects: [{ id: "docs" }, { id: "web" }, { id: "api" }],
        threads: [thread("d1", "docs")],
      },
    );

    expect(rowThreads(layout)).toEqual({ web: [], docs: ["d1"], api: [] });
    expect(layout.rows.map((row) => row.projectId)).toEqual(["web", "docs", "api"]);
  });

  it("moves a thread saved in another project's row back to its own row and keeps one pane per thread", () => {
    const layout = reconcileWorkspaceLayout(
      {
        rows: [
          {
            projectId: "api",
            panes: [{ threadId: "w1" }, { threadId: "a1" }, { threadId: "a1" }],
          },
          { projectId: "web", panes: [{ threadId: "w2" }] },
          { projectId: "api", panes: [{ threadId: "a2" }] },
        ],
      },
      {
        projects: [{ id: "api" }, { id: "web" }],
        threads: [
          thread("a1", "api"),
          thread("a2", "api"),
          thread("w1", "web"),
          thread("w2", "web"),
        ],
      },
    );

    expect(rowThreads(layout)).toEqual({
      api: ["a2", "a1"],
      web: ["w1", "w2"],
    });
    expect(layout.rows).toHaveLength(2);
  });

  it("returns a layout that reconciles to itself", () => {
    const live = {
      projects: [{ id: "api" }, { id: "web" }],
      threads: [thread("t1", "web"), thread("t2", "api"), thread("t3", "web")],
    };
    const once = reconcileWorkspaceLayout(
      {
        rows: [
          {
            projectId: "web",
            panes: [{ threadId: "t3" }, { threadId: "stale" }],
          },
        ],
      },
      live,
    );

    expect(reconcileWorkspaceLayout(once, live)).toEqual(once);
  });
});
