// @vitest-environment jsdom

import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { act, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  requestThreadSurfaceCommand,
  type ThreadSurfaceCommand,
  useThreadSurfaceCommandHandler,
} from "./threadSurfaceCommands";

const command = (text: string): ThreadSurfaceCommand => ({
  kind: "add-terminal-context",
  selection: { terminalId: "terminal", terminalLabel: "Terminal", lineStart: 1, lineEnd: 1, text },
});

function Consumer({
  threadRef,
  prefix = "",
}: {
  threadRef: ScopedThreadRef | null;
  prefix?: string;
}) {
  const [delivered, setDelivered] = useState<string[]>([]);
  useThreadSurfaceCommandHandler(threadRef, (next) => {
    if (next.kind === "add-terminal-context") {
      setDelivered((previous) => [...previous, prefix + next.selection.text]);
    }
  });
  return <output>{delivered.join("|")}</output>;
}

describe("thread surface commands", () => {
  let root: Root;
  let container: HTMLDivElement;
  let threadRef: ScopedThreadRef;
  let nextThreadId = 0;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    threadRef = scopeThreadRef(
      EnvironmentId.make("local"),
      ThreadId.make(`thread-${nextThreadId++}`),
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("delivers pending commands once when the owning chat mounts in StrictMode", async () => {
    requestThreadSurfaceCommand(threadRef, command("first"));
    requestThreadSurfaceCommand(threadRef, command("second"));
    await act(() =>
      root.render(
        <StrictMode>
          <Consumer threadRef={threadRef} />
        </StrictMode>,
      ),
    );
    expect(container.textContent).toBe("first|second");
    await act(() => root.render(null));
    await act(() => root.render(<Consumer threadRef={threadRef} />));
    expect(container.textContent).toBe("");
  });

  it("keeps commands queued while the owner is not ready and after unmount", async () => {
    await act(() => root.render(<Consumer threadRef={null} />));
    requestThreadSurfaceCommand(threadRef, command("waiting"));
    expect(container.textContent).toBe("");
    await act(() => root.render(<Consumer threadRef={threadRef} />));
    expect(container.textContent).toBe("waiting");
    await act(() => root.render(null));
    requestThreadSurfaceCommand(threadRef, command("returned"));
    await act(() => root.render(<Consumer threadRef={threadRef} />));
    expect(container.textContent).toBe("returned");
  });

  it("isolates identical thread ids on different environments", async () => {
    const other = scopeThreadRef(EnvironmentId.make("remote"), threadRef.threadId);
    requestThreadSurfaceCommand(other, command("remote"));
    await act(() => root.render(<Consumer threadRef={threadRef} />));
    await act(() => requestThreadSurfaceCommand(threadRef, command("local")));
    expect(container.textContent).toBe("local");
    await act(() => root.render(<Consumer key="remote" threadRef={other} />));
    expect(container.textContent).toBe("remote");
  });

  it("uses the latest committed handler without replaying earlier commands", async () => {
    await act(() => root.render(<Consumer threadRef={threadRef} prefix="old:" />));
    await act(() => requestThreadSurfaceCommand(threadRef, command("one")));
    await act(() => root.render(<Consumer threadRef={threadRef} prefix="new:" />));
    await act(() => requestThreadSurfaceCommand(threadRef, command("two")));
    expect(container.textContent).toBe("old:one|new:two");
  });
});
