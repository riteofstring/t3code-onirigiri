import { useLayoutEffect, useState } from "react";
import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../test/render";
import {
  PanelAnimationSuppressionProvider,
  usePanelAnimationSettings,
  usePanelPresence,
} from "./panelAnimations";

vi.mock("./hooks/useSettings", () => ({
  useClientSettings: (select: (settings: { panelAnimationDurationMs: number }) => unknown) =>
    select({ panelAnimationDurationMs: 200 }),
}));
vi.mock("./hooks/useMediaQuery", () => ({
  useMediaQuery: () => false,
}));

it("applies route suppression to its own closing panels without reopening them on release", async () => {
  const observed: boolean[] = [];
  let closePanel: () => void = () => {};
  function PanelProbe() {
    const [open, setOpen] = useState(true);
    const { active, durationMs } = usePanelAnimationSettings();
    const panel = usePanelPresence(open, true, active, "thread-one", durationMs);
    useLayoutEffect(() => {
      closePanel = () => setOpen(false);
      observed.push(panel.present);
    }, [panel.present]);
    return null;
  }
  const tree = (suppressed: boolean) => (
    <PanelAnimationSuppressionProvider value={suppressed}>
      <PanelProbe />
    </PanelAnimationSuppressionProvider>
  );

  await using screen = await render(tree(false), { router: false });
  await act(() => closePanel());
  expect(observed.at(-1)).toBe(true);

  await screen.rerender(tree(true));
  expect(observed.at(-1)).toBe(false);

  await screen.rerender(tree(false));
  expect(observed.at(-1)).toBe(false);
});
