import { RegistryContext } from "@effect/atom-react";
import type { VcsStatusResult } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useEnvironmentQuery } from "../state/query";
import { useChatViewVcsStatus } from "./chatViewVcsStatus";

type StatusResult = AsyncResult.AsyncResult<VcsStatusResult, Error>;
type StatusAtom = Atom.Atom<StatusResult>;
type ChatStatus = ReturnType<typeof useChatViewVcsStatus>;

const STATUS: VcsStatusResult = {
  isRepo: true,
  hasPrimaryRemote: true,
  isDefaultRef: true,
  refName: "main",
  hasWorkingTreeChanges: false,
  workingTree: { files: [], insertions: 0, deletions: 0 },
  hasUpstream: true,
  aheadCount: 0,
  behindCount: 0,
  pr: null,
};
let registry: AtomRegistry.AtomRegistry;
let renderer: ReactTestRenderer | undefined;

function Probe({
  atom,
  onRender,
  name = "chat",
}: {
  atom: StatusAtom | null;
  onRender: (status: ChatStatus) => void;
  name?: string;
}) {
  const status = useChatViewVcsStatus(atom);
  onRender(status);
  return (
    <button data-probe={name} onClick={status.refresh}>
      {JSON.stringify({ data: status.data, error: status.error })}
    </button>
  );
}

function FullStatusProbe({
  atom,
  onData,
}: {
  atom: StatusAtom;
  onData: (data: VcsStatusResult | null) => void;
}) {
  const status = useEnvironmentQuery(atom);
  onData(status.data);
  return null;
}

async function render(children: ReactNode) {
  await act(() => {
    const tree = <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>;
    if (renderer) renderer.update(tree);
    else renderer = create(tree);
  });
}

function displayed(name = "chat") {
  return JSON.parse(renderer!.root.findByProps({ "data-probe": name }).children.join(""));
}

async function publish(atom: Atom.Writable<StatusResult, StatusResult>, value: StatusResult) {
  await act(() => registry.set(atom, value));
}

beforeEach(() => {
  registry = AtomRegistry.make();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  registry.dispose();
  vi.unstubAllGlobals();
});

