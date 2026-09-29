import type { Bridge, Recording } from "./types";
const database = new Promise<IDBDatabase>((resolve, reject) => {
  const req = indexedDB.open("voices", 1);
  req.onupgradeneeded = () =>
    req.result.createObjectStore("recordings", { keyPath: "id" });
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
async function store<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database;
  return new Promise((resolve, reject) => {
    const tx = db.transaction("recordings", mode);
    const req = operation(tx.objectStore("recordings"));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
const browser: Bridge = {
  list: async () =>
    (await store("readonly", (s) => s.getAll())).map(
      ({ audio, ...item }) => item as Recording,
    ),
  save: async (item, audio) => {
    await store("readwrite", (s) => s.put({ ...item, audio }));
    return item;
  },
  update: async (id, changes) => {
    const old = await store("readonly", (s) => s.get(id));
    const next = { ...old, ...changes };
    await store("readwrite", (s) => s.put(next));
    const { audio, ...item } = next;
    return item;
  },
  audio: async (id) =>
    new Uint8Array((await store("readonly", (s) => s.get(id))).audio),
  export: async (id, kind, text) => {
    const data = kind === "wav" ? await browser.audio(id) : text || "";
    const url = URL.createObjectURL(
      new Blob([data as BlobPart], {
        type: kind === "wav" ? "audio/wav" : "text/plain",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${id}.${kind}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  },
  settings: async () => ({
    enginePath: "Available in the desktop app",
    modelPath: "NVIDIA Nemotron 3 Diarization",
  }),
  pickSetting: async () => null,
  status: async () => ({ ready: false }),
  transcribe: async () => {
    throw new Error(
      "Open the Voices desktop app to transcribe locally with NVIDIA.",
    );
  },
  cancel: async () => {},
  recording: async () => {},
  microphone: async () => true,
  onProgress: () => () => {},
};
export const api = window.voices || browser;
