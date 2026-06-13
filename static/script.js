'use strict';

const TABLE_BODY    = document.getElementById('row-tbody');
const STATUS_MSG    = document.getElementById('status-msg');
const PROGRESS_WRAP = document.getElementById('progress-wrap');
const PROGRESS_FILL = document.getElementById('progress-fill');
const PROGRESS_LBL  = document.getElementById('progress-label');
const DOWNLOAD_BTN  = document.getElementById('download-btn');
const ZIP_NAME      = document.getElementById('zip-name');
const PASTE_SECTION = document.getElementById('paste-section');
const PASTE_AREA    = document.getElementById('paste-area');
const COL_MAP_ROW   = document.getElementById('col-map-row');

let isDownloading = false;

// ── Row management ──────────────────────────────────────────────────────────

function addRow(url, folder, filename) {
  url      = url      || '';
  folder   = folder   || '';
  filename = filename || '';

  const tr = document.createElement('tr');

  const urlTd = document.createElement('td');
  const urlInput = makeInput('url-input', 'https://example.com/image.jpg', url);
  urlInput.addEventListener('paste', onUrlCellPaste);
  urlTd.appendChild(urlInput);

  const folderTd = document.createElement('td');
  folderTd.appendChild(makeInput('folder-input', 'フォルダ名', folder));

  const fileTd = document.createElement('td');
  fileTd.appendChild(makeInput('filename-input', 'ファイル名.jpg', filename));

  const delTd = document.createElement('td');
  delTd.className = 'col-del';
  const delBtn = document.createElement('button');
  delBtn.className = 'row-del-btn';
  delBtn.title = '削除';
  delBtn.textContent = '✕';
  delBtn.addEventListener('click', function () { deleteRow(this); });
  delTd.appendChild(delBtn);

  tr.append(urlTd, folderTd, fileTd, delTd);
  TABLE_BODY.appendChild(tr);
}

function makeInput(cls, placeholder, value) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = cls;
  input.placeholder = placeholder;
  input.value = value;
  return input;
}

function deleteRow(btn) {
  btn.closest('tr').remove();
  if (TABLE_BODY.rows.length === 0) addRow();
}

function clearAll() {
  TABLE_BODY.innerHTML = '';
  for (let i = 0; i < 3; i++) addRow();
  setStatus('');
  hideProgress();
}

// ── Paste in URL cell → expand rows ────────────────────────────────────────

function onUrlCellPaste(e) {
  const text = (e.clipboardData || window.clipboardData).getData('text');
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l);
  if (lines.length <= 1) return;

  e.preventDefault();

  const currentInput = e.target;
  const currentTr    = currentInput.closest('tr');
  currentInput.value = lines[0];

  let insertAfter = currentTr;
  for (let i = 1; i < lines.length; i++) {
    const tr = document.createElement('tr');
    const urlTd = document.createElement('td');
    const urlInput = makeInput('url-input', 'https://example.com/image.jpg', lines[i]);
    urlInput.addEventListener('paste', onUrlCellPaste);
    urlTd.appendChild(urlInput);

    const folderTd = document.createElement('td');
    folderTd.appendChild(makeInput('folder-input', 'フォルダ名', ''));

    const fileTd = document.createElement('td');
    fileTd.appendChild(makeInput('filename-input', 'ファイル名.jpg', ''));

    const delTd = document.createElement('td');
    delTd.className = 'col-del';
    const delBtn = document.createElement('button');
    delBtn.className = 'row-del-btn';
    delBtn.title = '削除';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', function () { deleteRow(this); });
    delTd.appendChild(delBtn);

    tr.append(urlTd, folderTd, fileTd, delTd);

    if (insertAfter.nextSibling) {
      TABLE_BODY.insertBefore(tr, insertAfter.nextSibling);
    } else {
      TABLE_BODY.appendChild(tr);
    }
    insertAfter = tr;
  }
}

// ── Bulk paste ──────────────────────────────────────────────────────────────

function togglePaste() {
  PASTE_SECTION.classList.toggle('visible');
}

function onPasteAreaInput() {
  const text = PASTE_AREA.value.trim();
  if (!text) { COL_MAP_ROW.style.display = 'none'; return; }
  const sep  = text.split(/\r?\n/)[0].includes('\t') ? '\t' : ',';
  const cols = text.split(/\r?\n/)[0].split(sep).length;
  COL_MAP_ROW.style.display = cols === 2 ? 'flex' : 'none';
}