describe("ChatView VCS selection", () => {
  it("does not rerender for equal replay or refresh metadata", async () => {
    const atom = Atom.make<StatusResult>(AsyncResult.success(STATUS, { timestamp: 1 }));
    const rendered = vi.fn<(status: ChatStatus) => void>();
    await render(<Probe atom={atom} onRender={rendered} />);
    const refresh = rendered.mock.lastCall![0].refresh;

    await publish(atom, AsyncResult.success(STATUS, { timestamp: 2 }));
    await publish(atom, AsyncResult.success(structuredClone(STATUS), { timestamp: 3 }));
    await publish(atom, AsyncResult.waiting(registry.get(atom)));
    await publish(atom, AsyncResult.success(structuredClone(STATUS), { timestamp: 4 }));

    expect(rendered).toHaveBeenCalledOnce();
    expect(displayed()).toEqual({
      data: { isRepo: true, refName: "main", hasWorkingTreeChanges: false, pr: null },
      error: null,
    });

    await publish(atom, AsyncResult.success({ ...STATUS, refName: "topic" }));
    expect(rendered).toHaveBeenCalledTimes(2);
    expect(displayed().data.refName).toBe("topic");
    expect(rendered.mock.lastCall![0].refresh).toBe(refresh);
  });

  it("updates repository, branch and working-tree changes without remounting", async () => {
    const atom = Atom.make<StatusResult>(AsyncResult.success(STATUS));
    const onRender = vi.fn<(status: ChatStatus) => void>();
    await render(<Probe atom={atom} onRender={onRender} />);

    await publish(atom, AsyncResult.success({ ...STATUS, hasWorkingTreeChanges: true }));
    expect(displayed().data.hasWorkingTreeChanges).toBe(true);
    await publish(atom, AsyncResult.success({ ...STATUS, refName: "feature" }));
    expect(displayed().data).toEqual({
      isRepo: true,
      refName: "feature",
      hasWorkingTreeChanges: false,
      pr: null,
    });
    await publish(atom, AsyncResult.success({ ...STATUS, isRepo: false, refName: null }));
    expect(displayed().data).toEqual({
      isRepo: false,
      refName: null,
      hasWorkingTreeChanges: false,
      pr: null,
    });
    expect(onRender).toHaveBeenCalledTimes(4);
  });

  it("leaves remote and nested status changes available to full Git consumers", async () => {
    const atom = Atom.make<StatusResult>(AsyncResult.success(STATUS));
    const onRender = vi.fn<(status: ChatStatus) => void>();
    const onData = vi.fn<(data: VcsStatusResult | null) => void>();
    await render(
      <>
        <Probe atom={atom} onRender={onRender} />
        <FullStatusProbe atom={atom} onData={onData} />
      </>,
    );

    const changed = {
      ...STATUS,
      aheadCount: 2,
      workingTree: {
        files: [{ path: "src/app.ts", insertions: 4, deletions: 1 }],
        insertions: 4,
        deletions: 1,
      },
      hasWorkingTreeChanges: true,
      pr: {
        number: 12,
        title: "Feature",
        url: "https://example.com/pr/12",
        baseRef: "main",
        headRef: "feature",
        state: "open",
        updatedAt: "2026-10-11T01:00:00Z",
      },
    } satisfies VcsStatusResult;
    await publish(atom, AsyncResult.success(changed));
    expect(displayed().data.hasWorkingTreeChanges).toBe(true);
    const previousRenderCount = onRender.mock.calls.length;
    const remoteChange = {
      ...changed,
      aheadCount: 3,
      pr: { ...changed.pr, updatedAt: "2026-10-11T02:00:00Z" },
    };
    await publish(atom, AsyncResult.success(remoteChange));

    expect(onRender).toHaveBeenCalledTimes(previousRenderCount);
    expect(onData.mock.lastCall![0]).toEqual(remoteChange);
    expect(onData.mock.lastCall![0]?.workingTree.files[0]?.path).toBe("src/app.ts");

    await publish(
      atom,
      AsyncResult.success({ ...remoteChange, pr: { ...remoteChange.pr, state: "closed" } }),
    );
    expect(displayed().data.pr).toEqual({
      number: 12,
      url: "https://example.com/pr/12",
      state: "closed",
      headRef: "feature",
    });
    expect(onRender).toHaveBeenCalledTimes(previousRenderCount + 1);
  });

  it("shows initial failure, retains successful data through failure, and clears recovered errors", async () => {
    const atom = Atom.make<StatusResult>(AsyncResult.initial(false));
    const onRender = vi.fn<(status: ChatStatus) => void>();
    await render(<Probe atom={atom} onRender={onRender} />);
    expect(displayed()).toEqual({ data: null, error: null });

    await publish(atom, AsyncResult.fail(new Error("Repository unavailable")));
    expect(displayed()).toEqual({ data: null, error: "Repository unavailable" });
    await publish(atom, AsyncResult.success(STATUS));
    expect(displayed().error).toBeNull();

    await publish(
      atom,
      AsyncResult.failWithPrevious(new Error("Status failed"), {
        previous: Option.some(registry.get(atom)),
      }),
    );
    expect(displayed()).toEqual({
      data: { isRepo: true, refName: "main", hasWorkingTreeChanges: false, pr: null },
      error: "Status failed",
    });
    await publish(atom, AsyncResult.waiting(registry.get(atom)));
    expect(displayed().error).toBe("Status failed");
    await publish(atom, AsyncResult.success(structuredClone(STATUS)));
    expect(displayed().error).toBeNull();
  });

  it("refreshes the original failed source and receives recovery without remounting", async () => {
    let attempts = 0;
    const atom = Atom.make(
      Effect.suspend(() => {
        attempts += 1;
        return attempts === 1
          ? Effect.fail(new Error("Status failed"))
          : Effect.succeed({ ...STATUS, refName: "recovered" });
      }),
    );
    const onRender = vi.fn<(status: ChatStatus) => void>();
    await render(<Probe atom={atom} onRender={onRender} />);
    expect(displayed().error).toBe("Status failed");
    expect(attempts).toBe(1);

    await act(() => renderer!.root.findByType("button").props.onClick());

    expect(attempts).toBe(2);
    expect(displayed()).toEqual({
      data: { isRepo: true, refName: "recovered", hasWorkingTreeChanges: false, pr: null },
      error: null,
    });
  });

  it("switches sources and clears unavailable checkout state", async () => {
    const first = Atom.make<StatusResult>(AsyncResult.success(STATUS));
    const second = Atom.make<StatusResult>(AsyncResult.success({ ...STATUS, refName: "other" }));
    const onRender = vi.fn<(status: ChatStatus) => void>();
    await render(<Probe atom={first} onRender={onRender} />);
    await render(<Probe atom={second} onRender={onRender} />);
    expect(displayed().data.refName).toBe("other");
    const previousRenderCount = onRender.mock.calls.length;

    await publish(first, AsyncResult.success({ ...STATUS, refName: "old-checkout" }));
    expect(onRender).toHaveBeenCalledTimes(previousRenderCount);
    await publish(second, AsyncResult.success({ ...STATUS, refName: "updated" }));
    expect(displayed().data.refName).toBe("updated");

    await render(<Probe atom={null} onRender={onRender} />);
    expect(displayed()).toEqual({ data: null, error: null });
  });
});
