document.addEventListener('keydown', e => {
    const key = e.key.toLowerCase();
    const activeTag = document.activeElement.tagName;
    
    // Bỏ qua nếu đang ở ô nhập liệu
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(activeTag)) return;

    // Xử lý phím Space
    if (key === ' ') {
        e.preventDefault();
        stopAll();
        return; // Dừng xử lý các phím khác khi nhấn Space
    }

    // Xử lý phím tắt âm thanh
    if (keyMapping[key]) {
        e.preventDefault();
        playSound(keyMapping[key]);
    }
});
    let currentAudio = null;
    let keyMapping = {};
    const storageKeys = {
      laughter: 'soundboard_laughter',
      interaction: 'soundboard_interaction',
      victory: 'soundboard_victory'
    };
    const MAX_FILE_SIZE = 100 * 1024 * 1024;

    // IndexedDB functions
    const initDB = () => {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open('SoundboardDB', 1);
        request.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('audioFiles')) {
            db.createObjectStore('audioFiles', { keyPath: 'id' });
          }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
      });
    };

	document.addEventListener('DOMContentLoaded', async () => {
    // Khởi tạo ứng dụng
    await initDB();
    Object.keys(storageKeys).forEach(type => {
        const savedData = localStorage.getItem(storageKeys[type]);
        if (savedData) {
            JSON.parse(savedData).forEach(soundData => createButton(type, soundData));
        }
    });
    initKeyMapping();
});

    async function handleUpload(input, type) {
      const file = input.files[0];
      if (!file) return;

      if (file.size > MAX_FILE_SIZE) {
        alert(`File quá lớn! Tối đa: ${MAX_FILE_SIZE/1024/1024}MB`);
        input.value = '';
        return;
      }

      document.getElementById(`${type}-name`).value = file.name.replace(/\.[^/.]+$/, "");
    }

    async function addSound(type) {
      const nameInput = document.getElementById(`${type}-name`);
      const shortcutInput = document.getElementById(`${type}-shortcut`);
      const fileInput = document.getElementById(`${type}-upload`);
      
      if (!nameInput.value || !fileInput.files[0]) {
        alert('Vui lòng điền tên và chọn file MP3!');
        return;
      }

      const shortcut = shortcutInput.value.trim().toLowerCase();
      if (shortcut && keyMapping[shortcut]) {
        alert('Phím tắt này đã được sử dụng!');
        return;
      }

      const file = fileInput.files[0];
      const soundId = `${type}-${Date.now()}`;
      const db = await initDB();
      
      await new Promise((resolve, reject) => {
        const transaction = db.transaction('audioFiles', 'readwrite');
        transaction.objectStore('audioFiles').put({ id: soundId, file: file });
        transaction.oncomplete = resolve;
        transaction.onerror = reject;
      });

      const soundData = {
        id: soundId,
        name: nameInput.value,
        shortcut: shortcut
      };

      const existingData = JSON.parse(localStorage.getItem(storageKeys[type])) || [];
      existingData.push(soundData);
      localStorage.setItem(storageKeys[type], JSON.stringify(existingData));

      createButton(type, soundData);
      initKeyMapping();

      nameInput.value = '';
      shortcutInput.value = '';
      fileInput.value = '';
    }

    async function playSound(id) {
      if(currentAudio) {
        currentAudio.pause();
        URL.revokeObjectURL(currentAudio.src);
      }
      
      const db = await initDB();
      const file = await new Promise((resolve) => {
        const transaction = db.transaction('audioFiles', 'readonly');
        transaction.objectStore('audioFiles').get(id).onsuccess = e => resolve(e.target.result?.file);
      });

      if (!file) return alert('Không tìm thấy file!');
      
      currentAudio = new Audio(URL.createObjectURL(file));
      currentAudio.play();
    }

	function createButton(type, soundData) {
    const button = document.createElement('button');
    button.className = `sound-btn ${getColor(type)} text-white rounded hover:opacity-90 w-full min-w-0 flex items-center justify-between gap-2`; // Thêm flex
    
    button.innerHTML = `
        <span class="truncate flex-1 min-w-0 text-left">${soundData.name}</span>
        <div class="flex items-center gap-2 flex-shrink-0">
            ${soundData.shortcut ? `<span class="text-xs opacity-75">[${soundData.shortcut.toUpperCase()}]</span>` : ''}
            <span class="text-xs opacity-70">✖</span>
        </div>
    `;
      button.onclick = () => playSound(soundData.id);
      button.querySelector('span:last-child').onclick = async e => {
        e.stopPropagation();
        const db = await initDB();
        await new Promise(resolve => {
          const transaction = db.transaction('audioFiles', 'readwrite');
          transaction.objectStore('audioFiles').delete(soundData.id);
          transaction.oncomplete = resolve;
        });
        
        const existingData = JSON.parse(localStorage.getItem(storageKeys[type])) || [];
        const newData = existingData.filter(s => s.id !== soundData.id);
        localStorage.setItem(storageKeys[type], JSON.stringify(newData));
        button.remove();
      };

      document.getElementById(`${type}-buttons`).appendChild(button);
    }

    // Các hàm phụ trợ
    function initKeyMapping() {
      keyMapping = {};
      Object.keys(storageKeys).forEach(type => {
        const sounds = JSON.parse(localStorage.getItem(storageKeys[type])) || [];
        sounds.forEach(sound => {
          if (sound.shortcut) keyMapping[sound.shortcut.toLowerCase()] = sound.id;
        });
      });
    }

    function getColor(type) {
      return {
        laughter: 'bg-blue-500',
        interaction: 'bg-green-500',
        victory: 'bg-red-500'
      }[type];
    }

    function stopAll() {
      if(currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
      }
    }

