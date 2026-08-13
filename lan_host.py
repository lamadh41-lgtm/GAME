#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
مضيف Story Mode (LAN + أونلاين عام من غير VPN).

  python lan_host.py

المنفذ الافتراضي: 27100

محلياً / Radmin:
  شارك IP جهازك مع اللاعبين.

أونلاين من أي مكان (من غير VPN):
  1) شغّل:  python lan_host.py
  2) في تيرمينال تاني:
       cloudflared tunnel --url http://localhost:27100
  3) انسخ الرابط اللي يطلع (مثل https://xxxx.trycloudflare.com)
  4) اللاعبين يلصقوا نفس الرابط في خانة عنوان السيرفر داخل اللعبة

تحميل cloudflared (مرة واحدة):
  https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/

نسخة محسّنة: ThreadingHTTPServer + رسائل أكتر + استجابة أسرع
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
import json
import threading
import time
import socket
import os

PORT = int(os.environ.get('STORY_PORT', '27100'))
# room -> { messages: [{id, t, data}], seq }
ROOMS = {}
LOCK = threading.Lock()
MAX_MSG = 800  # أكثر من قبل عشان pose السريع مايمسحش رسائل مهمة


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
    out, seen = [], set()
    for ip in ips:
        if ip not in seen:
            seen.add(ip)
            out.append(ip)
    return out or ['127.0.0.1']


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        pass  # quiet

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Connection', 'keep-alive')
        self.send_header('Cache-Control', 'no-store')

    def _json(self, code, obj):
        body = json.dumps(obj, separators=(',', ':')).encode('utf-8')
        self.send_response(code)
        self._cors()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        u = urlparse(self.path)
        if u.path in ('/', '/status'):
            with LOCK:
                rooms = list(ROOMS.keys())
            self._json(200, {
                'ok': True,
                'service': 'story-mode-lan',
                'port': PORT,
                'ips': local_ips(),
                'rooms': rooms,
                'fast': True
            })
            return

        if u.path == '/poll':
            qs = parse_qs(u.query)
            room = (qs.get('room') or ['default'])[0].strip().lower()
            try:
                since = int((qs.get('since') or ['0'])[0] or 0)
            except Exception:
                since = 0
            with LOCK:
                if room not in ROOMS:
                    ROOMS[room] = {'seq': 0, 'messages': []}
                r = ROOMS[room]
                msgs = [m for m in r['messages'] if m['id'] > since]
            self._json(200, {'ok': True, 'messages': msgs})
            return

        self.send_response(404)
        self._cors()
        self.send_header('Content-Length', '0')
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
                # Keep only LATEST pose per player — prevents lag after long sessions
                if isinstance(data, dict) and data.get('type') == 'pose' and data.get('id'):
                    pid = data.get('id')
                    r['messages'] = [
                        m for m in r['messages']
                        if not (
                            isinstance(m.get('data'), dict)
                            and m['data'].get('type') == 'pose'
                            and m['data'].get('id') == pid
                        )
                    ]
                r['seq'] += 1
                r['messages'].append({'id': r['seq'], 't': time.time(), 'data': data})
                if len(r['messages']) > MAX_MSG:
                    r['messages'] = r['messages'][-MAX_MSG:]
                seq = r['seq']
            self._json(200, {'ok': True, 'id': seq})
            return

        self.send_response(404)
        self._cors()
        self.send_header('Content-Length', '0')
        self.end_headers()


def main():
    ips = local_ips()
    print('========================================')
    print('  Story Mode — مضيف (LAN / أونلاين عام)')
    print('========================================')
    print('المنفذ:', PORT)
    print('عناوين IP محلية (LAN / Radmin):')
    for ip in ips:
        print('  →', ip)
    print('')
    print('للأونلاين من أي مكان (من غير VPN):')
    print('  في تيرمينال آخر شغّل:')
    print('    cloudflared tunnel --url http://localhost:%d' % PORT)
    print('  ثم انسخ الرابط https://....trycloudflare.com')
    print('  واللاعبين يلصقوه في خانة عنوان السيرفر.')
    print('')
    print('اترك هذه النافذة مفتوحة أثناء اللعب.')
    print('========================================')
    server = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    server.daemon_threads = True
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nتم الإيقاف.')


if __name__ == '__main__':
    main()
