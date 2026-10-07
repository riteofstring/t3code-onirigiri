/** Pictures kept across reloads; the least recently saved go first. */
const MAX_SAVED = 48;
const DATABASE = "onirigiri-t3-pictures";
const STORE = "pictures";

export interface SavedPanePicture {
  readonly paneId: string;
  /** What the picture shows: the thread's revision, theme and viewport. */
  readonly revision: string;
  readonly image: Blob;
  readonly savedAt: number;
}

let database: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.addEventListener("upgradeneeded", () => {
      request.result.createObjectStore(STORE, { keyPath: "paneId" });
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
  return database;
}

function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("error", () => reject(transaction.error));
    transaction.addEventListener("abort", () => reject(transaction.error));
  });
}

/** Every saved picture, by pane. */
export async function loadPanePictures(): Promise<Map<string, SavedPanePicture>> {
  const db = await openDatabase();
  const transaction = db.transaction(STORE, "readonly");
  const request = transaction.objectStore(STORE).getAll();
  await completed(transaction);
  const pictures = request.result as SavedPanePicture[];
  return new Map(pictures.map((picture) => [picture.paneId, picture]));
}

/** Saves a pane's picture, keeping only the most recently saved ones. */
export async function savePanePicture(picture: SavedPanePicture): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(STORE, "readwrite");
  const store = transaction.objectStore(STORE);
  store.put(picture);
  const all = store.getAll();
  all.addEventListener("success", () => {
    const saved = (all.result as SavedPanePicture[]).toSorted((a, b) => b.savedAt - a.savedAt);
    for (const stale of saved.slice(MAX_SAVED)) store.delete(stale.paneId);
  });
  await completed(transaction);
}

/** The viewport part of a picture revision: pictures only fit the size they were taken at. */
export function viewportRevision(): string {
  return `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`;
}
