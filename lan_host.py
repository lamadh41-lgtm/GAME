#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
مضيف Story Mode — أداء عالي + رومات مربوطة بالقائد.

  python lan_host.py
  cloudflared tunnel --url http://localhost:27100
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
import json
import threading
import time
import socket
import os

PORT = int(os.environ.get('STORY_PORT', '27100'))
ROOMS = {}
LOCK = threading.Lock()
MAX_MSG = 150
MAX_POSE_PLAYERS = 16
HOST_TIMEOUT = 45.0   # seconds without host heartbeat → room gone (was 12; too aggressive on LAN)
ROOM_TTL = 30 * 60
# Grace: after room creation, don't delete for this long even if beat is late
ROOM_GRACE = 8.0


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


def ensure_room(room):
    if room not in ROOMS:
        now = time.time()
        ROOMS[room] = {
            'seq': 0,
            'messages': [],
            'poses': {},
            'meta': {
                'name': room,
                'host': '',
                'host_id': '',
                'players': 0,
                'created': now,
                'updated': now,
                'host_beat': now,
                'playing': False,
                'visible': True,
            }
        }
    return ROOMS[room]


def is_host_alive(meta, now=None):
    now = now if now is not None else time.time()
    beat = meta.get('host_beat', 0) or 0
    created = meta.get('created', 0) or 0
    # Fresh rooms get a grace window so joiners don't race the first heartbeat
    if (now - created) < ROOM_GRACE:
        return True
    return (now - beat) <= HOST_TIMEOUT


