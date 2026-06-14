import io
import json
import mimetypes
import os
import re
import threading
import time
import uuid
import zipfile
from urllib.parse import urlparse, unquote

import requests as req
from flask import Flask, Response, jsonify, render_template, request, send_file, stream_with_context

app = Flask(__name__)

_tasks: dict = {}
_tasks_lock = threading.Lock()


def _sanitize(name: str) -> str:
    name = name.strip()
    name = re.sub(r'[/\\:*?"<>|]', '', name)
    name = re.sub(r'\s+', '-', name)
    return name.lower()


def _basename_from_url(url: str) -> str:
    path = unquote(urlparse(url).path)
    return os.path.basename(path) or ''


def _ext_from_content_type(ct: str) -> str:
    base = ct.split(';')[0].strip()
    ext = mimetypes.guess_extension(base)
    if ext in ('.jpe', '.jpeg', '.jfif'):
        ext = '.jpg'
    return ext or ''


def _dedupe(used: set, name: str) -> str:
    if name not in used:
        used.add(name)
        return name
    stem, sep, ext = name.rpartition('.')
    template = f'{stem}-{{n}}.{ext}' if sep else f'{name}-{{n}}'
    for n in range(2, 9999):
        candidate = template.format(n=n)
        if candidate not in used:
            used.add(candidate)
            return candidate
    return name


def _update_task(task_id: str, **kwargs):
    with _tasks_lock:
        _tasks[task_id].update(kwargs)


def _run_task(task_id: str, rows: list, zip_name: str):
    buf = io.BytesIO()
    total = len(rows)
    done = 0
    errors = []
    used_names: set = set()

    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        for i, row in enumerate(rows):
            url = row.get('url', '').strip()
            folder = _sanitize(row.get('folder', '') or '')
            filename = _sanitize(row.get('filename', '') or '')

            short_url = url[:70] + '...' if len(url) > 70 else url
            _update_task(task_id,
                         progress=int(done / total * 100),
                         message=f'({done + 1}/{total}) {short_url}')

            try:
                resp = req.get(url, timeout=20,
                               headers={'User-Agent': 'Mozilla/5.0 (compatible; SuperiorDownload/1.0)'})
                resp.raise_for_status()

                if not filename:
                    filename = _sanitize(_basename_from_url(url))

                # Ensure extension
                _, sep, _ = filename.rpartition('.')
                if not sep:
                    ext = _ext_from_content_type(resp.headers.get('Content-Type', ''))
                    filename = (filename or f'image-{i + 1}') + ext

                if not filename:
                    filename = f'image-{i + 1}'

                arcname = f'{folder}/{filename}' if folder else filename
                arcname = _dedupe(used_names, arcname)
                zf.writestr(arcname, resp.content)

            except Exception as exc:
                errors.append(f'{url}: {exc}')

            done += 1

    buf.seek(0)
    success_count = total - len(errors)
    msg = f'完了 — {success_count} 件ダウンロード済み'
    if errors:
        msg += f'、{len(errors)} 件エラー'

    with _tasks_lock:
        _tasks[task_id].update({
            'progress': 100,
            'message': msg,
            'status': 'done',
            'zip_data': buf.read(),
            'zip_name': _sanitize(zip_name) or 'images_download',
            'errors': errors,
        })


def _cleanup_old_tasks():
    cutoff = time.time() - 3600
    with _tasks_lock:
        stale = [tid for tid, t in _tasks.items() if t.get('created_at', 0) < cutoff]
        for tid in stale:
            del _tasks[tid]


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/about')
def about():
    return render_template('about.html')


@app.route('/api/start-download', methods=['POST'])
def start_download():
    _cleanup_old_tasks()

    data = request.get_json(force=True)
    rows = [r for r in data.get('rows', []) if r.get('url', '').strip()]
    zip_name = data.get('zip_name', 'images_download')

    if not rows:
        return jsonify({'error': 'URLが入力されていません'}), 400

    task_id = str(uuid.uuid4())
    with _tasks_lock:
        _tasks[task_id] = {
            'progress': 0,
            'message': '準備中...',
            'status': 'working',
            'zip_data': None,
            'zip_name': None,
            'errors': [],
            'created_at': time.time(),
        }

    threading.Thread(target=_run_task, args=(task_id, rows, zip_name), daemon=True).start()
    return jsonify({'task_id': task_id})


@app.route('/api/progress/<task_id>')
def progress(task_id: str):
    def generate():
        while True:
            with _tasks_lock:
                task = _tasks.get(task_id)

            if not task:
                yield f'data: {json.dumps({"error": "タスクが見つかりません", "status": "error"})}\n\n'
                return

            yield f'data: {json.dumps({"progress": task["progress"], "message": task["message"], "status": task["status"]})}\n\n'

            if task['status'] in ('done', 'error'):
                return

            time.sleep(0.4)

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'},
    )


@app.route('/api/download/<task_id>')
def download_zip(task_id: str):
    with _tasks_lock:
        task = _tasks.get(task_id)

    if not task or task['status'] != 'done' or not task['zip_data']:
        return jsonify({'error': 'ZIPが見つかりません'}), 404

    return send_file(
        io.BytesIO(task['zip_data']),
        mimetype='application/zip',
        as_attachment=True,
        download_name=f"{task['zip_name'] or 'images_download'}.zip",
    )


if __name__ == '__main__':
    app.run(debug=False, host='0.0.0.0', port=int(os.environ.get('PORT', 5001)), threaded=True)
