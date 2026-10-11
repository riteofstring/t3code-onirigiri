import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { VcsStatusResult } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
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
            previous.error === next.error,
        ),
      ),
    [statusAtom],
  );
  const selected = useAtomValue(selectedAtom);
  const refresh = useAtomRefresh(statusAtom);
  return { ...selected, refresh };
}