def cleanup_rooms():
    now = time.time()
    dead = []
    for k, r in list(ROOMS.items()):
        m = r['meta']
        if not is_host_alive(m, now):
            dead.append(k)
            continue
        if now - m.get('updated', 0) > ROOM_TTL:
            dead.append(k)
    for k in dead:
        ROOMS.pop(k, None)


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        pass

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
                cleanup_rooms()
                rooms = list(ROOMS.keys())
            self._json(200, {
                'ok': True,
                'service': 'story-mode-lan',
                'port': PORT,
                'ips': local_ips(),
                'rooms': rooms,
                'fast': True,
                't': time.time()
            })
            return

        if u.path == '/rooms':
            with LOCK:
                cleanup_rooms()
                now = time.time()
                out = []
                for code, r in ROOMS.items():
                    m = r['meta']
                    if not is_host_alive(m, now):
                        continue
                    if not m.get('visible', True):
                        continue
                    out.append({
                        'code': code,
                        'host': m.get('host') or '',
                        'players': m.get('players') or max(1, len(r.get('poses') or {})),
                        'playing': bool(m.get('playing')),
                        'updated': m.get('updated', 0),
                    })
                out.sort(key=lambda x: -x['updated'])
            self._json(200, {'ok': True, 'rooms': out, 't': time.time()})
            return

        if u.path == '/ping':
            self._json(200, {'ok': True, 't': time.time()})
            return

        if u.path == '/poll':
            qs = parse_qs(u.query)
            room = (qs.get('room') or ['default'])[0].strip().lower()
            try:
                since = int((qs.get('since') or ['0'])[0] or 0)
            except Exception:
                since = 0
            with LOCK:
                # Room not created yet (joiner raced host) → not dead, just missing
                if room not in ROOMS:
                    self._json(200, {
                        'ok': True,
                        'messages': [],
                        'poses': [],
                        'missing': True,
                        'dead': False,
                        't': time.time()
                    })
                    return
                r = ROOMS[room]
                now = time.time()
                # host truly gone → only then mark dead
                if not is_host_alive(r['meta'], now):
                    del ROOMS[room]
                    self._json(200, {'ok': True, 'messages': [], 'poses': [], 'dead': True, 't': time.time()})
                    return
                r['meta']['updated'] = now
                msgs = [m for m in r['messages'] if m['id'] > since]
                poses = list(r['poses'].values())
            self._json(200, {
                'ok': True,
                'messages': msgs,
                'poses': poses,
                't': time.time()
            })
            return

        self.send_response(404)
        self._cors()
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_POST(self):
        u = urlparse(self.path)
        length = int(self.headers.get('Content-Length') or 0)
        if length > 65536:
            length = 65536
        raw = self.rfile.read(length) if length else b'{}'
        try:
            payload = json.loads(raw.decode('utf-8'))
        except Exception:
            payload = {}

        if u.path == '/send':
            room = str(payload.get('room') or 'default').strip().lower()
            data = payload.get('data')
            with LOCK:
                r = ensure_room(room)
                r['meta']['updated'] = time.time()

                is_pose = isinstance(data, dict) and data.get('type') == 'pose' and data.get('id')
                is_host_msg = isinstance(data, dict) and (
                    data.get('isHost') or
                    (isinstance(data.get('id'), str) and str(data.get('id')).startswith('host_'))
                )

                # Host pose/heartbeat refreshes host_beat
                if is_host_msg or (is_pose and isinstance(data.get('id'), str) and str(data.get('id')).startswith('host_')):
                    r['meta']['host_beat'] = time.time()
                    if data.get('name') and not r['meta'].get('host'):
                        r['meta']['host'] = str(data.get('name'))[:32]
                    if data.get('id'):
                        r['meta']['host_id'] = str(data.get('id'))

                if is_pose:
                    pid = str(data.get('id'))
                    r['seq'] += 1
                    entry = {'id': r['seq'], 't': time.time(), 'data': data}
                    r['poses'][pid] = entry
                    if len(r['poses']) > MAX_POSE_PLAYERS:
                        items = sorted(r['poses'].items(), key=lambda kv: kv[1].get('t', 0))
                        r['poses'] = dict(items[-MAX_POSE_PLAYERS:])
                    seq = r['seq']
                    r['meta']['players'] = max(1, len(r['poses']))
                else:
                    if isinstance(data, dict) and data.get('type') == 'chat':
                        chats = [m for m in r['messages'] if isinstance(m.get('data'), dict) and m['data'].get('type') == 'chat']
                        if len(chats) > 30:
                            drop_ids = set(m['id'] for m in chats[:-20])
                            r['messages'] = [m for m in r['messages'] if m['id'] not in drop_ids]

                    if isinstance(data, dict):
                        t = data.get('type')
                        if t == 'join':
                            if data.get('isHost') or data.get('host'):
                                r['meta']['host'] = str(data.get('name') or r['meta'].get('host') or '')[:32]
                                r['meta']['host_id'] = str(data.get('clientId') or data.get('id') or r['meta'].get('host_id') or '')
                                r['meta']['host_beat'] = time.time()
                                r['meta']['visible'] = True
                            elif data.get('name') and not r['meta'].get('host'):
                                r['meta']['host'] = str(data.get('name'))[:32]
                        if t == 'heartbeat' or t == 'hostbeat':
                            r['meta']['host_beat'] = time.time()
                            if data.get('name'):
                                r['meta']['host'] = str(data.get('name'))[:32]
                            r['meta']['visible'] = True
                            r['meta']['players'] = int(data.get('players') or r['meta'].get('players') or 1)
                        if t == 'start':
                            r['meta']['playing'] = True
                            r['meta']['host_beat'] = time.time()
                        if t == 'leave' or t == 'exit':
                            pid = str(data.get('id') or '')
                            if pid:
                                r['poses'].pop(pid, None)
                            # Host left → delete room only if this really is the host
                            host_id = str(r['meta'].get('host_id') or '')
                            is_host_leave = bool(data.get('isHost'))
                            if not is_host_leave and pid and host_id and pid == host_id:
                                is_host_leave = True
                            if not is_host_leave and pid.startswith('host_') and (not host_id or pid == host_id):
                                is_host_leave = True
                            if is_host_leave:
                                ROOMS.pop(room, None)
                                self._json(200, {'ok': True, 'id': 0, 'closed': True, 't': time.time()})
                                return
                            r['meta']['players'] = max(0, len(r['poses']))

                    r['seq'] += 1
                    r['messages'].append({'id': r['seq'], 't': time.time(), 'data': data})
                    if len(r['messages']) > MAX_MSG:
                        r['messages'] = r['messages'][-MAX_MSG:]
                    seq = r['seq']

            self._json(200, {'ok': True, 'id': seq, 't': time.time()})
            return

        if u.path == '/roommeta':
            room = str(payload.get('room') or 'default').strip().lower()
            with LOCK:
                if payload.get('close') or payload.get('delete'):
                    ROOMS.pop(room, None)
                    self._json(200, {'ok': True, 'closed': True})
                    return
                r = ensure_room(room)
                m = r['meta']
                if payload.get('host'):
                    m['host'] = str(payload.get('host'))[:32]
                if payload.get('host_id'):
                    m['host_id'] = str(payload.get('host_id'))
                if 'players' in payload:
                    try:
                        m['players'] = int(payload.get('players') or 0)
                    except Exception:
                        pass
                if 'playing' in payload:
                    m['playing'] = bool(payload.get('playing'))
                if 'visible' in payload:
                    m['visible'] = bool(payload.get('visible'))
                m['host_beat'] = time.time()
                m['updated'] = time.time()
            self._json(200, {'ok': True})
            return

        self.send_response(404)
        self._cors()
        self.send_header('Content-Length', '0')
        self.end_headers()


def main():
    ips = local_ips()
    print('========================================')
    print('  Story Mode — مضيف (رومات + نبض القائد)')
    print('========================================')
    print('المنفذ:', PORT)
    for ip in ips:
        print('  →', ip)
    print('أونلاين: cloudflared tunnel --url http://localhost:%d' % PORT)
    print('========================================')
    server = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    server.daemon_threads = True
    try:
        server.request_queue_size = 64
    except Exception:
        pass
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nتم الإيقاف.')


if __name__ == '__main__':
    main()
