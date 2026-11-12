import type { Snapshot } from "../sim/state";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("bunker-development", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("checkpoints");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Не удалось открыть локальное хранилище"));
    request.onblocked = () => reject(new Error("Закройте другую вкладку стенда и повторите"));
  });
}

export async function saveCheckpoint(snapshot: Snapshot): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("checkpoints", "readwrite");
      transaction.objectStore("checkpoints").put(snapshot, "latest");
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(new Error("Снимок не сохранён"));
    });
  } finally { database.close(); }
}

export async function loadCheckpoint(): Promise<unknown> {
  const database = await openDatabase();
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const request = database.transaction("checkpoints", "readonly").objectStore("checkpoints").get("latest");
      request.onsuccess = () => request.result ? resolve(request.result) : reject(new Error("Локального снимка пока нет"));
      request.onerror = () => reject(new Error("Снимок не прочитан"));
    });
  } finally { database.close(); }
}
