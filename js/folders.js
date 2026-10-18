/**
 * folders.js — writing files straight into a folder on this computer (Chrome / Edge only).
 *
 * The browser lets a page write into a folder only after the user picks it. The chosen folder is
 * remembered (in this browser's IndexedDB), so later saves need at most a "Allow editing?" prompt.
 * Other browsers: canSaveToFolder() is false and the page offers downloads instead.
 */

export const canSaveToFolder = () => typeof window !== "undefined" && "showDirectoryPicker" in window;

/* ---- a tiny IndexedDB store for folder handles (they cannot go in localStorage) ---- */

function openStore() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("dpg-folders", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("handles");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function storeGet(key) {
  const db = await openStore();
  return new Promise((resolve, reject) => {
    const req = db.transaction("handles").objectStore("handles").get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function storeSet(key, value) {
  const db = await openStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("handles", "readwrite");
    tx.objectStore("handles").put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** The remembered folder's name, or null (for showing where files will go). */
export async function rememberedFolderName(key) {
  try {
    const handle = await storeGet(key);
    return handle ? handle.name : null;
  } catch {
    return null;
  }
}

/**
 * The folder to write into: the remembered one (asking for permission again if needed), or one the
 * user picks now. `check(handle)` may return a warning to confirm (e.g. "this is not the data
 * folder"). Pass `choose: true` to pick a different folder. Returns the handle, or null if canceled.
 */
export async function getFolder(key, { choose = false, check = null } = {}) {
  if (!choose) {
    const remembered = await storeGet(key).catch(() => null);
    if (remembered) {
      const opts = { mode: "readwrite" };
      if ((await remembered.queryPermission(opts)) === "granted") return remembered;
      if ((await remembered.requestPermission(opts)) === "granted") return remembered;
    }
  }
  let handle;
  try {
    handle = await window.showDirectoryPicker({ id: key, mode: "readwrite", startIn: "documents" });
  } catch (err) {
    if (err.name === "AbortError") return null;
    throw err;
  }
  const warning = check ? await check(handle) : null;
  if (warning && !confirm(`${warning}\n\nUse this folder anyway?`)) return null;
  await storeSet(key, handle);
  return handle;
}

/** Whether a folder contains a file of this name. */
export async function folderHasFile(handle, name) {
  try {
    await handle.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

/** Write (or replace) a text file in a folder. */
export async function writeTextFile(handle, name, text) {
  const file = await handle.getFileHandle(name, { create: true });
  const writer = await file.createWritable();
  await writer.write(text);
  await writer.close();
}
