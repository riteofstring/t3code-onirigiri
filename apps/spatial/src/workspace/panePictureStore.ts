export const MAX_SAVED = 200;
export const MAX_SAVED_BYTES = 128 * 1024 * 1024;
const DATABASE = "onirigiri-t3-pane-pictures";
const VERSION = 2;
const STORE = "pictures";
const BY_SAVED_AT = "savedAt";
const BY_PANE = "paneId";

export interface SavedPanePicture {
  readonly recordKey: string;
  readonly paneId: string;
  readonly geometryRevision: string;
  readonly revision: string;
  readonly image: Blob;
  readonly cssSize: { readonly width: number; readonly height: number };
  readonly savedAt: number;
}

export function pictureRecordKey(paneId: string, geometryRevision: string): string {
  return JSON.stringify([paneId, geometryRevision]);
}

let database: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.addEventListener("upgradeneeded", () => {
      const db = request.result;
      if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
      const store = db.createObjectStore(STORE, { keyPath: "recordKey" });
      store.createIndex(BY_SAVED_AT, "savedAt");
      store.createIndex(BY_PANE, "paneId");
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

export async function loadPanePictures(): Promise<Map<string, SavedPanePicture>> {
  const db = await openDatabase();
  const transaction = db.transaction(STORE, "readonly");
  const request = transaction.objectStore(STORE).getAll();
  await completed(transaction);
  const pictures = request.result as SavedPanePicture[];
  return new Map(
    pictures
      .filter(
        ({ cssSize }) =>
          cssSize &&
          Number.isFinite(cssSize.width) &&
          cssSize.width > 0 &&
          Number.isFinite(cssSize.height) &&
          cssSize.height > 0,
      )
      .map((picture) => [picture.recordKey, picture]),
  );
}

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
