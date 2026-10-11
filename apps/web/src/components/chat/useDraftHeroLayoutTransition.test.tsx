import { useLayoutEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DRAFT_HERO_TRANSITION_ANIMATION_ID } from "./draftHeroTransition";
import { useDraftHeroLayoutTransition } from "./useDraftHeroLayoutTransition";

function rect(top: number): DOMRect {
  return {
    x: 100,
    y: top,
    top,
    left: 100,
    right: 500,
    bottom: top + 160,
    width: 400,
    height: 160,
    toJSON: () => ({}),
  };
}

let renderer: ReactTestRenderer | undefined;
let position = rect(200);
let capture = () => {};
let mobileTransition = false;
const measure = vi.fn(() => position);
const animations: { id: string; cancel: ReturnType<typeof vi.fn>; finished: Promise<void> }[] = [];
const animate = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => {
  const animation = { id: "", cancel: vi.fn(), finished: new Promise<void>(() => {}) };
  animations.push(animation);
  return animation;
});
const anchor = { getBoundingClientRect: measure };
const group = { animate };

function Probe({ hero, active }: { hero: boolean; active: boolean }) {
  const [attachGroup, attachAnchor, captureRect] = useDraftHeroLayoutTransition(hero, active, 240);
  useLayoutEffect(() => {
    capture = captureRect;
  });
  return (
    <div ref={attachGroup} data-kind="group">
      <div ref={attachAnchor} data-kind="anchor" />
    </div>
  );
}

async function render(hero: boolean, active: boolean) {
  await act(() => {
    const view = <Probe hero={hero} active={active} />;
    if (renderer) renderer.update(view);
    else {
      renderer = create(view, {
        createNodeMock: (element) =>
          (element.props as { "data-kind": string })["data-kind"] === "anchor" ? anchor : group,
      });
    }
  });
}

beforeEach(() => {
  position = rect(200);
  mobileTransition = false;
  animations.length = 0;
  measure.mockClear();
  animate.mockClear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("document", {
    documentElement: {
      get dataset() {
        return { mobileComposerRouteTransition: String(mobileTransition) };
      },
    },
  });
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe("draft hero layout transitions", () => {
  it.each([false, true])(
    "does not measure a suppressed initial composer (hero=%s)",
    async (hero) => {
      await render(hero, false);
      expect(measure).not.toHaveBeenCalled();
      expect(animate).not.toHaveBeenCalled();
    },
  );

  it("measures after suppression ends and preserves a later remote dock transition", async () => {
    await render(true, false);
    position = rect(240);
    await render(true, true);
    expect(measure).toHaveBeenCalledOnce();
    expect(animate).not.toHaveBeenCalled();

    position = rect(700);
    await render(false, true);
    expect(animate).toHaveBeenCalledWith(
      [{ transform: "translate3d(0px, -460px, 0)" }, { transform: "translate3d(0, 0, 0)" }],
      { duration: 240, easing: "cubic-bezier(0.4, 0, 0.2, 1)" },
    );
    expect(animations[0]?.id).toBe(DRAFT_HERO_TRANSITION_ANIMATION_ID);
  });

  it("uses the submit-time position when the composer moved since its previous render", async () => {
    await render(true, true);
    position = rect(280);
    capture();
    position = rect(700);
    await render(false, true);
    expect(animate.mock.calls[0]?.[0]).toEqual([
      { transform: "translate3d(0px, -420px, 0)" },
      { transform: "translate3d(0, 0, 0)" },
    ]);
  });

  it("preserves a reverse transition after a dock is canceled", async () => {
    await render(true, true);
    position = rect(700);
    await render(false, true);
    position = rect(230);
    await render(true, true);
    expect(animations[0]?.cancel).toHaveBeenCalledOnce();
    expect(animate.mock.calls[1]?.[0]).toEqual([
      { transform: "translate3d(0px, 470px, 0)" },
      { transform: "translate3d(0, 0, 0)" },
    ]);
  });

  it("cancels motion without measuring when animations are disabled", async () => {
    await render(true, true);
    position = rect(700);
    await render(false, true);
    measure.mockClear();
    await render(false, false);
    position = rect(200);
    await render(true, false);
    expect(animations[0]?.cancel).toHaveBeenCalledOnce();
    expect(measure).not.toHaveBeenCalled();
    expect(animate).toHaveBeenCalledOnce();
  });

  it("leaves mobile transitions in control and preserves the following desktop transition", async () => {
    await render(true, true);
    mobileTransition = true;
    position = rect(700);
    capture();
    await render(false, true);
    expect(animate).not.toHaveBeenCalled();

    mobileTransition = false;
    position = rect(200);
    await render(true, true);
    expect(animate.mock.calls[0]?.[0]).toEqual([
      { transform: "translate3d(0px, 500px, 0)" },
      { transform: "translate3d(0, 0, 0)" },
    ]);
  });

  it("does not animate from suppressed geometry when activation and docking happen together", async () => {
    await render(true, false);
    position = rect(700);
    await render(false, true);
    expect(animate).not.toHaveBeenCalled();
    position = rect(200);
    await render(true, true);
    expect(animate).toHaveBeenCalledOnce();
  });
});
