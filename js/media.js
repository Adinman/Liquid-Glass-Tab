// Blob storage for the wallpaper — both the video and the still image.
//
// chrome.storage can only hold JSON, so either would have to become a base64
// data URL: 33% larger, re-serialised on every settings write, and held in
// memory by every open tab. IndexedDB stores the File as-is and hands back an
// object URL that <video> can stream from and CSS can point at.
//
// Measured on a 2560x1440 photo: 6.09 MB as a data URL against 4.58 MB as a
// Blob, and a settings write went from 11.4 ms to 0.1 ms once the image was no
// longer part of the object being written.

const DB_NAME = 'lgt-media';
const STORE = 'blobs';
const VERSION = 1;

export const WALLPAPER_VIDEO_KEY = 'wallpaperVideo';
export const WALLPAPER_IMAGE_KEY = 'wallpaperImage';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function putBlob(key, blob) {
  const db = await openDB();
  try { return await tx(db, 'readwrite', s => s.put(blob, key)); }
  finally { db.close(); }
}

export async function getBlob(key) {
  const db = await openDB();
  try { return await tx(db, 'readonly', s => s.get(key)); }
  finally { db.close(); }
}

export async function delBlob(key) {
  const db = await openDB();
  try { return await tx(db, 'readwrite', s => s.delete(key)); }
  finally { db.close(); }
}

/** Rough remaining space, so we can warn before a huge file fails to store. */
export async function storageEstimate() {
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota };
  } catch { return { usage: 0, quota: 0 }; }
}

export const fmtBytes = n =>
  n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB'
  : n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB'
  : (n / 1e3).toFixed(0) + ' KB';
