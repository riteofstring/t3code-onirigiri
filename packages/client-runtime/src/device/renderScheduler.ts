/** Coalesces invalidations into one render. No work is scheduled while the view is idle. */
export function createRenderScheduler(
  render: () => void,
  request: (callback: FrameRequestCallback) => number = requestAnimationFrame,
  cancel: (id: number) => void = cancelAnimationFrame,
) {
  let pending: number | null = null;
  let disposed = false;
  let active = true;
  const invalidate = () => {
    if (disposed || !active || pending !== null) return;
    pending = request(() => {
      pending = null;
      if (!disposed && active) render();
    });
  };
  return {
    invalidate,
    setActive(next: boolean) {
      if (disposed || active === next) return;
      active = next;
      if (active) invalidate();
      else {
        if (pending !== null) cancel(pending);
        pending = null;
      }
    },
    dispose() {
      disposed = true;
      if (pending !== null) cancel(pending);
      pending = null;
    },
  };
}
