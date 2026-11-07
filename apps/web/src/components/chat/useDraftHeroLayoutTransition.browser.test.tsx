import { useLayoutEffect } from "react";
import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";
import { useDraftHeroLayoutTransition } from "./useDraftHeroLayoutTransition";

function Probe(props: { hero: boolean; top: number; onCapture: (capture: () => void) => void }) {
  const { transitionGroupRef, composerAnchorRef, captureComposerRect } =
    useDraftHeroLayoutTransition(props.hero, true, 240);
  const { onCapture } = props;
  useLayoutEffect(() => onCapture(captureComposerRect));
  return (
    <div ref={transitionGroupRef}>
      <div style={{ height: props.top }} />
      <div ref={composerAnchorRef} style={{ width: 400, height: 160 }} />
    </div>
  );
}

it.each([0.68, 1, 1.5])(
  "uses layout-pixel translation from the submit-time position at camera scale %s",
  async (scale) => {
    let capture = () => {};
    const onCapture = (next: () => void) => {
      capture = next;
    };
    const pane = document.createElement("div");
    pane.style.cssText = `width: 600px; transform: scale(${scale}); transform-origin: 0 0;`;
    // A bare hook probe; nothing here navigates.
    await using screen = await render(<Probe hero top={200} onCapture={onCapture} />, {
      container: pane,
      router: false,
    });
    using animate = vi.spyOn(HTMLElement.prototype, "animate");
    await screen.rerender(<Probe hero top={280} onCapture={onCapture} />);
    await act(() => capture());
    await screen.rerender(<Probe hero={false} top={700} onCapture={onCapture} />);
    expect(animate).toHaveBeenCalledOnce();
    const [frames] = animate.mock.calls[0]!;
    const match = /translate3d\((-?[\d.e-]+)px, (-?[\d.e-]+)px, 0\)/.exec(
      String((frames as Keyframe[])[0]?.transform),
    );
    expect(Number(match?.[1])).toBeCloseTo(0, 3);
    expect(Number(match?.[2])).toBeCloseTo(-420, 3);
  },
);
