/** Saved pictures are kept within both limits; the least recently saved go first. */
export const MAX_SAVED = 200;
const MAX_SAVED_BYTES = 128 * 1024 * 1024;
const DATABASE = "onirigiri-t3-pane-pictures";
const STORE = "pictures";
const BY_SAVED_AT = "savedAt";

export interface SavedPanePicture {
  readonly paneId: string;
  /** What the picture shows: the thread's revision, theme and pane geometry. */
  readonly revision: string;
  readonly image: Blob;
  readonly savedAt: number;
  /** A capture by the workspace, or a picture drawn from the pane's DOM. */
  readonly source?: "capture" | "snapshot";
}

let database: Promise<IDBDatabase> | null = null;

// A failed or closed connection is opened again on next use.
function openDatabase(): Promise<IDBDatabase> {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.addEventListener("upgradeneeded", () => {
      const store = request.result.createObjectStore(STORE, { keyPath: "paneId" });
      store.createIndex(BY_SAVED_AT, "savedAt");
    });
    request.addEventListener("success", () => {
      const db = request.result;
      const forget = () => {
        database = null;
      };
      db.addEventListener("close", forget);
      db.addEventListener("versionchange", () => {
        db.close();
        forget();
      });
      resolve(db);
    });
    request.addEventListener("error", () => reject(request.error));
    request.addEventListener("blocked", () => reject(new Error("picture database blocked")));
  }).catch((error: unknown) => {
    database = null;
    throw error;
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

/** Saves a pane's picture, then drops the oldest pictures beyond the limits. */
export async function savePanePicture(
  picture: SavedPanePicture,
  canSave: () => boolean,
): Promise<void> {
  const db = await openDatabase();
  if (!canSave()) return;
  const transaction = db.transaction(STORE, "readwrite");
  const store = transaction.objectStore(STORE);
  store.put(picture);
  let count = 0;
  let bytes = 0;
  const cursor = store.index(BY_SAVED_AT).openCursor(null, "prev");
  cursor.addEventListener("success", () => {
    const current = cursor.result;
    if (!current) return;
    const saved = current.value as SavedPanePicture;
    count += 1;
    bytes += saved.image.size;
    if (count > MAX_SAVED || bytes > MAX_SAVED_BYTES) current.delete();
    current.continue();
  });
  await completed(transaction);
}

export async function deletePanePicture(paneId: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(STORE, "readwrite");
  transaction.objectStore(STORE).delete(paneId);
  await completed(transaction);
}
