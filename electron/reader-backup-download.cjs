'use strict';
const path = require('node:path');

// Only the Reader's explicitly requested JSON backup gets a native save dialog.
function installReaderBackupDownloads(session, getWindow, downloadsPath, readerOrigin = 'http://127.0.0.1:5175') {
  session.on('will-download', (_event, item, contents) => {
    const win = getWindow();
    if (!win || win.isDestroyed() || contents !== win.webContents) return;
    const url = item.getURL();
    const name = item.getFilename();
    const prefix = `blob:${readerOrigin}/`;
    if (!url.startsWith(prefix) || !/^[0-9a-f-]+$/i.test(url.slice(prefix.length))
      || !/^vantilo-reading-backup-\d{4}-\d{2}-\d{2}\.json$/.test(name)) return;
    item.setSaveDialogOptions({ title: '保存阅读数据备份', defaultPath: path.join(downloadsPath, name), filters: [{ name: '阅读备份', extensions: ['json'] }] });
  });
}
module.exports = { installReaderBackupDownloads };