async function exportConfig() {
    try {
        const db = await initDB();
        const transaction = db.transaction('audioFiles', 'readonly');
        const store = transaction.objectStore('audioFiles');

        const config = {
            metadata: Object.keys(storageKeys).reduce((acc, type) => {
                acc[type] = JSON.parse(localStorage.getItem(storageKeys[type])) || [];
                return acc;
            }, {}),
            files: []
        };

        // Bước 1: Thu thập tất cả files đồng bộ
        const allFiles = await new Promise((resolve, reject) => {
            const files = [];
            const request = store.openCursor();
            
            request.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    files.push({
                        id: cursor.value.id,
                        file: cursor.value.file
                    });
                    cursor.continue();
                } else {
                    resolve(files);
                }
            };
            
            request.onerror = reject;
        });

        // Bước 2: Xử lý đọc file không đồng bộ
        config.files = await Promise.all(
            allFiles.map(async ({ id, file }) => {
                try {
                    const arrayBuffer = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result);
                        reader.onerror = reject;
                        reader.readAsArrayBuffer(file);
                    });
                    
                    return {
                        id,
                        name: file.name,
                        type: file.type,
                        data: {
                            buffer: Array.from(new Uint8Array(arrayBuffer)),
                            type: 'Buffer'
                        }
                    };
                } catch (error) {
                    console.error(`Lỗi đọc file ${id}:`, error);
                    return null;
                }
            })
        );

        // Lọc các file lỗi
        config.files = config.files.filter(f => f !== null);

        // Tạo file download
        const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `soundboard-export-${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        
        setTimeout(() => {
            URL.revokeObjectURL(url);
        }, 1000);

    } catch (error) {
        alert('Lỗi export: ' + error.message);
        console.error('Chi tiết lỗi export:', error);
    }
}


async function importConfig(input) {
    try {
        const file = input.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            const rawConfig = JSON.parse(e.target.result);
            
            // Validate cấu trúc config
            if (!validateConfig(rawConfig)) {
                throw new Error('File config không hợp lệ');
            }

            const db = await initDB();
            const transaction = db.transaction('audioFiles', 'readwrite');
            const store = transaction.objectStore('audioFiles');

            // Clear existing data
            await new Promise((resolve, reject) => {
                const clearRequest = store.clear();
                clearRequest.onsuccess = resolve;
                clearRequest.onerror = reject;
            });

            // Xử lý từng file với progress
            let successCount = 0;
            const totalFiles = rawConfig.files.length;
            const failedFiles = [];

            for (const [index, fileData] of rawConfig.files.entries()) {
                try {
                    // Validate file data
                    if (!fileData.data || !fileData.type || !fileData.id) {
                        throw new Error('Thiếu trường dữ liệu bắt buộc');
                    }

                    // Chuyển đổi dữ liệu
                    const uintArray = new Uint8Array(fileData.data.buffer);
                    const blob = new Blob([uintArray], { type: fileData.type });

                    // Thêm vào database
                    await new Promise((resolve, reject) => {
                        const request = store.put({ 
                            id: fileData.id,
                            file: blob,
                            _importedAt: Date.now()
                        });

                        request.onsuccess = () => {
                            successCount++;
                            updateProgress(successCount, totalFiles);
                            resolve();
                        };
                        request.onerror = () => reject(new Error(`Lỗi IDB: ${fileData.id}`));
                    });
                } catch (error) {
                    console.error(`Lỗi file ${fileData.id || 'unknown'}:`, error);
                    failedFiles.push({
                        id: fileData.id,
                        error: error.message
                    });
                }
            }

            // Kiểm tra final check
            const importedCount = await new Promise(resolve => {
                const countRequest = store.count();
                countRequest.onsuccess = () => resolve(countRequest.result);
            });

            // Cập nhật metadata
            Object.entries(rawConfig.metadata).forEach(([type, data]) => {
                if (storageKeys[type]) {
                    localStorage.setItem(storageKeys[type], JSON.stringify(data));
                }
            });

            // Thông báo kết quả
            const resultMessage = [
                `Hoàn thành: ${successCount}/${totalFiles}`,
                failedFiles.length > 0 && `Lỗi: ${failedFiles.length} file`,
                failedFiles.length > 0 && 'Xem console để biết chi tiết'
            ].filter(Boolean).join('\n');

            alert(resultMessage);
            if (failedFiles.length > 0) {
                console.table(failedFiles);
            }

            // Reload sau 2s
            setTimeout(() => location.reload(), 2000);
        };

        reader.onerror = (e) => {
            throw new Error('Lỗi đọc file: ' + e.target.error);
        };
        
        reader.readAsText(file);
        
    } catch (error) {
        alert('Lỗi import: ' + error.message);
        console.error('Lỗi chi tiết:', error);
    }
}

// Hàm validate config
function validateConfig(config) {
    try {
        return (
            config.metadata &&
            config.files &&
            Object.keys(storageKeys).every(k => config.metadata[k] !== undefined) &&
            config.files.every(f => f.id && f.data && f.type)
        );
    } catch {
        return false;
    }
}

// Hiển thị tiến trình
function updateProgress(current, total) {
    console.log(`Đang xử lý: ${Math.round((current/total)*100)}%`);
    // Có thể thêm UI progress bar nếu cần
}