type PictureUrl = {
  url: string | null;
  state: "queued" | "decoding" | "ready" | "failed";
  decoder?: HTMLImageElement;
};

export function createPanePictureUrls() {
  const entries = new Map<Blob, PictureUrl>();
  let queue: Blob[] = [];
  let idle: number | null = null;
  let decoding = false;

  const entryFor = (image: Blob): PictureUrl => {
    const current = entries.get(image);
    if (current?.url) return current;
    const entry: PictureUrl = { url: URL.createObjectURL(image), state: "queued" };
    entries.set(image, entry);
    return entry;
  };

  const decode = (image: Blob, entry: PictureUrl) => {
    queue = queue.filter((queued) => queued !== image);
    entry.state = "decoding";
    const decoder = new Image();
    entry.decoder = decoder;
    decoder.src = entry.url!;
    return decoder.decode().then(
      () => {
        if (entries.get(image) === entry) entry.state = "ready";
      },
      () => {
        if (entry.url !== null) URL.revokeObjectURL(entry.url);
        entry.url = null;
        entry.state = "failed";
      },
    );
  };

  const schedule = () => {
    if (idle !== null || decoding || queue.length === 0) return;
    idle = requestIdleCallback(() => {
      idle = null;
      const image = queue.shift();
      if (!image) return;
      decoding = true;
      void decode(image, entryFor(image)).finally(() => {
        decoding = false;
        schedule();
      });
    });
  };

  return {
    urlFor: (image: Blob): string => {
      const entry = entryFor(image);
      if (entry.state === "queued" && !queue.includes(image)) queue.push(image);
      schedule();
      return entry.url!;
    },
    shownUrl: (image: Blob): string => {
      const entry = entryFor(image);
      if (entry.state === "queued") void decode(image, entry);
      return entry.url!;
    },
    preparedUrl: (image: Blob): string | null => {
      const entry = entries.get(image);
      return entry?.state === "ready" ? entry.url : null;
    },
    retain(images: ReadonlySet<Blob>) {
      for (const [image, entry] of entries) {
        if (images.has(image)) continue;
        if (entry.url !== null) URL.revokeObjectURL(entry.url);
        entry.url = null;
        entries.delete(image);
      }
      queue = [...images].filter((image) => {
        const entry = entries.get(image);
        return !entry || entry.state === "queued";
      });
      schedule();
    },
    dispose() {
      if (idle !== null) cancelIdleCallback(idle);
      idle = null;
      queue = [];
      for (const entry of entries.values()) {
        if (entry.url !== null) URL.revokeObjectURL(entry.url);
        entry.url = null;
      }
      entries.clear();
    },
  };
}
