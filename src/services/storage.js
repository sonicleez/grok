import { openDB } from 'idb';

const DB_NAME = 'GrokPrompterDB';
const DB_VERSION = 1;
const STORE_NAME = 'images';

// Initialize the database
export const initDB = async () => {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    },
  });
};

// Save a Base64 image to IndexedDB
export const saveImage = async (id, base64Data) => {
  const db = await initDB();
  await db.put(STORE_NAME, { id, data: base64Data });
};

// Retrieve a Base64 image from IndexedDB
export const getImage = async (id) => {
  const db = await initDB();
  const result = await db.get(STORE_NAME, id);
  return result ? result.data : null;
};

// Delete all images from IndexedDB (e.g. for a new project)
export const clearImages = async () => {
  const db = await initDB();
  await db.clear(STORE_NAME);
};

// Save application state to localStorage
export const saveState = (state) => {
  try {
    const serialized = JSON.stringify(state);
    localStorage.setItem('grok_prompter_state', serialized);
  } catch (err) {
    console.error('Failed to save state', err);
  }
};

// Load application state from localStorage
export const loadState = () => {
  try {
    const serialized = localStorage.getItem('grok_prompter_state');
    if (serialized === null) {
      return undefined;
    }
    return JSON.parse(serialized);
  } catch (err) {
    console.error('Failed to load state', err);
    return undefined;
  }
};
