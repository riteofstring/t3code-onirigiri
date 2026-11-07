import { type RefObject, useRef } from "react";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { useComposerRestingTransition } from "./useComposerRestingTransition";

function Composer(props: {
  collapsed: boolean;
  restingControls: RefObject<HTMLDivElement | null>;
  onOverlayHeight: (height: number) => void;
}) {
  const ref = useComposerRestingTransition(
    props.collapsed,
    props.restingControls,
    props.onOverlayHeight,
    true,
    240,
  );
  return (
    <div ref={ref} data-testid="composer" style={{ width: 520.5 }}>
      <div data-chat-composer-surface="true">
        <div data-chat-composer-body="true">
          <div
            data-composer-prompt-surface="true"
            style={{ height: props.collapsed ? 40.25 : 132.75 }}
          />
          <div data-chat-composer-controls="footer" style={{ height: 24 }} />
        </div>
      </div>
    </div>
  );
}

function Surface(props: { collapsed: boolean; onOverlayHeight: (height: number) => void }) {
  const restingControls = useRef<HTMLDivElement>(null);
  return (
    <div data-chat-composer-overlay="true" data-testid="overlay" style={{ width: 520.5 }}>
      <Composer
        collapsed={props.collapsed}
        restingControls={restingControls}
        onOverlayHeight={props.onOverlayHeight}
      />
      <div data-composer-model-strip="true" style={{ height: 27.5 }}>
        <div ref={restingControls} style={{ height: 27.5 }} />
      </div>
    </div>
  );
}

it.each([0.125, 0.5, 1, 2])(
  "preserves fractional transition geometry at scale %s",
  async (scale) => {
    const onOverlayHeight = vi.fn<(height: number) => void>();
    const pane = document.createElement("div");
    pane.style.cssText = `transform: scale(${scale}); transform-origin: 0 0;`;
    // A bare hook probe; nothing here navigates.
    await using screen = await render(<Surface collapsed onOverlayHeight={onOverlayHeight} />, {
      container: pane,
      router: false,
    });
    await vi.waitFor(() => expect(onOverlayHeight).toHaveBeenCalled());
    const composer = screen.getByTestId("composer").element() as HTMLElement;
    using animate = vi.spyOn(composer, "animate");

    await screen.rerender(<Surface collapsed={false} onOverlayHeight={onOverlayHeight} />);

    const frames = animate.mock.calls.map(([keyframes]) => keyframes).find(Boolean);
    expect(frames).toEqual([{ height: "64.25px" }, { height: "156.75px" }]);
    expect((screen.getByTestId("overlay").element() as HTMLElement).style.height).toBe("184.25px");
  },
);
