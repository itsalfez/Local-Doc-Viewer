const DB_NAME = 'DocViewerDB';
const DB_VERSION = 2; // Increment version to trigger upgrade
const STORE_NAME = 'files';

export const db = {
    async open() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = (event) => reject('Database error: ' + event.target.error);

            request.onsuccess = (event) => {
                resolve(event.target.result);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                }
            };
        });
    },

    async addFile(file) {
        const dbInstance = await this.open();

        // Read file as ArrayBuffer for reliable storage
        const arrayBuffer = await file.arrayBuffer();

        return new Promise((resolve, reject) => {
            const transaction = dbInstance.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);

            const record = {
                name: file.name,
                type: file.type,
                size: file.size,
                date: new Date().toISOString(),
                // Store as ArrayBuffer for reliability
                content: arrayBuffer
            };

            const request = store.add(record);

            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async getAllFiles() {
        const dbInstance = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = dbInstance.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.openCursor();
            const files = [];

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    // Exclude content from list for performance
                    const { content, ...metadata } = cursor.value;
                    files.push({ ...metadata, id: cursor.key });
                    cursor.continue();
                } else {
                    resolve(files);
                }
            };
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async getFile(id) {
        const dbInstance = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = dbInstance.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(Number(id));

            request.onsuccess = () => {
                const record = request.result;
                if (record && record.content) {
                    // Convert ArrayBuffer back to Blob for compatibility
                    record.contentBlob = new Blob([record.content], { type: record.type });
                }
                resolve(record);
            };
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async deleteFile(id) {
        const dbInstance = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = dbInstance.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(Number(id));

            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async saveFile(record) {
        const dbInstance = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = dbInstance.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.put(record);

            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }
};
