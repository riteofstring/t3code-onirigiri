export function afterUsablePaint(work: () => void) {
  let second = 0;
  let task: ReturnType<typeof setTimeout> | undefined;
  const first = requestAnimationFrame(() => {
    second = requestAnimationFrame(() => {
      task = setTimeout(work, 0);
    });
  });
  return () => {
    cancelAnimationFrame(first);
    cancelAnimationFrame(second);
    clearTimeout(task);
  };
}
