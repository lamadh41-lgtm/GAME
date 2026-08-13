#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
مضيف LAN محلي للعبة Story Mode — من غير إنترنت.
شغّله على جهاز القائد، والباقي يتصلوا على IP الجهاز ده.

  python lan_host.py

المنفذ الافتراضي: 27100
"""
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs
import json
import threading
import time
import socket

PORT = 27100
# room -> { messages: [{id, t, data}], seq }
ROOMS = {}
LOCK = threading.Lock()
MAX_MSG = 200


def local_ips():
    ips = []
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = info[4][0]
            if ip and not ip.startswith('127.'):
                ips.append(ip)
    except Exception:
        pass
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ips.append(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    # unique preserve order
    out, seen = [], set()
    for ip in ips:
        if ip not in seen:
            seen.add(ip)
            out.append(ip)
    return out or ['127.0.0.1']


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # quiet

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        u = urlparse(self.path)
        if u.path in ('/', '/status'):
            body = json.dumps({
                'ok': True,
                'service': 'story-mode-lan',
                'port': PORT,
                'ips': local_ips(),
                'rooms': list(ROOMS.keys())
            }).encode('utf-8')
            self.send_response(200)
            self._cors()
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if u.path == '/poll':
            qs = parse_qs(u.query)
            room = (qs.get('room') or ['default'])[0].strip().lower()
            since = int((qs.get('since') or ['0'])[0] or 0)
            with LOCK:
                if room not in ROOMS:
                    ROOMS[room] = {'seq': 0, 'messages': []}
                r = ROOMS[room]
                msgs = [m for m in r['messages'] if m['id'] > since]
            body = json.dumps({'ok': True, 'messages': msgs}).encode('utf-8')
            self.send_response(200)
            self._cors()
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        self.send_response(404)
        self._cors()
        self.end_headers()

    def do_POST(self):
        u = urlparse(self.path)
        length = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(length) if length else b'{}'
        try:
            payload = json.loads(raw.decode('utf-8'))
        except Exception:
            payload = {}

        if u.path == '/send':
            room = str(payload.get('room') or 'default').strip().lower()
            data = payload.get('data')
            with LOCK:
                if room not in ROOMS:
                    ROOMS[room] = {'seq': 0, 'messages': []}
                r = ROOMS[room]
                r['seq'] += 1
                r['messages'].append({'id': r['seq'], 't': time.time(), 'data': data})
                if len(r['messages']) > MAX_MSG:
                    r['messages'] = r['messages'][-MAX_MSG:]
            body = json.dumps({'ok': True, 'id': r['seq']}).encode('utf-8')
            self.send_response(200)
            self._cors()
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        self.send_response(404)
        self._cors()
        self.end_headers()


def main():
    ips = local_ips()
    print('========================================')
    print('  Story Mode — مضيف LAN (بدون إنترنت)')
    print('========================================')
    print('المنفذ:', PORT)
    print('عناوين IP لجهازك (شارك واحد مع أصحابك):')
    for ip in ips:
        print('  →', ip)
    print('')
    print('القائد وأصحابه يكتبوا هذا الـ IP في اللعبة')
    print('مع رمز اللوبي. اترك هذه النافذة مفتوحة.')
    print('========================================')
    server = HTTPServer(('0.0.0.0', PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nتم الإيقاف.')


if __name__ == '__main__':
    main()
