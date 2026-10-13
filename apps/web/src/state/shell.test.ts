import {
  AVAILABLE_CONNECTION_STATE,
  BearerConnectionTarget,
  ConnectionBlockedError,
  PrimaryConnectionTarget,
  type SupervisorConnectionState,
} from "@t3tools/client-runtime/connection";
import type { EnvironmentCatalogState } from "@t3tools/client-runtime/state/connections";
import type { EnvironmentShellState } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import {
  createAllEnvironmentProjectSnapshotsReadyAtom,
  createAllEnvironmentShellsBootstrappedAtom,
} from "./shell";

const LOCAL = EnvironmentId.make("local");
const REMOTE = EnvironmentId.make("remote");

function makeBootstrapHarness() {
  const catalog = Atom.make(AsyncResult.success(catalogState([LOCAL, REMOTE])));
  const shells = Atom.family((_environmentId: EnvironmentId) =>
    Atom.make<EnvironmentShellState>(shellState("empty")),
  );
  const connections = Atom.family((_environmentId: EnvironmentId) =>
    Atom.make<AsyncResult.AsyncResult<SupervisorConnectionState, Error>>(
      AsyncResult.success(AVAILABLE_CONNECTION_STATE),
    ),
  );
  const ready = createAllEnvironmentShellsBootstrappedAtom({
    catalogAtom: catalog,
    shellStateValueAtom: shells,
    connectionStateAtom: connections,
  });
  const registry = AtomRegistry.make();
  registry.set(shells(REMOTE), shellState("cached"));
  return { catalog, shells, connections, ready, registry };
}

describe("shell bootstrap", () => {
  it("waits through initial registration and connection until the first shell snapshot", () => {
    const { shells, connections, ready, registry } = makeBootstrapHarness();
    expect(registry.get(ready)).toBe(false);
    registry.set(
      connections(LOCAL),
      AsyncResult.success({
        ...AVAILABLE_CONNECTION_STATE,
        desired: true,
        phase: "connecting",
        attempt: 1,
      }),
    );
    expect(registry.get(ready)).toBe(false);
    registry.set(shells(LOCAL), shellState("live"));
    expect(registry.get(ready)).toBe(true);
    registry.dispose();
  });

  it("uses cached shells before the first connection request", () => {
    const { shells, ready, registry } = makeBootstrapHarness();
    registry.set(shells(LOCAL), shellState("cached"));
    expect(registry.get(ready)).toBe(true);
    registry.dispose();
  });

  it("allows a failed connection atom with no previous state to settle", () => {
    const { connections, ready, registry } = makeBootstrapHarness();
    registry.set(connections(LOCAL), AsyncResult.fail(new Error("Connection state unavailable")));
    expect(registry.get(ready)).toBe(true);
    registry.dispose();
  });

  it("keeps the previous connection state authoritative when its atom fails", () => {
    const { connections, ready, registry } = makeBootstrapHarness();
    for (const phase of ["connecting", "offline"] as const) {
      registry.set(
        connections(LOCAL),
        AsyncResult.fail(new Error("Connection state unavailable"), {
          previousSuccess: Option.some(
            AsyncResult.success<SupervisorConnectionState>({
              ...AVAILABLE_CONNECTION_STATE,
              desired: true,
              phase,
            }),
          ),
        }),
      );
      expect(registry.get(ready)).toBe(phase === "offline");
    }
    registry.dispose();
  });

  it.each(["offline", "blocked"] as const)(
    "allows a reported %s outcome without waiting for a live connection",
    (phase) => {
      const { connections, ready, registry } = makeBootstrapHarness();
      registry.set(
        connections(LOCAL),
        AsyncResult.success({
          ...AVAILABLE_CONNECTION_STATE,
          desired: true,
          phase,
          lastFailure:
            phase === "blocked"
              ? new ConnectionBlockedError({ reason: "authentication", detail: "Sign in required" })
              : null,
        }),
      );
      expect(registry.get(ready)).toBe(true);
      registry.dispose();
    },
  );

  it("keeps the existing first-retry allowance without waiting indefinitely", () => {
    const { connections, ready, registry } = makeBootstrapHarness();
    const retry: SupervisorConnectionState = {
      ...AVAILABLE_CONNECTION_STATE,
      desired: true,
      phase: "backoff",
      attempt: 2,
    };
    registry.set(connections(LOCAL), AsyncResult.success(retry));
    expect(registry.get(ready)).toBe(false);
    registry.set(connections(LOCAL), AsyncResult.success({ ...retry, attempt: 3 }));
    expect(registry.get(ready)).toBe(true);
    registry.dispose();
  });

  it("accepts an available outcome after an established connection", () => {
    const { connections, ready, registry } = makeBootstrapHarness();
    registry.set(
      connections(LOCAL),
      AsyncResult.success({ ...AVAILABLE_CONNECTION_STATE, generation: 1 }),
    );
    expect(registry.get(ready)).toBe(true);
    registry.dispose();
  });

  it("does not wait for disabled environments to connect", () => {
    const { catalog, ready, registry } = makeBootstrapHarness();
    const current = catalogState([LOCAL, REMOTE]);
    const local = current.entries.get(LOCAL)!;
    registry.set(
      catalog,
      AsyncResult.success({
        ...current,
        entries: new Map([...current.entries, [LOCAL, { ...local, enabled: false }]]),
      }),
    );
    expect(registry.get(ready)).toBe(true);
    registry.dispose();
  });
});

