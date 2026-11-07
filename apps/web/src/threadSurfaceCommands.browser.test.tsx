import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { StrictMode, useState } from "react";
import { expect, it } from "vite-plus/test";

import { render } from "../test/render";
import {
  requestThreadSurfaceCommand,
  type ThreadSurfaceCommand,
  useThreadSurfaceCommandHandler,
} from "./threadSurfaceCommands";

const command = (text: string): ThreadSurfaceCommand => ({
  kind: "add-terminal-context",
  selection: { terminalId: "terminal", terminalLabel: "Terminal", lineStart: 1, lineEnd: 1, text },
});

function Consumer({ threadRef }: { threadRef: ScopedThreadRef | null }) {
  const [delivered, setDelivered] = useState<string[]>([]);
  useThreadSurfaceCommandHandler(threadRef, (next) => {
    if (next.kind === "add-terminal-context") {
      setDelivered((previous) => [...previous, next.selection.text]);
    }
  });
  return <output>{delivered.join("|")}</output>;
}

it("delivers commands queued before the owning chat mounts exactly once, in StrictMode", async () => {
  const threadRef = scopeThreadRef(EnvironmentId.make("local"), ThreadId.make("queued"));
  requestThreadSurfaceCommand(threadRef, command("first"));
  requestThreadSurfaceCommand(threadRef, command("second"));
  // A bare hook probe; nothing here navigates.
  await using screen = await render(
    <StrictMode>
      <Consumer threadRef={threadRef} />
    </StrictMode>,
    { router: false },
  );
  expect(screen.container.textContent).toBe("first|second");
  await screen.rerender(null);
  await screen.rerender(<Consumer threadRef={threadRef} />);
  expect(screen.container.textContent).toBe("");
});
