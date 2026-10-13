import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { PreviewAnnotationPayload, ScopedThreadRef } from "@t3tools/contracts";
import { useLayoutEffect, useRef } from "react";

import type { ComposerImageAttachment } from "./composerDraftStore";
import type { TerminalContextSelection } from "./lib/terminalContext";

export type ThreadSurfaceCommand =
  | {
      kind: "send-annotation";
      annotation: PreviewAnnotationPayload;
      image: ComposerImageAttachment | null;
    }
  | { kind: "add-terminal-context"; selection: TerminalContextSelection };

type CommandHandler = (command: ThreadSurfaceCommand) => void;

const pending = new Map<string, ThreadSurfaceCommand[]>();
const handlers = new Map<string, CommandHandler>();
const draining = new Set<string>();

function drain(threadKey: string): void {
  if (draining.has(threadKey)) return;
  draining.add(threadKey);
  try {
    for (;;) {
      const handler = handlers.get(threadKey);
      const queue = pending.get(threadKey);
      if (!handler || !queue) return;
      const command = queue.shift();
      if (queue.length === 0) pending.delete(threadKey);
      if (command) handler(command);
    }
  } finally {
    draining.delete(threadKey);
  }
}

export function requestThreadSurfaceCommand(
  threadRef: ScopedThreadRef,
  command: ThreadSurfaceCommand,
): void {
  const threadKey = scopedThreadKey(threadRef);
  const queue = pending.get(threadKey) ?? [];
  queue.push(command);
  pending.set(threadKey, queue);
  drain(threadKey);
}

export function useThreadSurfaceCommandHandler(
  threadRef: ScopedThreadRef | null,
  handler: CommandHandler,
): void {
  const handlerRef = useRef(handler);
  useLayoutEffect(() => {
    handlerRef.current = handler;
  });
  const threadKey = threadRef ? scopedThreadKey(threadRef) : null;
  useLayoutEffect(() => {
    if (threadKey === null) return;
    const receive: CommandHandler = (command) => handlerRef.current(command);
    handlers.set(threadKey, receive);
    drain(threadKey);
    return () => {
      if (handlers.get(threadKey) === receive) handlers.delete(threadKey);
    };
  }, [threadKey]);
}