function shellState(status: EnvironmentShellState["status"]): EnvironmentShellState {
  return {
    status,
    snapshot:
      status === "empty"
        ? Option.none()
        : Option.some({
            snapshotSequence: 1,
            updatedAt: "2026-09-04T00:00:00.000Z",
            projects: [],
            threads: [],
          }),
    error: Option.none(),
  };
}

function catalogState(environmentIds: readonly EnvironmentId[]): EnvironmentCatalogState {
  return {
    isReady: true,
    entries: new Map(
      environmentIds.map((environmentId) => [
        environmentId,
        {
          target:
            environmentId === LOCAL
              ? new PrimaryConnectionTarget({
                  environmentId,
                  label: environmentId,
                  httpBaseUrl: `https://${environmentId}.example.test`,
                  wsBaseUrl: `wss://${environmentId}.example.test`,
                })
              : new BearerConnectionTarget({
                  environmentId,
                  connectionId: environmentId,
                  label: environmentId,
                }),
          profile: Option.none(),
          enabled: true,
        },
      ]),
    ),
  };
}

function makeHarness(requiresPrimaryEnvironment = true) {
  const catalog = Atom.make<EnvironmentCatalogState>({ isReady: false, entries: new Map() });
  const shells = Atom.family((_environmentId: EnvironmentId) =>
    Atom.make<EnvironmentShellState>(shellState("empty")),
  );
  const ready = createAllEnvironmentProjectSnapshotsReadyAtom({
    catalogValueAtom: catalog,
    shellStateValueAtom: shells,
    requiresPrimaryEnvironment,
  });
  const registry = AtomRegistry.make();
  return { catalog, shells, ready, registry };
}

describe("project snapshot readiness", () => {
  it("does not clear a saved scope while the ready catalog is still empty", () => {
    const { catalog, ready, registry } = makeHarness();
    expect(registry.get(ready)).toBe(false);
    registry.set(catalog, catalogState([]));
    expect(registry.get(ready)).toBe(false);
    registry.dispose();
  });

  it("waits for primary discovery even if a persisted remote is already live", () => {
    const { catalog, shells, ready, registry } = makeHarness();
    registry.set(catalog, catalogState([REMOTE]));
    registry.set(shells(REMOTE), shellState("live"));
    expect(registry.get(ready)).toBe(false);

    registry.set(catalog, catalogState([LOCAL, REMOTE]));
    expect(registry.get(ready)).toBe(false);
    registry.set(shells(LOCAL), shellState("live"));
    expect(registry.get(ready)).toBe(true);
    registry.dispose();
  });

  it("allows a hosted client to load projects without a primary environment", () => {
    const { catalog, shells, ready, registry } = makeHarness(false);
    registry.set(catalog, catalogState([REMOTE]));
    expect(registry.get(ready)).toBe(false);
    registry.set(shells(REMOTE), shellState("live"));
    expect(registry.get(ready)).toBe(true);
    registry.dispose();
  });

  it("waits for live snapshots through offline startup and reconnect", () => {
    const { catalog, shells, ready, registry } = makeHarness();
    registry.set(catalog, catalogState([LOCAL, REMOTE]));
    registry.set(shells(LOCAL), shellState("live"));
    expect(registry.get(ready)).toBe(false);

    // An old cache and a reconnect in progress can both omit a real project.
    registry.set(shells(REMOTE), shellState("cached"));
    expect(registry.get(ready)).toBe(false);
    registry.set(shells(REMOTE), shellState("synchronizing"));
    expect(registry.get(ready)).toBe(false);
    registry.set(shells(REMOTE), shellState("live"));
    expect(registry.get(ready)).toBe(true);

    registry.set(shells(REMOTE), shellState("cached"));
    expect(registry.get(ready)).toBe(false);
    registry.set(shells(REMOTE), shellState("live"));
    expect(registry.get(ready)).toBe(true);
    registry.dispose();
  });

  it("stops waiting for an environment only when it leaves the catalog", () => {
    const { catalog, shells, ready, registry } = makeHarness();
    registry.set(catalog, catalogState([LOCAL, REMOTE]));
    registry.set(shells(LOCAL), shellState("live"));
    expect(registry.get(ready)).toBe(false);
    registry.set(catalog, catalogState([LOCAL]));
    expect(registry.get(ready)).toBe(true);
    registry.dispose();
  });
});