function applyPaste() {
  const text = PASTE_AREA.value.trim();
  if (!text) return;

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l);
  if (!lines.length) return;

  const sep     = lines[0].includes('\t') ? '\t' : ',';
  const mapping = (document.querySelector('input[name="col-map"]:checked') || {}).value || 'filename';

  TABLE_BODY.innerHTML = '';

  for (const line of lines) {
    const parts = line.split(sep).map(p => p.trim().replace(/^"|"$/g, ''));
    let url = '', folder = '', filename = '';

    if (parts.length >= 3) {
      [url, folder, filename] = parts;
    } else if (parts.length === 2) {
      url = parts[0];
      if (mapping === 'folder') folder = parts[1];
      else filename = parts[1];
    } else {
      url = parts[0];
    }

    addRow(url, folder, filename);
  }

  PASTE_SECTION.classList.remove('visible');
  PASTE_AREA.value = '';
  COL_MAP_ROW.style.display = 'none';
  setStatus(`${lines.length} 行を反映しました`, 'info');
}

// ── Download ────────────────────────────────────────────────────────────────

function getRows() {
  const rows = [];
  for (const tr of TABLE_BODY.rows) {
    const url      = tr.querySelector('.url-input').value.trim();
    const folder   = tr.querySelector('.folder-input').value.trim();
    const filename = tr.querySelector('.filename-input').value.trim();
    if (url) rows.push({ url, folder, filename });
  }
  return rows;
}

async function startDownload() {
  if (isDownloading) return;

  const rows = getRows();
  if (!rows.length) {
    setStatus('URLを入力してください', 'error');
    return;
  }

  const zipName = ZIP_NAME.value.trim() || 'images_download';

  isDownloading = true;
  DOWNLOAD_BTN.disabled = true;
  DOWNLOAD_BTN.classList.add('btn--loading');
  setStatus('ダウンロードを開始します...', 'info');
  showProgress(0, '準備中...');

  try {
    const res = await fetch('/api/start-download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows, zip_name: zipName }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'エラーが発生しました');
    }

    const { task_id } = await res.json();
    watchProgress(task_id);

  } catch (err) {
    resetDownloadBtn();
    setStatus(err.message, 'error');
  }
}

function watchProgress(taskId) {
  const es = new EventSource(`/api/progress/${taskId}`);

  es.onmessage = function (e) {
    const data = JSON.parse(e.data);
    showProgress(data.progress, data.message);

    if (data.status === 'done') {
      es.close();
      resetDownloadBtn();
      setStatus(data.message || '完了しました', 'success');
      window.location.href = `/api/download/${taskId}`;
    } else if (data.status === 'error') {
      es.close();
      resetDownloadBtn();
      setStatus(data.message || 'エラーが発生しました', 'error');
    }
  };

  es.onerror = function () {
    es.close();
    resetDownloadBtn();
    setStatus('接続エラーが発生しました', 'error');
  };
}

function resetDownloadBtn() {
  isDownloading = false;
  DOWNLOAD_BTN.disabled = false;
  DOWNLOAD_BTN.classList.remove('btn--loading');
}

// ── UI helpers ──────────────────────────────────────────────────────────────

function setStatus(msg, type) {
  type = type || '';
  STATUS_MSG.textContent = msg;
  STATUS_MSG.className = 'status-msg' + (msg ? ' visible' : '') + (type ? ' ' + type : '');
}

function showProgress(pct, label) {
  PROGRESS_WRAP.classList.add('visible');
  PROGRESS_FILL.style.width = pct + '%';
  PROGRESS_LBL.textContent = label || '';
}

function hideProgress() {
  PROGRESS_WRAP.classList.remove('visible');
  PROGRESS_FILL.style.width = '0%';
  PROGRESS_LBL.textContent = '';
}

// ── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  for (let i = 0; i < 3; i++) addRow();

  document.getElementById('add-row-btn').addEventListener('click', function () { addRow(); });
  document.getElementById('clear-btn').addEventListener('click', clearAll);
  document.getElementById('paste-toggle-btn').addEventListener('click', togglePaste);
  document.getElementById('apply-paste-btn').addEventListener('click', applyPaste);
  DOWNLOAD_BTN.addEventListener('click', startDownload);
  PASTE_AREA.addEventListener('input', onPasteAreaInput);
});
