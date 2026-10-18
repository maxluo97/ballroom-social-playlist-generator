// SPDX-FileCopyrightText: 2026 Max Luo
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * folders.js — writing files straight into a folder on this computer (Chrome / Edge only), for
 * publishing the shared library into the project's data folder.
 *
 * The browser lets a page write into a folder only after the user picks it. The chosen folder is
 * remembered (in this browser's IndexedDB, a database every site has), so later saves need at most an
 * "Allow editing?" prompt. Other browsers: canSaveToFolder() is false and the page does not offer it.
 */

export const canSaveToFolder = () => typeof window !== "undefined" && "showDirectoryPicker" in window;

/* ---- a small IndexedDB store for folder handles (they cannot go in localStorage) ---- */

const DATABASE_NAME = "dpg-folders";
const STORE_NAME = "handles";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeGet(key) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function storeSet(key, value) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
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
 * The folder to write into: the remembered one (asking for permission again if needed), or one the user
 * picks now. `check(handle)` may return a warning to confirm (e.g. "this is not the data folder"). Pass
 * `choose: true` to pick a different folder. Returns the handle, or null if canceled.
 */
export async function getFolder(key, { choose = false, check = null } = {}) {
  if (!choose) {
    const remembered = await storeGet(key).catch(() => null);
    if (remembered) {
      const writing = { mode: "readwrite" };
      if ((await remembered.queryPermission(writing)) === "granted") return remembered;
      if ((await remembered.requestPermission(writing)) === "granted") return remembered;
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
