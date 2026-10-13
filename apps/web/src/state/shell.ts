import {
  AVAILABLE_CONNECTION_STATE,
  connectionProjectionPhase,
  type SupervisorConnectionState,
} from "@t3tools/client-runtime/connection";
import {
  createEnvironmentShellAtoms,
  createEnvironmentSnapshotAtom,
  createShellEnvironmentAtoms,
  type EnvironmentShellState,
} from "@t3tools/client-runtime/state/shell";
import {
  type EnvironmentCatalogState,
  enabledEnvironmentIds,
} from "@t3tools/client-runtime/state/connections";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { isHostedStaticApp } from "../hostedPairing";

export const shellEnvironment = createShellEnvironmentAtoms(connectionAtomRuntime);
export const environmentShell = createEnvironmentShellAtoms(connectionAtomRuntime);
export const environmentSnapshotAtom = createEnvironmentSnapshotAtom(environmentShell.stateAtom);

export function createAllEnvironmentShellsBootstrappedAtom<CatalogError, ConnectionError>(input: {
  readonly catalogAtom: Atom.Atom<AsyncResult.AsyncResult<EnvironmentCatalogState, CatalogError>>;
  readonly shellStateValueAtom: (environmentId: EnvironmentId) => Atom.Atom<EnvironmentShellState>;
  readonly connectionStateAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<AsyncResult.AsyncResult<SupervisorConnectionState, ConnectionError>>;
}) {
  return Atom.make((get) => {
    const catalog = AsyncResult.value(get(input.catalogAtom));
    if (Option.isNone(catalog)) {
      return false;
    }
    for (const environmentId of enabledEnvironmentIds(catalog.value)) {
      if (Option.isSome(get(input.shellStateValueAtom(environmentId)).snapshot)) {
        continue;
      }
      const connection = Option.getOrElse(
        AsyncResult.value(get(input.connectionStateAtom(environmentId))),
        () => AVAILABLE_CONNECTION_STATE,
      );
      // The initial supervisor value precedes its first connection request.
      if (connection.phase === "available" && connection.generation === 0) return false;
      if (connectionProjectionPhase(connection) !== "disconnected") {
        return false;
      }
      // A retrying environment is only transiently disconnected; give it its
      // first retries before letting the landing settle without its snapshot.
      if (connection.phase === "backoff" && connection.desired && connection.attempt <= 2) {
        return false;
      }
    }
    return true;
  }).pipe(Atom.withLabel("web-all-environment-shells-bootstrapped"));
}

export const allEnvironmentShellsBootstrappedAtom = createAllEnvironmentShellsBootstrappedAtom({
  catalogAtom: environmentCatalog.catalogAtom,
  shellStateValueAtom: environmentShell.stateValueAtom,
  connectionStateAtom: environmentCatalog.stateAtom,
});

/** Cached or missing snapshots cannot establish that a saved project no longer exists. */
export function createAllEnvironmentProjectSnapshotsReadyAtom(input: {
  readonly catalogValueAtom: Atom.Atom<EnvironmentCatalogState>;
  readonly shellStateValueAtom: (environmentId: EnvironmentId) => Atom.Atom<EnvironmentShellState>;
  readonly requiresPrimaryEnvironment: boolean;
}) {
  return Atom.make((get) => {
    const catalog = get(input.catalogValueAtom);
    // The persisted catalog can emit before platform discovery registers the
    // primary environment. Neither that gap nor an empty catalog proves absence.
    if (!catalog.isReady || catalog.entries.size === 0) return false;
    if (
      input.requiresPrimaryEnvironment &&
      !Array.from(catalog.entries.values()).some(
        (entry) => entry.target._tag === "PrimaryConnectionTarget",
      )
    ) {
      return false;
    }
    for (const environmentId of enabledEnvironmentIds(catalog)) {
      const shell = get(input.shellStateValueAtom(environmentId));
      if (shell.status !== "live" || Option.isNone(shell.snapshot)) return false;
    }
    return true;
  }).pipe(Atom.withLabel("web-all-environment-project-snapshots-ready"));
}

export const allEnvironmentProjectSnapshotsReadyAtom =
  createAllEnvironmentProjectSnapshotsReadyAtom({
    catalogValueAtom: environmentCatalog.catalogValueAtom,
    shellStateValueAtom: environmentShell.stateValueAtom,
    requiresPrimaryEnvironment: !isHostedStaticApp(),
  });
