import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { VcsStatusResult } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useMemo } from "react";

import { formatEnvironmentQueryError } from "../state/query";

const EMPTY_STATUS_ATOM = Atom.make(AsyncResult.initial<VcsStatusResult>(false));

function selectChatViewVcsStatus<E>(result: AsyncResult.AsyncResult<VcsStatusResult, E>) {
  const status = Option.getOrNull(AsyncResult.value(result));
  return {
    data:
      status === null
        ? null
        : {
            isRepo: status.isRepo,
            refName: status.refName,
            hasWorkingTreeChanges: status.hasWorkingTreeChanges,
            pr:
              status.pr === null
                ? null
                : {
                    number: status.pr.number,
                    url: status.pr.url,
                    state: status.pr.state,
                    headRef: status.pr.headRef,
                  },
          },
    error: result._tag === "Failure" ? formatEnvironmentQueryError(result.cause) : null,
  };
}

export function useChatViewVcsStatus<E>(
  atom: Atom.Atom<AsyncResult.AsyncResult<VcsStatusResult, E>> | null,
) {
  const statusAtom = atom ?? EMPTY_STATUS_ATOM;
  const selectedAtom = useMemo(
    () =>
      Atom.map(statusAtom, selectChatViewVcsStatus).pipe(
        Atom.withEquality<ReturnType<typeof selectChatViewVcsStatus>>(
          (previous, next) =>
            previous.data?.isRepo === next.data?.isRepo &&
            previous.data?.refName === next.data?.refName &&
            previous.data?.hasWorkingTreeChanges === next.data?.hasWorkingTreeChanges &&
            previous.data?.pr?.number === next.data?.pr?.number &&
            previous.data?.pr?.url === next.data?.pr?.url &&
            previous.data?.pr?.state === next.data?.pr?.state &&
            previous.data?.pr?.headRef === next.data?.pr?.headRef &&
            previous.error === next.error,
        ),
      ),
    [statusAtom],
  );
  const selected = useAtomValue(selectedAtom);
  const refresh = useAtomRefresh(statusAtom);
  return { ...selected, refresh };
}
