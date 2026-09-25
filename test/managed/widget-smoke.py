"""Manual browser fixture using the actual SDK, widget and collector; no GPT/AWS.

Run: python3 -B test/managed/widget-smoke.py
All visits are required to be test actors. Data is held in memory until exit.
"""
import hashlib
import importlib.util
import json
import mimetypes
from pathlib import Path
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse
import time

ROOT = Path(__file__).resolve().parents[2] / 'src' / 'managed'
spec = importlib.util.spec_from_file_location('collector', ROOT / 'collector.py')
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)
collector.EXPERIMENT = {
    'id': 'exp_widget_smoke', 'sourceCommit': 'fixture-only',
    'events': [{'id': 'add_to_bag', 'label': 'Added to bag'}], 'funnel': ['add_to_bag'],
    'questions': [{'id': 'payment', 'label': 'Which payment method would you prefer?', 'kind': 'choice',
                   'options': [{'id': 'crypto', 'label': 'Crypto'}, {'id': 'card', 'label': 'Card'}, {'id': 'neither', 'label': 'Neither'}]}],
    'limitations': ['Internal browser QA only. No actual user evidence or sale.']}

class Store:
    def __init__(self): self.data = {}
    def get(self, sid): return self.data.get(sid)
    def create(self, item, now): self.data[item['id']] = item; return item
    def events(self, sid, values, now): self.data[sid]['events'].update({k: now for k in values})
    def feedback(self, sid, value, now): self.data[sid]['feedback'] = value; self.data[sid]['lastAt'] = now
    def rows(self, now): return list(self.data.values())

store = Store()
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def send(self, value, kind='application/json', status=200):
        raw = value if isinstance(value, bytes) else (value if isinstance(value, str) else json.dumps(value)).encode()
        self.send_response(status); self.send_header('Content-Type', kind)
        self.send_header('Cache-Control', 'no-store'); self.end_headers(); self.wfile.write(raw)
    def do_GET(self):
        path = urlparse(self.path).path
        if path == '/':
            return self.send('''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LaunchLab · internal widget test</title><script src="/__launchlab/sdk.js"></script></head>
<body style="background:#17121f;color:white;font:18px system-ui;padding:48px"><p>INTERNAL QA · NO SALES OR REAL USERS</p><h1>PROOF / REPS fixture</h1><p>Try the product action, then share test feedback.</p><button data-launchlab-event="add_to_bag" style="font:inherit;padding:16px">Add example tee to bag</button><p><a style="color:#e3b5fb" href="/__test/report">Inspect test report</a></p><script type="module" src="/__launchlab/widget.js"></script></body></html>''', 'text/html')
        if path == '/__launchlab/config.json':
            return self.send({'project': 'dep_browser_fixture', 'name': 'PROOF / REPS fixture', 'hypothesis': 'Internal QA: check feedback and action collection.', 'apiBase': origin + '/api', 'experiment': collector.EXPERIMENT})
        if path.startswith('/__launchlab/'):
            name = path.removeprefix('/__launchlab/')
            if name in ['sdk.js', 'widget.js', 'widget-v2.js', 'widget.css']:
                return self.send((ROOT / 'assets' / name).read_bytes(), mimetypes.guess_type(name)[0] or 'text/plain')
        if path == '/__test/report':
            now = int(time.time())
            return self.send({'test': collector.report(store.rows(now), now, cohort='test'), 'organic': collector.report(store.rows(now), now, cohort='organic')})
        self.send({'error': 'Not found'}, status=404)
    def do_POST(self):
        path = urlparse(self.path).path
        raw = self.rfile.read(min(int(self.headers.get('Content-Length', 0)), 12001)).decode()
        if path == '/api/sessions' and json.loads(raw).get('actor') != 'test':
            return self.send({'error': 'Open the fixture with ?test=1; only test sessions are allowed.'}, status=400)
        event = {'rawPath': path.removeprefix('/api'), 'requestContext': {'http': {'method': 'POST'}}, 'headers': {k.lower(): v for k, v in self.headers.items()}, 'body': raw}
        result = collector.handle(event, store, {'STORE_ORIGIN': origin, 'SESSION_SECRET': 'disposable-local-fixture', 'REPORT_TOKEN_SHA256': hashlib.sha256(b'fixture-only').hexdigest()}, int(time.time()))
        self.send(result['body'], status=result['statusCode'])

if __name__ == '__main__':
    server = HTTPServer(('127.0.0.1', 0), Handler)
    origin = 'http://127.0.0.1:' + str(server.server_port)
    print(origin + '/?test=1', flush=True)
    server.serve_forever()
