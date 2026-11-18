import type { Backup, Discovery, Settings } from './core.js';
let database: IDBDatabase;
export async function openDatabase(): Promise<void> {
  database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('life-discovery', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('discoveries', { keyPath: 'id' });
      request.result.createObjectStore('settings');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Database blocked'));
  });
  database.onversionchange = () => database.close();
}
function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Transaction aborted'));
    transaction.onerror = () => reject(transaction.error);
  });
}
export async function readAll(): Promise<{ discoveries: Discovery[]; settings?: Settings }> {
  const tx = database.transaction(['discoveries', 'settings'], 'readonly');
  const done = complete(tx);
  const items = tx.objectStore('discoveries').getAll();
  const settings = tx.objectStore('settings').get('preferences');
  await done;
  return { discoveries: items.result, settings: settings.result };
}
export async function saveDiscovery(item: Discovery): Promise<void> {
  const tx = database.transaction('discoveries', 'readwrite');
  const done = complete(tx);
  tx.objectStore('discoveries').put(item);
  await done;
}
export async function deleteDiscovery(id: string): Promise<void> {
  const tx = database.transaction('discoveries', 'readwrite');
  const done = complete(tx);
  tx.objectStore('discoveries').delete(id);
  await done;
}
export async function saveSettings(settings: Settings): Promise<void> {
  const tx = database.transaction('settings', 'readwrite');
  const done = complete(tx);
  tx.objectStore('settings').put(settings, 'preferences');
  await done;
}
export async function replaceAll(backup: Backup): Promise<void> {
  const tx = database.transaction(['discoveries', 'settings'], 'readwrite');
  const done = complete(tx);
  const store = tx.objectStore('discoveries');
  store.clear();
  for (const item of backup.discoveries) store.put(item);
  tx.objectStore('settings').put(backup.settings, 'preferences');
  await done;
}
