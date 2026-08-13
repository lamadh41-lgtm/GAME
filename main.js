(function () {
  'use strict';
  if (typeof THREE === 'undefined') {
    document.getElementById('loading-text').textContent = 'خطأ: Three.js';
    return;
  }

  const state = {
    mode: 'menu', levels: {}, currentLevelId: null, buildObjects: [],
    selectedItem: null, currentTool: 'select', currentCategory: 'buildings',
    clock: new THREE.Clock(), keys: {}, player2Joined: false, mouseHidden: false,
    flyMode: false, flyYaw: 0.8, flyPitch: 0.35, flyPos: new THREE.Vector3(15, 18, 15),
    playType: 'split', // split | online
    isHost: true,
    roomCode: null,
    peer: null,
    connection: null, // joiner single connection to host
    connections: [], // host: multiple peer connections
    netRoster: [], // [{ id, name, isHost, peerConnId }]
    myNetId: null,
    remoteMeshes: {}, // netId -> THREE.Group
    maxNetPlayers: 8,
    netPoseTimer: 0,
    lanIp: null,
    lanPort: 27100,
    lanSince: 0,
    lanPollTimer: null,
    useLan: false,
    graphicsLevel: 3,
    scaleMode: 'uniform', // uniform | axis
    netPing: 0,
    netPingBars: 3,
    paused: false,
    pauseSide: 'full', // full | left | right
    volume: 0.8,
    mouseSens: 0.0025,
    gpSens: 0.04,
    camDist: 5.8,
    camHeight: 2.4,
    camSide: 0,
    // Respawn placement (build mode)
    respawnPlaceMode: null, // null | 'lan' | 'split'
    respawnMarkers: [], // THREE.Group meshes currently in scene
    // Player display name (local)
    playerName: '',
    // Full script control layer (programming mode)
    script: {
      inputLocked: [false, false],
      forcedInput: [null, null],
      cameraOverride: [null, null], // { x,y,z, lookX,lookY,lookZ, fov, lerp }
      cutscene: false,
      cutsceneCam: null, // { x,y,z, lookX,lookY,lookZ, fov }
      timeScale: 1,
      blackBars: false,
      subtitle: '',
      flags: {},
      timers: [],
      waiters: []
    }
  };

  const players = [
    { id: 0, group: null, yaw: 0, velocity: new THREE.Vector3(), direction: new THREE.Vector3(), canJump: true, camera: null,
      settings: { sens: 5, camDist: 5.8, camHeight: 2.4, camSide: 0 }, vehicle: null, vehicleSeat: null },
    { id: 1, group: null, yaw: Math.PI, velocity: new THREE.Vector3(), direction: new THREE.Vector3(), canJump: true, camera: null,
      settings: { sens: 5, camDist: 5.8, camHeight: 2.4, camSide: 0 }, vehicle: null, vehicleSeat: null }
  ];
  // pauseOwner: which player opened the menu (0=keyboard, 1=gamepad) — null when closed
  state.pauseOwner = null;

  const loadingScreen = document.getElementById('loading-screen');
  const loadingText = document.getElementById('loading-text');
  const mainMenu = document.getElementById('main-menu');
  const lobbyScreen = document.getElementById('lobby-screen');
  const buildUI = document.getElementById('build-ui');
  const gameUI = document.getElementById('game-ui');
  const canvas = document.getElementById('game-canvas');
  const btnStart = document.getElementById('btn-start-game');
  const flyIndicator = document.getElementById('fly-indicator');

  function toast(msg, type) {
    type = type || 'info';
    var container = document.getElementById('toast-container');
    if (!container) return;
    var el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 2000);
  }

  function askName(title, defaultVal, callback) {
    // Simple in-page prompt replacement via toast + temporary input
    var existing = document.getElementById('inline-prompt');
    if (existing) existing.remove();
    var wrap = document.createElement('div');
    wrap.id = 'inline-prompt';
    wrap.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:10000;background:rgba(18,24,38,0.98);border:1px solid rgba(0,212,255,0.4);border-radius:12px;padding:16px 20px;display:flex;gap:10px;align-items:center;box-shadow:0 10px 40px rgba(0,0,0,0.5);';
    var label = document.createElement('span');
    label.textContent = title;
    label.style.cssText = 'color:#e2e8f0;font-weight:600;font-size:0.9rem;white-space:nowrap;';
    var input = document.createElement('input');
    input.type = 'text';
    input.value = defaultVal || '';
    input.style.cssText = 'padding:8px 12px;border-radius:8px;border:1px solid #2a3548;background:#0a0e17;color:#fff;font-family:inherit;font-size:0.95rem;min-width:160px;';
    var ok = document.createElement('button');
    ok.textContent = 'تم';
    ok.style.cssText = 'padding:8px 16px;border:none;border-radius:8px;background:linear-gradient(135deg,#00b4d8,#0077b6);color:#fff;font-weight:700;cursor:pointer;font-family:inherit;';
    var cancel = document.createElement('button');
    cancel.textContent = 'إلغاء';
    cancel.style.cssText = 'padding:8px 12px;border:1px solid #2a3548;border-radius:8px;background:transparent;color:#94a3b8;cursor:pointer;font-family:inherit;';
    function close(val) {
      wrap.remove();
      if (callback) callback(val);
    }
    ok.onclick = function () { close(input.value.trim() || null); };
    cancel.onclick = function () { close(null); };
    input.onkeydown = function (e) {
      if (e.key === 'Enter') close(input.value.trim() || null);
      if (e.key === 'Escape') close(null);
    };
    wrap.appendChild(label); wrap.appendChild(input); wrap.appendChild(ok); wrap.appendChild(cancel);
    document.body.appendChild(wrap);
    input.focus();
    input.select();
  }



  // ===== SCENE =====
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 70, 180);
  const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setScissorTest(false);

  // ===== Graphics quality (1=حقير .. 5=أسطوري) =====
  var _sunLightRef = null;
  function applyGraphicsQuality(level) {
    level = Math.max(1, Math.min(5, parseInt(level, 10) || 3));
    state.graphicsLevel = level;
    try { localStorage.setItem('sm_graphics', String(level)); } catch (e) {}
    var dpr = window.devicePixelRatio || 1;
    // 1 حقير: lowest res, no shadows, no AA — max FPS
    // 2 منخفض: low res, basic shadows
    // 3 متوسط: balanced
    // 4 عالي: high
    // 5 أسطوري: max quality
    var cfg = {
      1: { pr: 0.6, shadows: false, map: 512, soft: 0.55, softCast: false, type: THREE.BasicShadowMap },
      2: { pr: 0.85, shadows: true, map: 512, soft: 0.75, softCast: true, type: THREE.BasicShadowMap },
      3: { pr: Math.min(dpr, 1.25), shadows: true, map: 1024, soft: 1.0, sunCast: true, type: THREE.PCFShadowMap },
      4: { pr: Math.min(dpr, 1.75), shadows: true, map: 2048, soft: 1.15, sunCast: true, type: THREE.PCFSoftShadowMap },
      5: { pr: Math.min(dpr, 2), shadows: true, map: 4096, soft: 1.35, sunCast: true, type: THREE.PCFSoftShadowMap }
    }[level];
    renderer.setPixelRatio(cfg.pr);
    renderer.shadowMap.enabled = cfg.shadows;
    renderer.shadowMap.type = cfg.type;
    if (_sunLightRef) {
      _sunLightRef.castShadow = cfg.sunCast && cfg.shadows;
      if (cfg.shadows) {
        _sunLightRef.shadow.mapSize.set(cfg.map, cfg.map);
        if (_sunLightRef.shadow.map) {
          try { _sunLightRef.shadow.map.dispose(); } catch (e) {}
          _sunLightRef.shadow.map = null;
        }
      }
      _sunLightRef.intensity = 1.2 * (cfg.fog || 1); // keep readable
    }
    // slightly reduce ground/scene load on low
    try {
      if (typeof ground !== 'undefined' && ground && ground.material) {
        ground.receiveShadow = cfg.shadows;
      }
    } catch (e) {}
    var hints = {
      1: 'الجرافيكس الحقير — أعلى فريمات لأضعف الأجهزة',
      2: 'جرافيكس منخفض — أجهزة ضعيفة',
      3: 'جرافيكس متوسط — توازن الشكل والأداء',
      4: 'جرافيكس عالي — أجهزة قوية',
      5: 'الجرافيكس الأسطوري — أقصى جودة'
    };
    var el = document.getElementById('graphics-hint');
    if (el) el.textContent = hints[level] || '';
    var sel = document.getElementById('set-graphics');
    if (sel) sel.value = String(level);
  }

  let buildCamera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 500);
  buildCamera.position.copy(state.flyPos);

  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const sun = new THREE.DirectionalLight(0xfff5e0, 1.2);
  sun.position.set(40, 60, 30); sun.castShadow = true;
  _sunLightRef = sun;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 200;
  sun.shadow.camera.left = -60; sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 60; sun.shadow.camera.bottom = -60;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x87ceeb, 0x3d8c40, 0.3));

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x4a7c3f, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const gridHelper = new THREE.GridHelper(150, 150, 0x5a8a4a, 0x3d6b35);
  gridHelper.position.y = 0.02; gridHelper.visible = false; scene.add(gridHelper);

  // ===== MODEL FACTORIES =====
  function mat(color, opts) {
    opts = opts || {};
    return new THREE.MeshStandardMaterial({ color: color, roughness: opts.r != null ? opts.r : 0.7, metalness: opts.m || 0, emissive: opts.e || 0, emissiveIntensity: opts.ei || 0, transparent: !!opts.t, opacity: opts.o != null ? opts.o : 1, flatShading: !!opts.flat });
  }
  function box(w, h, d, material) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.castShadow = true; m.receiveShadow = true; return m;
  }
  function cyl(rt, rb, h, segs, material) {
    var m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, segs || 8), material);
    m.castShadow = true; return m;
  }

  function makeHouse(w, h, d, wallC, roofC) {
    var g = new THREE.Group();
    var walls = box(w, h, d, mat(wallC, { r: 0.85 })); walls.position.y = h / 2; g.add(walls);
    var roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.72, h * 0.4, 4), mat(roofC, { r: 0.65 }));
    roof.position.y = h + h * 0.2; roof.rotation.y = Math.PI / 4; roof.castShadow = true; g.add(roof);
    var door = box(w * 0.2, h * 0.5, 0.08, mat(0x5c3317, { r: 0.6 })); door.position.set(0, h * 0.25, d / 2 + 0.02); g.add(door);
    var winM = mat(0x88ccee, { r: 0.25, m: 0.4, e: 0x112233, ei: 0.12 });
    [[-w*0.28, h*0.55], [w*0.28, h*0.55]].forEach(function (p) {
      var win = box(w * 0.16, h * 0.2, 0.06, winM); win.position.set(p[0], p[1], d / 2 + 0.02); g.add(win);
    });
    return g;
  }
  function makeTower(w, h, d, color) {
    var g = new THREE.Group();
    var body = box(w, h, d, mat(color, { r: 0.75, m: 0.15 })); body.position.y = h / 2; g.add(body);
    for (var i = 1; i < 6; i++) {
      var line = box(w + 0.06, 0.07, d + 0.06, mat(0x333333)); line.position.y = (h / 6) * i; g.add(line);
    }
    var ant = cyl(0.04, 0.04, 1.8, 6, mat(0x888888, { m: 0.8 })); ant.position.y = h + 0.9; g.add(ant);
    return g;
  }
  function makeShop(w, h, d) {
    var g = new THREE.Group();
    var body = box(w, h, d, mat(0xc4a882, { r: 0.8 })); body.position.y = h / 2; g.add(body);
    var awn = box(w + 0.4, 0.1, 1.3, mat(0xcc3333)); awn.position.set(0, h * 0.72, d / 2 + 0.55); g.add(awn);
    var win = box(w * 0.7, h * 0.4, 0.08, mat(0xaaddff, { r: 0.2, m: 0.5, e: 0x223344, ei: 0.15 }));
    win.position.set(0, h * 0.4, d / 2 + 0.03); g.add(win);
    return g;
  }
  function makeCar(bodyColor) {
    var g = new THREE.Group();
    var body = box(1.8, 0.55, 4.2, mat(bodyColor, { r: 0.3, m: 0.55 })); body.position.y = 0.55; g.add(body);
    var cabin = box(1.6, 0.5, 2.0, mat(bodyColor, { r: 0.3, m: 0.5 })); cabin.position.set(0, 1.05, -0.15); g.add(cabin);
    // Transparent glass — front, rear, sides
    var glass = mat(0x88ccee, { r: 0.1, m: 0.7, t: true, o: 0.35 });
    var fw = box(1.5, 0.42, 0.05, glass); fw.position.set(0, 1.08, 0.88); g.add(fw);
    var rw = box(1.45, 0.38, 0.05, glass); rw.position.set(0, 1.08, -1.15); g.add(rw);
    var swL = box(0.05, 0.38, 1.7, glass); swL.position.set(-0.82, 1.08, -0.1); g.add(swL);
    var swR = swL.clone(); swR.position.x = 0.82; g.add(swR);
    // Real interior seats (rideable markers for programming mode)
    var seatMat = mat(0x1a1a1a, { r: 0.85 });
    var seatBackMat = mat(0x222222, { r: 0.8 });
    function addSeat(x, z, name) {
      var seat = box(0.55, 0.12, 0.5, seatMat);
      seat.position.set(x, 0.72, z);
      seat.userData = { isSeat: true, seatName: name };
      g.add(seat);
      var back = box(0.55, 0.45, 0.1, seatBackMat);
      back.position.set(x, 0.95, z - 0.28);
      g.add(back);
    }
    addSeat(-0.4, 0.35, 'driver');
    addSeat(0.4, 0.35, 'passenger');
    addSeat(-0.4, -0.55, 'rear_left');
    addSeat(0.4, -0.55, 'rear_right');
    var wheelMat = mat(0x1a1a1a, { r: 0.9 });
    var wg = new THREE.CylinderGeometry(0.35, 0.35, 0.22, 12);
    [[-0.95, 0.35, 1.3], [0.95, 0.35, 1.3], [-0.95, 0.35, -1.3], [0.95, 0.35, -1.3]].forEach(function (p) {
      var w = new THREE.Mesh(wg, wheelMat); w.rotation.z = Math.PI / 2; w.position.set(p[0], p[1], p[2]); w.castShadow = true; g.add(w);
    });
    var lm = mat(0xffffaa, { e: 0xffff88, ei: 0.6 });
    var hl = box(0.28, 0.14, 0.06, lm); hl.position.set(-0.55, 0.55, 2.12); g.add(hl);
    var hr = hl.clone(); hr.position.x = 0.55; g.add(hr);
    g.userData.isVehicle = true;
    g.userData.vehicleType = 'car';
    return g;
  }
  function makeTruck(color) {
    var g = new THREE.Group(); color = color || 0xf59e0b;
    var cab = box(2.2, 1.5, 2.2, mat(color, { r: 0.4, m: 0.4 })); cab.position.set(0, 1.05, 1.9); g.add(cab);
    var bed = box(2.3, 1.1, 4.2, mat(0x555555, { r: 0.6, m: 0.3 })); bed.position.set(0, 0.9, -1.3); g.add(bed);
    var wg = new THREE.CylinderGeometry(0.42, 0.42, 0.28, 12);
    var wm = mat(0x1a1a1a, { r: 0.9 });
    [[-1.15, 0.42, 2.3], [1.15, 0.42, 2.3], [-1.15, 0.42, -0.4], [1.15, 0.42, -0.4], [-1.15, 0.42, -2.6], [1.15, 0.42, -2.6]].forEach(function (p) {
      var w = new THREE.Mesh(wg, wm); w.rotation.z = Math.PI / 2; w.position.set(p[0], p[1], p[2]); w.castShadow = true; g.add(w);
    });
    return g;
  }
  function makeBus() {
    var g = new THREE.Group();
    // Flexible coach body (slightly segmented look)
    var body = box(2.6, 2.4, 8, mat(0xfbbf24, { r: 0.4, m: 0.3 })); body.position.y = 1.4; g.add(body);
    var roof = box(2.5, 0.15, 7.8, mat(0xe5a800, { r: 0.5 })); roof.position.y = 2.65; g.add(roof);
    // Fully transparent windows all around
    var glass = mat(0x88ccee, { r: 0.1, m: 0.65, t: true, o: 0.3 });
    for (var i = 0; i < 5; i++) {
      var win = box(0.06, 0.95, 1.15, glass); win.position.set(1.32, 1.75, -3.0 + i * 1.5); g.add(win);
      var win2 = win.clone(); win2.position.x = -1.32; g.add(win2);
    }
    var frontGlass = box(2.3, 1.1, 0.06, glass); frontGlass.position.set(0, 1.8, 4.0); g.add(frontGlass);
    var rearGlass = box(2.3, 1.0, 0.06, glass); rearGlass.position.set(0, 1.75, -4.0); g.add(rearGlass);
    // Real seats inside (rows) — rideable
    var seatMat = mat(0x1e3a5f, { r: 0.8 });
    var backMat = mat(0x163050, { r: 0.75 });
    for (var row = 0; row < 6; row++) {
      var z = 2.5 - row * 1.1;
      [-0.7, 0.7].forEach(function (x) {
        var s = box(0.6, 0.12, 0.5, seatMat);
        s.position.set(x, 0.85, z);
        s.userData = { isSeat: true, seatName: 'bus_row' + row };
        g.add(s);
        var b = box(0.6, 0.5, 0.1, backMat);
        b.position.set(x, 1.1, z - 0.25);
        g.add(b);
      });
    }
    // Driver seat
    var ds = box(0.55, 0.12, 0.5, mat(0x111)); ds.position.set(-0.6, 0.9, 3.3); ds.userData = { isSeat: true, seatName: 'driver' }; g.add(ds);
    var wg = new THREE.CylinderGeometry(0.5, 0.5, 0.3, 12); var wm = mat(0x222);
    [[-1.3, 0.5, 2.8], [1.3, 0.5, 2.8], [-1.3, 0.5, -2.8], [1.3, 0.5, -2.8]].forEach(function (p) {
      var w = new THREE.Mesh(wg, wm); w.rotation.z = Math.PI / 2; w.position.set(p[0], p[1], p[2]); w.castShadow = true; g.add(w);
    });
    g.userData.isVehicle = true;
    g.userData.vehicleType = 'bus';
    g.userData.flexible = true;
    return g;
  }
  function makePoliceCar() {
    var g = makeCar(0x1e3a5f);
    var lightBar = box(1.2, 0.15, 0.4, mat(0x111)); lightBar.position.set(0, 1.4, -0.2); g.add(lightBar);
    var red = box(0.35, 0.12, 0.35, mat(0xff0000, { e: 0xff0000, ei: 0.8 })); red.position.set(-0.35, 1.42, -0.2); g.add(red);
    var blu = box(0.35, 0.12, 0.35, mat(0x0066ff, { e: 0x0066ff, ei: 0.8 })); blu.position.set(0.35, 1.42, -0.2); g.add(blu);
    return g;
  }
  function makeAmbulance() {
    var g = new THREE.Group();
    var body = box(2.2, 1.8, 5.5, mat(0xffffff, { r: 0.4, m: 0.3 })); body.position.y = 1.2; g.add(body);
    var stripe = box(2.25, 0.35, 5.55, mat(0xcc0000)); stripe.position.y = 1.2; g.add(stripe);
    var cross = box(0.15, 0.6, 0.15, mat(0xcc0000)); cross.position.set(1.15, 1.8, 0); g.add(cross);
    var cross2 = box(0.6, 0.15, 0.15, mat(0xcc0000)); cross2.position.set(1.15, 1.8, 0); g.add(cross2);
    var glass = mat(0x88ccee, { r: 0.1, m: 0.65, t: true, o: 0.3 });
    var fw = box(2.0, 0.7, 0.05, glass); fw.position.set(0, 1.7, 2.75); g.add(fw);
    var swL = box(0.05, 0.6, 1.4, glass); swL.position.set(-1.12, 1.65, 1.6); g.add(swL);
    var swR = swL.clone(); swR.position.x = 1.12; g.add(swR);
    // Seats + stretcher area
    var sm = mat(0x1a1a1a, { r: 0.85 });
    var ds = box(0.5, 0.1, 0.45, sm); ds.position.set(-0.5, 0.8, 1.9); ds.userData = { isSeat: true, seatName: 'driver' }; g.add(ds);
    var ps = box(0.5, 0.1, 0.45, sm); ps.position.set(0.5, 0.8, 1.9); ps.userData = { isSeat: true, seatName: 'passenger' }; g.add(ps);
    var bed = box(0.9, 0.15, 2.2, mat(0xeeeeee)); bed.position.set(0, 0.85, -0.8); bed.userData = { isSeat: true, seatName: 'stretcher' }; g.add(bed);
    var wg = new THREE.CylinderGeometry(0.4, 0.4, 0.28, 12); var wm = mat(0x222);
    [[-1.1, 0.4, 1.8], [1.1, 0.4, 1.8], [-1.1, 0.4, -1.8], [1.1, 0.4, -1.8]].forEach(function (p) {
      var w = new THREE.Mesh(wg, wm); w.rotation.z = Math.PI / 2; w.position.set(p[0], p[1], p[2]); w.castShadow = true; g.add(w);
    });
    g.userData.isVehicle = true;
    return g;
  }
  function makeTree() {
    var g = new THREE.Group();
    var trunk = cyl(0.18, 0.28, 1.8, 8, mat(0x5c3a1e, { r: 0.9 })); trunk.position.y = 0.9; g.add(trunk);
    var leaves = new THREE.Mesh(new THREE.SphereGeometry(1.5, 10, 10), mat(0x2d6a1e, { r: 0.85 })); leaves.position.y = 2.7; leaves.castShadow = true; g.add(leaves);
    var l2 = new THREE.Mesh(new THREE.SphereGeometry(1.0, 8, 8), mat(0x3d8a2e, { r: 0.85 })); l2.position.set(0.5, 2.3, 0.3); g.add(l2);
    return g;
  }
  function makePalm() {
    var g = new THREE.Group();
    var trunk = cyl(0.15, 0.25, 4, 8, mat(0x8B6914, { r: 0.85 })); trunk.position.y = 2; g.add(trunk);
    for (var i = 0; i < 6; i++) {
      var leaf = box(0.15, 0.08, 2.2, mat(0x228B22, { r: 0.8 }));
      leaf.position.set(Math.sin(i / 6 * Math.PI * 2) * 0.8, 4.2, Math.cos(i / 6 * Math.PI * 2) * 0.8);
      leaf.rotation.x = 0.5; leaf.rotation.y = i / 6 * Math.PI * 2; g.add(leaf);
    }
    return g;
  }
  function makeRock() {
    var g = new THREE.Group();
    var rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.9, 0), mat(0x6b6560, { r: 0.95, flat: true }));
    rock.position.y = 0.7; rock.scale.set(1.3, 0.9, 1.1); rock.castShadow = true; rock.receiveShadow = true; g.add(rock);
    return g;
  }
  function makeCrate() {
    var g = new THREE.Group();
    var b = box(1.1, 1.1, 1.1, mat(0x8B5A2B, { r: 0.8 })); b.position.y = 0.55; g.add(b);
    var s = box(1.15, 0.08, 1.15, mat(0x5c3a1e)); s.position.y = 0.55; g.add(s);
    return g;
  }
  function makeBarrel() {
    var g = new THREE.Group();
    var b = cyl(0.45, 0.45, 1.3, 12, mat(0x1e3a5f, { r: 0.5, m: 0.4 })); b.position.y = 0.65; g.add(b);
    var rim = cyl(0.48, 0.48, 0.08, 12, mat(0x333)); rim.position.y = 1.25; g.add(rim);
    return g;
  }
  function makeLamp() {
    var g = new THREE.Group();
    var pole = cyl(0.05, 0.07, 2.4, 8, mat(0x444, { m: 0.6, r: 0.4 })); pole.position.y = 1.2; g.add(pole);
    var bulb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 10), mat(0xffee88, { e: 0xffcc44, ei: 0.9 })); bulb.position.y = 2.5; g.add(bulb);
    var light = new THREE.PointLight(0xffeeaa, 0.9, 14); light.position.y = 2.5; g.add(light);
    return g;
  }
  function makeStreetLight() {
    var g = new THREE.Group();
    var pole = cyl(0.07, 0.09, 5.5, 8, mat(0x555, { m: 0.7, r: 0.3 })); pole.position.y = 2.75; g.add(pole);
    var arm = box(1.6, 0.07, 0.07, mat(0x555, { m: 0.7 })); arm.position.set(0.7, 5.4, 0); g.add(arm);
    var lamp = box(0.45, 0.18, 0.28, mat(0x333)); lamp.position.set(1.35, 5.3, 0); g.add(lamp);
    var glow = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), mat(0xffffcc, { e: 0xffee88, ei: 1 })); glow.position.set(1.35, 5.15, 0); g.add(glow);
    var pl = new THREE.PointLight(0xffeecc, 1.3, 20); pl.position.set(1.35, 5.1, 0); g.add(pl);
    return g;
  }
  function makeBench() {
    var g = new THREE.Group();
    var seat = box(1.8, 0.1, 0.5, mat(0x8B4513, { r: 0.8 })); seat.position.y = 0.45; g.add(seat);
    var back = box(1.8, 0.5, 0.08, mat(0x8B4513, { r: 0.8 })); back.position.set(0, 0.75, -0.22); g.add(back);
    var leg1 = box(0.08, 0.45, 0.08, mat(0x444)); leg1.position.set(-0.7, 0.22, 0.15); g.add(leg1);
    var leg2 = leg1.clone(); leg2.position.x = 0.7; g.add(leg2);
    var leg3 = leg1.clone(); leg3.position.set(-0.7, 0.22, -0.15); g.add(leg3);
    var leg4 = leg1.clone(); leg4.position.set(0.7, 0.22, -0.15); g.add(leg4);
    return g;
  }
  function makeTrash() {
    var g = new THREE.Group();
    var bin = cyl(0.35, 0.4, 1.0, 10, mat(0x2d5a27, { r: 0.6, m: 0.3 })); bin.position.y = 0.5; g.add(bin);
    var lid = cyl(0.38, 0.38, 0.06, 10, mat(0x1a3a18)); lid.position.y = 1.03; g.add(lid);
    return g;
  }
  function makeHydrant() {
    var g = new THREE.Group();
    var base = cyl(0.2, 0.25, 0.3, 8, mat(0xcc2222, { r: 0.5, m: 0.3 })); base.position.y = 0.15; g.add(base);
    var body = cyl(0.15, 0.15, 0.6, 8, mat(0xcc2222, { r: 0.5, m: 0.3 })); body.position.y = 0.55; g.add(body);
    var top = cyl(0.12, 0.12, 0.15, 8, mat(0xcc2222)); top.position.y = 0.9; g.add(top);
    var side = cyl(0.08, 0.08, 0.35, 6, mat(0xaa1111)); side.rotation.z = Math.PI / 2; side.position.set(0.2, 0.55, 0); g.add(side);
    return g;
  }
  function makeSign(textColor) {
    var g = new THREE.Group();
    var pole = cyl(0.04, 0.04, 2.2, 6, mat(0x888)); pole.position.y = 1.1; g.add(pole);
    var board = box(1.2, 0.8, 0.08, mat(textColor || 0x2266cc, { r: 0.5 })); board.position.y = 2.4; g.add(board);
    return g;
  }
  function makeTrafficLight() {
    var g = new THREE.Group();
    var pole = cyl(0.06, 0.06, 3.5, 8, mat(0x444, { m: 0.5 })); pole.position.y = 1.75; g.add(pole);
    var housing = box(0.35, 1.0, 0.3, mat(0x222)); housing.position.y = 3.8; g.add(housing);
    var colors = [0xff0000, 0xffff00, 0x00ff00];
    for (var i = 0; i < 3; i++) {
      var light = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), mat(colors[i], { e: colors[i], ei: 0.6 }));
      light.position.set(0, 4.15 - i * 0.3, 0.16); g.add(light);
    }
    return g;
  }
  function makeFence() {
    var g = new THREE.Group();
    for (var i = 0; i < 5; i++) {
      var post = box(0.08, 1.2, 0.08, mat(0x8B7355)); post.position.set(-1.6 + i * 0.8, 0.6, 0); g.add(post);
    }
    var rail1 = box(3.3, 0.06, 0.06, mat(0x8B7355)); rail1.position.y = 0.4; g.add(rail1);
    var rail2 = box(3.3, 0.06, 0.06, mat(0x8B7355)); rail2.position.y = 0.9; g.add(rail2);
    return g;
  }
  function makeRoadBarrier() {
    var g = new THREE.Group();
    var base = box(1.5, 0.7, 0.4, mat(0xff6600, { r: 0.5 })); base.position.y = 0.35; g.add(base);
    var stripe = box(1.52, 0.15, 0.42, mat(0xffffff)); stripe.position.y = 0.35; g.add(stripe);
    return g;
  }
  function makeMailbox() {
    var g = new THREE.Group();
    var boxM = box(0.4, 0.35, 0.25, mat(0x2244aa, { r: 0.5, m: 0.3 })); boxM.position.y = 1.1; g.add(boxM);
    var pole = cyl(0.04, 0.04, 1.0, 6, mat(0x666)); pole.position.y = 0.5; g.add(pole);
    var flag = box(0.15, 0.08, 0.02, mat(0xcc0000)); flag.position.set(0.28, 1.15, 0); g.add(flag);
    return g;
  }
  function makeSofa() {
    var g = new THREE.Group();
    var seat = box(2.2, 0.4, 0.9, mat(0x4a5568, { r: 0.8 })); seat.position.y = 0.4; g.add(seat);
    var back = box(2.2, 0.7, 0.25, mat(0x4a5568, { r: 0.8 })); back.position.set(0, 0.85, -0.35); g.add(back);
    var armL = box(0.25, 0.5, 0.9, mat(0x3d4555)); armL.position.set(-1.1, 0.55, 0); g.add(armL);
    var armR = armL.clone(); armR.position.x = 1.1; g.add(armR);
    return g;
  }
  function makeTable() {
    var g = new THREE.Group();
    var top = box(1.6, 0.08, 1.0, mat(0x8B5A2B, { r: 0.6 })); top.position.y = 0.75; g.add(top);
    [[-0.65, 0.37, -0.35], [0.65, 0.37, -0.35], [-0.65, 0.37, 0.35], [0.65, 0.37, 0.35]].forEach(function (p) {
      var leg = box(0.08, 0.75, 0.08, mat(0x5c3a1e)); leg.position.set(p[0], p[1], p[2]); g.add(leg);
    });
    return g;
  }
  function makeBed() {
    var g = new THREE.Group();
    var frame = box(2.0, 0.35, 1.5, mat(0x5c3a1e, { r: 0.7 })); frame.position.y = 0.3; g.add(frame);
    var mattress = box(1.9, 0.2, 1.4, mat(0xe8e0d0, { r: 0.9 })); mattress.position.y = 0.55; g.add(mattress);
    var pillow = box(0.6, 0.15, 0.4, mat(0xffffff, { r: 0.9 })); pillow.position.set(0, 0.7, -0.45); g.add(pillow);
    var headboard = box(2.0, 0.8, 0.1, mat(0x5c3a1e)); headboard.position.set(0, 0.7, -0.75); g.add(headboard);
    return g;
  }
  function makeFridge() {
    var g = new THREE.Group();
    var body = box(0.9, 2.0, 0.8, mat(0xe8e8e8, { r: 0.3, m: 0.5 })); body.position.y = 1.0; g.add(body);
    var handle = box(0.05, 0.5, 0.05, mat(0x888, { m: 0.8 })); handle.position.set(0.5, 1.2, 0.42); g.add(handle);
    var line = box(0.92, 0.03, 0.82, mat(0xcccccc)); line.position.y = 1.2; g.add(line);
    return g;
  }
  function makeTV() {
    var g = new THREE.Group();
    var screen = box(1.6, 0.95, 0.08, mat(0x111, { r: 0.2, m: 0.5 })); screen.position.y = 1.0; g.add(screen);
    var stand = box(0.5, 0.15, 0.4, mat(0x333)); stand.position.y = 0.45; g.add(stand);
    var base = box(0.8, 0.05, 0.5, mat(0x222)); base.position.y = 0.35; g.add(base);
    return g;
  }
  function makeSimpleBlock(size, color) {
    var g = new THREE.Group();
    var m = box(size[0], size[1], size[2], mat(color, { r: 0.7 })); m.position.y = size[1] / 2; g.add(m);
    return g;
  }
  function makeCone() {
    var g = new THREE.Group();
    var cone = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.7, 8), mat(0xff6600, { r: 0.5 })); cone.position.y = 0.35; cone.castShadow = true; g.add(cone);
    var base = cyl(0.28, 0.28, 0.06, 8, mat(0x333)); base.position.y = 0.03; g.add(base);
    return g;
  }
  function makeDumpster() {
    var g = new THREE.Group();
    var body = box(2.2, 1.4, 1.2, mat(0x2d5a27, { r: 0.6, m: 0.2 })); body.position.y = 0.7; g.add(body);
    var lid = box(2.25, 0.1, 1.25, mat(0x1a3a18)); lid.position.y = 1.45; g.add(lid);
    return g;
  }
  function makeFountain() {
    var g = new THREE.Group();
    var base = cyl(1.5, 1.8, 0.4, 16, mat(0x888888, { r: 0.5, m: 0.3 })); base.position.y = 0.2; g.add(base);
    var mid = cyl(0.8, 1.0, 0.5, 12, mat(0x999, { r: 0.5 })); mid.position.y = 0.65; g.add(mid);
    var water = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.15, 16), mat(0x4488cc, { r: 0.2, m: 0.5, t: true, o: 0.7, e: 0x2266aa, ei: 0.2 }));
    water.position.y = 0.95; g.add(water);
    var spout = cyl(0.08, 0.08, 0.8, 6, mat(0xaaa, { m: 0.6 })); spout.position.y = 1.3; g.add(spout);
    return g;
  }


  function makeBike() {
    var g = new THREE.Group();
    var frame = box(0.08, 0.08, 1.4, mat(0x333)); frame.position.set(0, 0.55, 0); g.add(frame);
    var wheelGeo = new THREE.TorusGeometry(0.35, 0.05, 8, 16);
    var wm = mat(0x222, { r: 0.8, m: 0.3 });
    var w1 = new THREE.Mesh(wheelGeo, wm); w1.position.set(0, 0.35, 0.55); w1.castShadow = true; g.add(w1);
    var w2 = w1.clone(); w2.position.z = -0.55; g.add(w2);
    var seat = box(0.25, 0.08, 0.35, mat(0x1a1a1a)); seat.position.set(0, 0.75, -0.15); g.add(seat);
    var handle = box(0.6, 0.05, 0.05, mat(0x444)); handle.position.set(0, 0.85, 0.4); g.add(handle);
    return g;
  }
  function makeMotorcycle() {
    var g = new THREE.Group();
    var body = box(0.4, 0.45, 1.6, mat(0xcc0000, { r: 0.3, m: 0.5 })); body.position.y = 0.55; g.add(body);
    var tank = box(0.35, 0.3, 0.5, mat(0xaa0000, { r: 0.3, m: 0.5 })); tank.position.set(0, 0.85, 0.1); g.add(tank);
    var wg = new THREE.CylinderGeometry(0.32, 0.32, 0.15, 12); var wm = mat(0x1a1a1a, { r: 0.9 });
    var w1 = new THREE.Mesh(wg, wm); w1.rotation.z = Math.PI/2; w1.position.set(0, 0.32, 0.7); w1.castShadow = true; g.add(w1);
    var w2 = w1.clone(); w2.position.z = -0.7; g.add(w2);
    var seat = box(0.35, 0.1, 0.5, mat(0x222)); seat.position.set(0, 0.85, -0.35); g.add(seat);
    return g;
  }
  function makeVan() {
    var g = new THREE.Group();
    var body = box(2.2, 2.0, 5.5, mat(0xffffff, { r: 0.4, m: 0.3 })); body.position.y = 1.2; g.add(body);
    var cab = box(2.15, 0.9, 1.5, mat(0xeeeeee, { r: 0.3, m: 0.4 })); cab.position.set(0, 1.7, 1.8); g.add(cab);
    var glass = mat(0x88ccee, { r: 0.1, m: 0.65, t: true, o: 0.3 });
    var fw = box(2.0, 0.7, 0.05, glass); fw.position.set(0, 1.7, 2.55); g.add(fw);
    var swL = box(0.05, 0.65, 1.3, glass); swL.position.set(-1.1, 1.65, 1.8); g.add(swL);
    var swR = swL.clone(); swR.position.x = 1.1; g.add(swR);
    // Seats
    var sm = mat(0x222, { r: 0.85 });
    var ds = box(0.55, 0.12, 0.5, sm); ds.position.set(-0.5, 0.85, 1.9); ds.userData = { isSeat: true, seatName: 'driver' }; g.add(ds);
    var ps = box(0.55, 0.12, 0.5, sm); ps.position.set(0.5, 0.85, 1.9); ps.userData = { isSeat: true, seatName: 'passenger' }; g.add(ps);
    var wg = new THREE.CylinderGeometry(0.4, 0.4, 0.28, 12); var wm = mat(0x222);
    [[-1.1,0.4,1.8],[1.1,0.4,1.8],[-1.1,0.4,-1.8],[1.1,0.4,-1.8]].forEach(function(p){
      var w = new THREE.Mesh(wg, wm); w.rotation.z = Math.PI/2; w.position.set(p[0],p[1],p[2]); w.castShadow = true; g.add(w);
    });
    g.userData.isVehicle = true;
    return g;
  }
  function makeTaxi() {
    var g = makeCar(0xfbbf24);
    var sign = box(0.5, 0.2, 0.3, mat(0x111)); sign.position.set(0, 1.4, -0.2); g.add(sign);
    var t = box(0.4, 0.12, 0.25, mat(0xfbbf24, { e: 0xfbbf24, ei: 0.3 })); t.position.set(0, 1.42, -0.2); g.add(t);
    return g;
  }
  function makeFireTruck() {
    var g = new THREE.Group();
    var body = box(2.4, 1.6, 7, mat(0xcc0000, { r: 0.4, m: 0.3 })); body.position.y = 1.1; g.add(body);
    var cab = box(2.3, 1.2, 2.2, mat(0xaa0000, { r: 0.4, m: 0.3 })); cab.position.set(0, 1.8, 2.2); g.add(cab);
    var glass = mat(0x88ccee, { r: 0.1, m: 0.65, t: true, o: 0.3 });
    var fw = box(2.1, 0.75, 0.05, glass); fw.position.set(0, 1.95, 3.3); g.add(fw);
    var swL = box(0.05, 0.7, 1.5, glass); swL.position.set(-1.17, 1.9, 2.2); g.add(swL);
    var swR = swL.clone(); swR.position.x = 1.17; g.add(swR);
    var ladder = box(0.3, 0.15, 5, mat(0x888, { m: 0.6 })); ladder.position.set(0, 2.1, -0.5); g.add(ladder);
    var sm = mat(0x1a1a1a, { r: 0.85 });
    var ds = box(0.55, 0.12, 0.5, sm); ds.position.set(-0.55, 0.95, 2.4); ds.userData = { isSeat: true, seatName: 'driver' }; g.add(ds);
    var ps = box(0.55, 0.12, 0.5, sm); ps.position.set(0.55, 0.95, 2.4); ps.userData = { isSeat: true, seatName: 'passenger' }; g.add(ps);
    var wg = new THREE.CylinderGeometry(0.45, 0.45, 0.3, 12); var wm = mat(0x222);
    [[-1.2,0.45,2.5],[1.2,0.45,2.5],[-1.2,0.45,0],[1.2,0.45,0],[-1.2,0.45,-2.5],[1.2,0.45,-2.5]].forEach(function(p){
      var w = new THREE.Mesh(wg, wm); w.rotation.z = Math.PI/2; w.position.set(p[0],p[1],p[2]); w.castShadow = true; g.add(w);
    });
    g.userData.isVehicle = true;
    return g;
  }
  function makeSlide() {
    var g = new THREE.Group();
    var slide = box(1.2, 0.1, 3.5, mat(0x3b82f6, { r: 0.4 })); slide.rotation.x = -0.5; slide.position.set(0, 1.2, 0); g.add(slide);
    var pole1 = cyl(0.06, 0.06, 2.5, 6, mat(0x888)); pole1.position.set(-0.5, 1.25, -1.5); g.add(pole1);
    var pole2 = pole1.clone(); pole2.position.x = 0.5; g.add(pole2);
    var top = box(1.4, 0.1, 1.0, mat(0x3b82f6)); top.position.set(0, 2.4, -1.5); g.add(top);
    return g;
  }
  function makeSwing() {
    var g = new THREE.Group();
    var poleL = cyl(0.06, 0.06, 2.8, 6, mat(0x666)); poleL.position.set(-1, 1.4, 0); g.add(poleL);
    var poleR = poleL.clone(); poleR.position.x = 1; g.add(poleR);
    var top = box(2.2, 0.08, 0.08, mat(0x666)); top.position.y = 2.8; g.add(top);
    var seat = box(0.5, 0.06, 0.25, mat(0x8B4513)); seat.position.y = 0.9; g.add(seat);
    var rope1 = cyl(0.02, 0.02, 1.9, 4, mat(0x444)); rope1.position.set(-0.2, 1.85, 0); g.add(rope1);
    var rope2 = rope1.clone(); rope2.position.x = 0.2; g.add(rope2);
    return g;
  }
  function makePlantPot() {
    var g = new THREE.Group();
    var pot = cyl(0.35, 0.25, 0.5, 10, mat(0xb45309, { r: 0.7 })); pot.position.y = 0.25; g.add(pot);
    var plant = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), mat(0x228B22, { r: 0.85 })); plant.position.y = 0.7; g.add(plant);
    return g;
  }
  function makeBookshelf() {
    var g = new THREE.Group();
    var frame = box(1.4, 2.2, 0.4, mat(0x5c3a1e, { r: 0.7 })); frame.position.y = 1.1; g.add(frame);
    for (var i = 0; i < 4; i++) {
      var shelf = box(1.35, 0.05, 0.38, mat(0x8B5A2B)); shelf.position.y = 0.4 + i * 0.5; g.add(shelf);
    }
    return g;
  }
  function makeChair() {
    var g = new THREE.Group();
    var seat = box(0.55, 0.08, 0.55, mat(0x4a5568, { r: 0.7 })); seat.position.y = 0.5; g.add(seat);
    var back = box(0.55, 0.55, 0.08, mat(0x4a5568, { r: 0.7 })); back.position.set(0, 0.85, -0.24); g.add(back);
    [[-0.22,0.25,-0.22],[0.22,0.25,-0.22],[-0.22,0.25,0.22],[0.22,0.25,0.22]].forEach(function(p){
      var leg = box(0.06, 0.5, 0.06, mat(0x333)); leg.position.set(p[0],p[1],p[2]); g.add(leg);
    });
    return g;
  }
  function makeCrosswalk() {
    var g = new THREE.Group();
    for (var i = 0; i < 6; i++) {
      var stripe = box(0.4, 0.02, 2.5, mat(0xffffff, { r: 0.5 })); stripe.position.set(-1.5 + i * 0.6, 0.02, 0); g.add(stripe);
    }
    return g;
  }
  function makeBillboard() {
    var g = new THREE.Group();
    var pole = cyl(0.08, 0.08, 4, 8, mat(0x555, { m: 0.5 })); pole.position.y = 2; g.add(pole);
    var board = box(3, 1.8, 0.15, mat(0x2266aa, { r: 0.5 })); board.position.y = 4.5; g.add(board);
    var frame = box(3.1, 1.9, 0.1, mat(0x333)); frame.position.y = 4.5; g.add(frame);
    return g;
  }


  function makeDesk() {
    var g = new THREE.Group();
    var top = box(1.4, 0.06, 0.7, mat(0xdeb887, { r: 0.6 })); top.position.y = 0.75; g.add(top);
    [[-0.6,0.37,-0.25],[0.6,0.37,-0.25],[-0.6,0.37,0.25],[0.6,0.37,0.25]].forEach(function(p){
      var leg = box(0.06, 0.75, 0.06, mat(0x5c3a1e)); leg.position.set(p[0],p[1],p[2]); g.add(leg);
    });
    return g;
  }
  function makeBlackboard() {
    var g = new THREE.Group();
    var board = box(3, 1.6, 0.08, mat(0x1a3a1a, { r: 0.7 })); board.position.y = 1.5; g.add(board);
    var frame = box(3.15, 1.75, 0.06, mat(0x5c3a1e)); frame.position.y = 1.5; g.add(frame);
    return g;
  }
  function makeLocker() {
    var g = new THREE.Group();
    var body = box(0.8, 2.2, 0.5, mat(0x4a5568, { r: 0.4, m: 0.4 })); body.position.y = 1.1; g.add(body);
    var handle = box(0.05, 0.15, 0.05, mat(0x888, { m: 0.8 })); handle.position.set(0.35, 1.1, 0.28); g.add(handle);
    return g;
  }
  function makeHospitalBed() {
    var g = new THREE.Group();
    var frame = box(2.2, 0.4, 1.0, mat(0xcccccc, { r: 0.3, m: 0.5 })); frame.position.y = 0.6; g.add(frame);
    var mat2 = box(2.0, 0.2, 0.9, mat(0xffffff, { r: 0.9 })); mat2.position.y = 0.9; g.add(mat2);
    var head = box(0.1, 0.8, 1.0, mat(0xaaaaaa, { m: 0.4 })); head.position.set(-1.05, 1.0, 0); g.add(head);
    return g;
  }
  function makeCounter() {
    var g = new THREE.Group();
    var body = box(2.5, 1.0, 0.7, mat(0x8B5A2B, { r: 0.7 })); body.position.y = 0.5; g.add(body);
    var top = box(2.6, 0.08, 0.8, mat(0xdeb887, { r: 0.5 })); top.position.y = 1.04; g.add(top);
    return g;
  }
  function makeShelf() {
    var g = new THREE.Group();
    for (var i = 0; i < 4; i++) {
      var s = box(1.5, 0.05, 0.4, mat(0x8B5A2B)); s.position.y = 0.4 + i * 0.45; g.add(s);
    }
    var side1 = box(0.05, 1.8, 0.4, mat(0x5c3a1e)); side1.position.set(-0.75, 0.9, 0); g.add(side1);
    var side2 = side1.clone(); side2.position.x = 0.75; g.add(side2);
    return g;
  }
  function makeToilet() {
    var g = new THREE.Group();
    var base = box(0.5, 0.4, 0.6, mat(0xffffff, { r: 0.3, m: 0.2 })); base.position.y = 0.2; g.add(base);
    var bowl = cyl(0.22, 0.28, 0.35, 12, mat(0xffffff, { r: 0.3 })); bowl.position.y = 0.5; g.add(bowl);
    var tank = box(0.45, 0.5, 0.2, mat(0xf0f0f0, { r: 0.3 })); tank.position.set(0, 0.85, -0.25); g.add(tank);
    return g;
  }
  function makeSink() {
    var g = new THREE.Group();
    var basin = box(0.6, 0.15, 0.45, mat(0xffffff, { r: 0.3, m: 0.3 })); basin.position.y = 0.85; g.add(basin);
    var pedestal = cyl(0.12, 0.18, 0.8, 8, mat(0xf5f5f5)); pedestal.position.y = 0.4; g.add(pedestal);
    var faucet = cyl(0.03, 0.03, 0.25, 6, mat(0x888, { m: 0.8 })); faucet.position.set(0, 1.1, -0.1); g.add(faucet);
    return g;
  }

  // ===== CATALOG (extensive) =====
  const buildCatalog = {
    buildings: [
      { id: 'house_s', name: 'منزل صغير', icon: '🏠', factory: function () { return makeHouse(4, 3, 4, 0xd4a574, 0x8b4513); } },
      { id: 'house_m', name: 'منزل متوسط', icon: '🏡', factory: function () { return makeHouse(5.5, 3.5, 5, 0xe8d5b7, 0x654321); } },
      { id: 'house_l', name: 'منزل كبير', icon: '🏘️', factory: function () { return makeHouse(7, 4.5, 6, 0xf5e6d3, 0x4a3728); } },
      { id: 'shop', name: 'محل', icon: '🏪', factory: function () { return makeShop(5, 3.2, 4); } },
      { id: 'tower', name: 'برج', icon: '🏢', factory: function () { return makeTower(3.5, 12, 3.5, 0x6b7280); } },
      { id: 'tower2', name: 'برج زجاجي', icon: '🏬', factory: function () { return makeTower(4, 14, 4, 0x88aacc); } }
    ],
    blocks: [
      { id: 'cube', name: 'مكعب', icon: '🟦', factory: function () { return makeSimpleBlock([1.2, 1.2, 1.2], 0x3b82f6); } },
      { id: 'wall', name: 'حائط', icon: '🧱', factory: function () { return makeSimpleBlock([5, 2.5, 0.4], 0x78716c); } },
      { id: 'platform', name: 'منصة', icon: '⬜', factory: function () { return makeSimpleBlock([6, 0.3, 6], 0xa8a29e); } },
      { id: 'ramp', name: 'منحدر', icon: '📐', factory: function () {
        var g = new THREE.Group();
        var m = box(3, 0.3, 4, mat(0x78716c)); m.rotation.x = -0.35; m.position.set(0, 0.8, 0); g.add(m); return g;
      } },
      { id: 'stairs', name: 'سلالم', icon: '🪜', factory: function () {
        var g = new THREE.Group();
        for (var i = 0; i < 6; i++) { var s = box(2, 0.25, 0.5, mat(0x888)); s.position.set(0, 0.12 + i * 0.25, -i * 0.45); g.add(s); }
        return g;
      } }
    ],
    vehicles: [
      { id: 'car_red', name: 'سيارة حمراء', icon: '🚗', factory: function () { return makeCar(0xdc2626); } },
      { id: 'car_blue', name: 'سيارة زرقاء', icon: '🚙', factory: function () { return makeCar(0x2563eb); } },
      { id: 'car_black', name: 'سيارة سوداء', icon: '🏎️', factory: function () { return makeCar(0x1a1a1a); } },
      { id: 'car_white', name: 'سيارة بيضاء', icon: '🚘', factory: function () { return makeCar(0xf5f5f5); } },
      { id: 'car_green', name: 'سيارة خضراء', icon: '🍃', factory: function () { return makeCar(0x16a34a); } },
      { id: 'car_orange', name: 'سيارة برتقالية', icon: '🧡', factory: function () { return makeCar(0xea580c); } },
      { id: 'car_purple', name: 'سيارة بنفسجية', icon: '💜', factory: function () { return makeCar(0x7c3aed); } },
      { id: 'truck', name: 'شاحنة', icon: '🚚', factory: function () { return makeTruck(0xf59e0b); } },
      { id: 'truck_blue', name: 'شاحنة زرقاء', icon: '🚛', factory: function () { return makeTruck(0x3b82f6); } },
      { id: 'bus', name: 'أتوبيس', icon: '🚌', factory: function () { return makeBus(); } },
      { id: 'police', name: 'شرطة', icon: '🚓', factory: function () { return makePoliceCar(); } },
      { id: 'ambulance', name: 'إسعاف', icon: '🚑', factory: function () { return makeAmbulance(); } },
      { id: 'taxi', name: 'تاكسي', icon: '🚕', factory: function () { return makeTaxi(); } },
      { id: 'van', name: 'فان', icon: '🚐', factory: function () { return makeVan(); } },
      { id: 'firetruck', name: 'إطفاء', icon: '🚒', factory: function () { return makeFireTruck(); } },
      { id: 'bike', name: 'دراجة', icon: '🚲', factory: function () { return makeBike(); } },
      { id: 'motorcycle', name: 'موتوسيكل', icon: '🏍️', factory: function () { return makeMotorcycle(); } }
    ],
    street: [
      { id: 'streetlight', name: 'عمود إنارة', icon: '🏮', factory: function () { return makeStreetLight(); } },
      { id: 'bench', name: 'بنش', icon: '🪑', factory: function () { return makeBench(); } },
      { id: 'trash', name: 'سلة مهملات', icon: '🗑️', factory: function () { return makeTrash(); } },
      { id: 'hydrant', name: 'صنبور حريق', icon: '🚒', factory: function () { return makeHydrant(); } },
      { id: 'sign', name: 'لافتة', icon: '🪧', factory: function () { return makeSign(0x2266cc); } },
      { id: 'sign_stop', name: 'قف', icon: '🛑', factory: function () { return makeSign(0xcc2222); } },
      { id: 'traffic', name: 'إشارة مرور', icon: '🚦', factory: function () { return makeTrafficLight(); } },
      { id: 'fence', name: 'سياج', icon: '🚧', factory: function () { return makeFence(); } },
      { id: 'barrier', name: 'حاجز طريق', icon: ' Hor', factory: function () { return makeRoadBarrier(); } },
      { id: 'cone', name: 'مخروط', icon: '🚧', factory: function () { return makeCone(); } },
      { id: 'dumpster', name: 'حاوية كبيرة', icon: '🗑️', factory: function () { return makeDumpster(); } },
      { id: 'mailbox', name: 'صندوق بريد', icon: '📫', factory: function () { return makeMailbox(); } },
      { id: 'fountain', name: 'نافورة', icon: '⛲', factory: function () { return makeFountain(); } },
      { id: 'crosswalk', name: 'ممر مشاة', icon: '🚶', factory: function () { return makeCrosswalk(); } },
      { id: 'billboard', name: 'لوحة إعلانات', icon: '📰', factory: function () { return makeBillboard(); } },
      { id: 'slide', name: 'زحليقة', icon: '🛝', factory: function () { return makeSlide(); } },
      { id: 'swing', name: 'أرجوحة', icon: '🎢', factory: function () { return makeSwing(); } }
    ],
    home: [
      { id: 'sofa', name: 'كنبة', icon: '🛋️', factory: function () { return makeSofa(); } },
      { id: 'table', name: 'طاولة', icon: '🪵', factory: function () { return makeTable(); } },
      { id: 'bed', name: 'سرير', icon: '🛏️', factory: function () { return makeBed(); } },
      { id: 'fridge', name: 'ثلاجة', icon: '🧊', factory: function () { return makeFridge(); } },
      { id: 'tv', name: 'تلفزيون', icon: '📺', factory: function () { return makeTV(); } },
      { id: 'crate', name: 'صندوق', icon: '📦', factory: function () { return makeCrate(); } },
      { id: 'barrel', name: 'برميل', icon: '🛢️', factory: function () { return makeBarrel(); } },
      { id: 'chair', name: 'كرسي', icon: '🪑', factory: function () { return makeChair(); } },
      { id: 'bookshelf', name: 'مكتبة', icon: '📚', factory: function () { return makeBookshelf(); } },
      { id: 'plantpot', name: 'نبتة', icon: '🪴', factory: function () { return makePlantPot(); } },
      { id: 'desk', name: 'مكتب', icon: '🖥️', factory: function () { return makeDesk(); } },
      { id: 'blackboard', name: 'سبورة', icon: '黒板', factory: function () { return makeBlackboard(); } },
      { id: 'locker', name: 'خزانة', icon: '🗄️', factory: function () { return makeLocker(); } },
      { id: 'hospitalbed', name: 'سرير مستشفى', icon: '🏥', factory: function () { return makeHospitalBed(); } },
      { id: 'counter', name: 'كاونتر', icon: '🏪', factory: function () { return makeCounter(); } },
      { id: 'shelf', name: 'رف', icon: '🪜', factory: function () { return makeShelf(); } },
      { id: 'toilet', name: 'مرحاض', icon: '🚽', factory: function () { return makeToilet(); } },
      { id: 'sink', name: 'حوض', icon: '🚰', factory: function () { return makeSink(); } }
    ],
    props: [
      { id: 'tree', name: 'شجرة', icon: '🌳', factory: function () { return makeTree(); } },
      { id: 'palm', name: 'نخلة', icon: '🌴', factory: function () { return makePalm(); } },
      { id: 'rock', name: 'صخرة', icon: '🪨', factory: function () { return makeRock(); } }
    ],
    characters: [
      { id: 'npc_civilian', name: 'مدني', icon: '🧑', factory: function () { return makeNPC({ shirt: '#2563eb', pants: '#1e293b', hat: 0, job: 'civilian' }); } },
      { id: 'npc_police', name: 'شرطي', icon: '👮', factory: function () { return makeNPC({ shirt: '#1e3a5f', pants: '#0f172a', hat: 1, colorHat: '#1e3a5f', job: 'police' }); } },
      { id: 'npc_doctor', name: 'دكتور', icon: '👨‍⚕️', factory: function () { return makeNPC({ shirt: '#f8fafc', pants: '#334155', hat: 0, job: 'doctor' }); } },
      { id: 'npc_nurse', name: 'ممرضة', icon: '👩‍⚕️', factory: function () { return makeNPC({ shirt: '#fda4af', pants: '#fce7f3', hat: 0, job: 'nurse', head: 0xf5c6a0 }); } },
      { id: 'npc_chef', name: 'شيف', icon: '👨‍🍳', factory: function () { return makeNPC({ shirt: '#ffffff', pants: '#1a1a1a', hat: 3, colorHat: '#ffffff', job: 'chef' }); } },
      { id: 'npc_worker', name: 'عامل', icon: '👷', factory: function () { return makeNPC({ shirt: '#f59e0b', pants: '#44403c', hat: 1, colorHat: '#fbbf24', job: 'worker' }); } },
      { id: 'npc_firefighter', name: 'إطفائي', icon: '🧑‍🚒', factory: function () { return makeNPC({ shirt: '#b91c1c', pants: '#1c1917', hat: 1, colorHat: '#dc2626', job: 'firefighter' }); } },
      { id: 'npc_soldier', name: 'جندي', icon: '💂', factory: function () { return makeNPC({ shirt: '#3f6212', pants: '#365314', hat: 1, colorHat: '#365314', job: 'soldier' }); } },
      { id: 'npc_pilot', name: 'طيار', icon: '👨‍✈️', factory: function () { return makeNPC({ shirt: '#1e40af', pants: '#0f172a', hat: 1, colorHat: '#1e3a8a', glasses: 1, job: 'pilot' }); } },
      { id: 'npc_teacher', name: 'مدرس', icon: '👨‍🏫', factory: function () { return makeNPC({ shirt: '#7c3aed', pants: '#312e81', glasses: 1, job: 'teacher' }); } },
      { id: 'npc_student', name: 'طالب', icon: '🧑‍🎓', factory: function () { return makeNPC({ shirt: '#0ea5e9', pants: '#1e3a5f', hat: 0, job: 'student' }); } },
      { id: 'npc_thief', name: 'لص', icon: '🥷', factory: function () { return makeNPC({ shirt: '#111827', pants: '#030712', hat: 3, colorHat: '#111827', job: 'thief' }); } },
      { id: 'npc_oldman', name: 'رجل عجوز', icon: '👴', factory: function () { return makeNPC({ shirt: '#78716c', pants: '#44403c', hat: 3, colorHat: '#57534e', head: 0xd4a574, job: 'elder' }); } },
      { id: 'npc_oldwoman', name: 'سيدة عجوز', icon: '👵', factory: function () { return makeNPC({ shirt: '#a78bfa', pants: '#4c1d95', hat: 0, head: 0xe0ac69, job: 'elder_f' }); } },
      { id: 'npc_kid_boy', name: 'ولد', icon: '👦', factory: function () { return makeNPC({ shirt: '#22c55e', pants: '#1e40af', hat: 0, scale: 0.7, job: 'kid' }); } },
      { id: 'npc_kid_girl', name: 'بنت', icon: '👧', factory: function () { return makeNPC({ shirt: '#ec4899', pants: '#be185d', hat: 0, head: 0xf5c6a0, scale: 0.7, job: 'kid_f' }); } },
      { id: 'npc_business', name: 'رجل أعمال', icon: '👔', factory: function () { return makeNPC({ shirt: '#1e293b', pants: '#0f172a', glasses: 1, job: 'business' }); } },
      { id: 'npc_mechanic', name: 'ميكانيكي', icon: '🔧', factory: function () { return makeNPC({ shirt: '#0ea5e9', pants: '#334155', hat: 1, colorHat: '#64748b', job: 'mechanic' }); } },
      { id: 'npc_farmer', name: 'فلاح', icon: '👨‍🌾', factory: function () { return makeNPC({ shirt: '#ca8a04', pants: '#365314', hat: 1, colorHat: '#a16207', job: 'farmer' }); } },
      { id: 'npc_scientist', name: 'عالم', icon: '👨‍🔬', factory: function () { return makeNPC({ shirt: '#e2e8f0', pants: '#334155', glasses: 1, job: 'scientist' }); } },
      { id: 'npc_athlete', name: 'رياضي', icon: '🏃', factory: function () { return makeNPC({ shirt: '#ef4444', pants: '#1e293b', hat: 0, job: 'athlete' }); } },
      { id: 'npc_guard', name: 'حارس', icon: '🛡️', factory: function () { return makeNPC({ shirt: '#374151', pants: '#111827', hat: 1, colorHat: '#1f2937', job: 'guard' }); } },
      { id: 'npc_clown', name: 'مهرج', icon: '🤡', factory: function () { return makeNPC({ shirt: '#f97316', pants: '#7c3aed', hat: 6, colorHat: '#fbbf24', job: 'clown' }); } },
      { id: 'npc_robot', name: 'روبوت', icon: '🤖', factory: function () { return makeNPC({ shirt: '#94a3b8', pants: '#475569', hat: 0, head: 0xcbd5e1, job: 'robot' }); } }
    ],
    lights: [
      { id: 'lamp', name: 'مصباح', icon: '💡', factory: function () { return makeLamp(); } },
      { id: 'streetlight2', name: 'عمود إنارة', icon: '🏮', factory: function () { return makeStreetLight(); } }
    ]
  };

  function findCatalogItem(id) {
    var cats = Object.keys(buildCatalog);
    for (var c = 0; c < cats.length; c++) {
      for (var i = 0; i < buildCatalog[cats[c]].length; i++) {
        if (buildCatalog[cats[c]][i].id === id) return buildCatalog[cats[c]][i];
      }
    }
    return null;
  }

  // ===== CHARACTER =====
  function hexToNum(hex) {
    if (!hex) return 0x333333;
    return parseInt(String(hex).replace('#', ''), 16);
  }

  function makeNPC(opts) {
    opts = opts || {};
    var custom = {
      hat: opts.hat || 0,
      glasses: opts.glasses || 0,
      shirt: 1,
      pants: 1,
      shoes: 1,
      colorHat: opts.colorHat || '#333333',
      colorGlasses: opts.colorGlasses || '#111111',
      colorShirt: opts.shirt || '#1e40af',
      colorPants: opts.pants || '#1a252f',
      colorShoes: opts.shoes || '#111111'
    };
    var headColor = opts.head != null ? opts.head : 0xe0ac69;
    var mesh = createCharacterMesh(hexToNum(custom.colorShirt), headColor, custom);
    if (opts.scale && opts.scale !== 1) mesh.scale.setScalar(opts.scale);
    mesh.userData.isCharacter = true;
    mesh.userData.job = opts.job || 'civilian';
    mesh.userData.animatable = true;
    mesh.userData.editable = true;
    return mesh;
  }

  function createCharacterMesh(colorBody, colorHead, custom) {
    custom = custom || { hat: 0, glasses: 0, shirt: 0, pants: 0, shoes: 0, colorHat: '#333333', colorGlasses: '#111111', colorShirt: '#1e40af', colorPants: '#1a252f', colorShoes: '#111111' };
    var shirtC = hexToNum(custom.colorShirt) || colorBody;
    var pantsC = hexToNum(custom.colorPants) || 0x1a252f;
    var shoesC = hexToNum(custom.colorShoes) || 0x111111;
    var hatC = hexToNum(custom.colorHat) || 0x333333;
    var glassC = hexToNum(custom.colorGlasses) || 0x111111;

    var group = new THREE.Group();
    // Body / shirt
    var body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.0, 6, 12), mat(shirtC, { r: 0.7 }));
    body.position.y = 1.0; body.castShadow = true; group.add(body);
    // Head
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 12), mat(colorHead, { r: 0.8 }));
    head.position.y = 1.85; head.castShadow = true; group.add(head);
    // Eyes
    var eyeMat = new THREE.MeshBasicMaterial({ color: 0x111 });
    var le = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), eyeMat); le.position.set(-0.1, 1.9, 0.22);
    var re = le.clone(); re.position.x = 0.1; group.add(le, re);
    // Arms
    var armMat = mat(shirtC);
    var leftArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.5, 4, 6), armMat);
    leftArm.position.set(-0.48, 1.15, 0); leftArm.castShadow = true;
    var rightArm = leftArm.clone(); rightArm.position.x = 0.48; group.add(leftArm, rightArm);
    // Pants / legs
    var legMat = mat(pantsC);
    var leftLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.55, 4, 6), legMat);
    leftLeg.position.set(-0.2, 0.4, 0); leftLeg.castShadow = true;
    var rightLeg = leftLeg.clone(); rightLeg.position.x = 0.2; group.add(leftLeg, rightLeg);
    // Shoes
    if (custom.shoes > 0) {
      var shoeMat = mat(shoesC, { r: 0.6, m: 0.2 });
      var ls = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.28), shoeMat);
      ls.position.set(-0.2, 0.06, 0.05); ls.castShadow = true; group.add(ls);
      var rs = ls.clone(); rs.position.x = 0.2; group.add(rs);
    }
    // Hat
    if (custom.hat > 0) {
      var hatMat = mat(hatC, { r: 0.6 });
      if (custom.hat === 1 || custom.hat === 2) {
        // baseball / cap
        var cap = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), hatMat);
        cap.position.y = 2.05; group.add(cap);
        var brim = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.04, 0.25), hatMat);
        brim.position.set(0, 2.02, 0.22); group.add(brim);
      } else if (custom.hat === 6) {
        // crown
        var crown = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.2, 6), mat(0xffd700, { m: 0.6, r: 0.3 }));
        crown.position.y = 2.15; group.add(crown);
      } else {
        // generic hat / beanie
        var beanie = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 8, 0, Math.PI * 2, 0, Math.PI / 1.8), hatMat);
        beanie.position.y = 2.08; group.add(beanie);
      }
    }
    // Glasses
    if (custom.glasses > 0) {
      var gMat = mat(glassC, { r: 0.3, m: 0.5 });
      var frame = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.08, 0.04), gMat);
      frame.position.set(0, 1.92, 0.26); group.add(frame);
      var lensL = new THREE.Mesh(new THREE.CircleGeometry(0.08, 8), mat(0x88ccee, { r: 0.2, m: 0.6, t: true, o: 0.5 }));
      lensL.position.set(-0.12, 1.92, 0.28); group.add(lensL);
      var lensR = lensL.clone(); lensR.position.x = 0.12; group.add(lensR);
    }

    group.userData = { walkCycle: 0, leftArm: leftArm, rightArm: rightArm, leftLeg: leftLeg, rightLeg: rightLeg };
    return group;
  }

  // ===== NAME TAGS (above heads) =====
  function createNameTagSprite(displayName) {
    var text = (displayName || 'لاعب').toString().slice(0, 16);
    var canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    var ctx = canvas.getContext('2d');
    // rounded background
    ctx.clearRect(0, 0, 256, 64);
    var padX = 12, padY = 10;
    ctx.font = 'bold 28px Tahoma, Arial, sans-serif';
    var tw = Math.min(ctx.measureText(text).width, 220);
    var boxW = tw + padX * 2;
    var boxH = 40;
    var bx = (256 - boxW) / 2;
    var by = (64 - boxH) / 2;
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    roundRect(ctx, bx + 2, by + 3, boxW, boxH, 12);
    ctx.fill();
    // gradient-ish solid
    var grd = ctx.createLinearGradient(bx, by, bx, by + boxH);
    grd.addColorStop(0, 'rgba(12, 20, 40, 0.92)');
    grd.addColorStop(1, 'rgba(8, 14, 28, 0.95)');
    ctx.fillStyle = grd;
    roundRect(ctx, bx, by, boxW, boxH, 12);
    ctx.fill();
    // border
    ctx.strokeStyle = 'rgba(0, 212, 255, 0.75)';
    ctx.lineWidth = 2;
    roundRect(ctx, bx, by, boxW, boxH, 12);
    ctx.stroke();
    // text
    ctx.fillStyle = '#e8f4ff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,212,255,0.5)';
    ctx.shadowBlur = 6;
    ctx.fillText(text, 128, 32);
    ctx.shadowBlur = 0;

    var tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    var mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false
    });
    var sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.6, 0.4, 1);
    sprite.position.set(0, 2.55, 0);
    sprite.userData.isNameTag = true;
    sprite.renderOrder = 999;
    return sprite;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function attachNameTag(group, displayName, visible) {
    if (!group) return null;
    // remove old
    if (group.userData.nameTag) {
      group.remove(group.userData.nameTag);
      if (group.userData.nameTag.material && group.userData.nameTag.material.map) {
        group.userData.nameTag.material.map.dispose();
      }
      if (group.userData.nameTag.material) group.userData.nameTag.material.dispose();
      group.userData.nameTag = null;
    }
    var sprite = createNameTagSprite(displayName);
    sprite.visible = visible !== false;
    group.add(sprite);
    group.userData.nameTag = sprite;
    group.userData.displayName = displayName || '';
    return sprite;
  }

  function setNameTagVisible(group, visible) {
    if (group && group.userData && group.userData.nameTag) {
      group.userData.nameTag.visible = !!visible;
    }
  }

  function getLevelRespawnPoints(kind) {
    // kind: 'lan' | 'split' — spaced so players don't stack on each other
    var defaults = kind === 'lan'
      ? [{ x: -6, y: 0, z: 0 }, { x: -4, y: 0, z: 0 }, { x: -2, y: 0, z: 0 }, { x: 0, y: 0, z: 0 },
         { x: 2, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 6, y: 0, z: 0 }, { x: 0, y: 0, z: 3 }]
      : [{ x: -2.5, y: 0, z: 0 }, { x: 2.5, y: 0, z: 0 }];
    if (!state.currentLevelId || !state.levels[state.currentLevelId]) return defaults;
    var r = ensureLevelRespawns(state.levels[state.currentLevelId]);
    var list = (kind === 'lan' ? r.lan : r.split) || [];
    if (!list.length) return defaults;
    return list;
  }

  function setupPlayers() {
    players.forEach(function (p) { if (p.group) { scene.remove(p.group); p.group = null; } });
    var c0 = (typeof playerCustom !== 'undefined' && playerCustom[0]) ? playerCustom[0] : null;
    var c1 = (typeof playerCustom !== 'undefined' && playerCustom[1]) ? playerCustom[1] : null;
    var spawns = getLevelRespawnPoints('split');
    var s0 = spawns[0] || { x: -2, y: 0, z: 0 };
    var s1 = spawns[1] || { x: 2, y: 0, z: 0 };
    var n0 = state.playerName || 'اللاعب 1';
    var n1 = 'اللاعب 2';
    players[0].group = createCharacterMesh(0x1e40af, 0xe0ac69, c0);
    players[0].group.position.set(s0.x, 0, s0.z); players[0].yaw = 0; players[0].velocity.set(0, 0, 0); scene.add(players[0].group);
    attachNameTag(players[0].group, n0, true);
    players[1].group = createCharacterMesh(0xb91c1c, 0xe0ac69, c1);
    players[1].group.position.set(s1.x, 0, s1.z); players[1].yaw = Math.PI; players[1].velocity.set(0, 0, 0); scene.add(players[1].group);
    attachNameTag(players[1].group, n1, true);
    var aspect = (window.innerWidth / 2) / window.innerHeight;
    players[0].camera = new THREE.PerspectiveCamera(70, aspect, 0.1, 400);
    players[1].camera = new THREE.PerspectiveCamera(70, aspect, 0.1, 400);
  }

  function updatePlayerCamera(player) {
    if (!player.group || !player.camera) return;
    var ov = state.script.cameraOverride[player.id];
    if (ov) {
      var lerp = ov.lerp != null ? ov.lerp : 0.12;
      if (ov.x != null) player.camera.position.lerp(new THREE.Vector3(ov.x, ov.y, ov.z), lerp);
      if (ov.lookX != null) player.camera.lookAt(ov.lookX, ov.lookY, ov.lookZ);
      if (ov.fov != null && player.camera.fov !== ov.fov) {
        player.camera.fov = ov.fov;
        player.camera.updateProjectionMatrix();
      }
      return;
    }
    var ps = player.settings || {};
    var dist = ps.camDist != null ? ps.camDist : state.camDist;
    var h = ps.camHeight != null ? ps.camHeight : state.camHeight;
    var side = ps.camSide != null ? ps.camSide : state.camSide;
    var offset = new THREE.Vector3(
      Math.sin(player.yaw) * dist + Math.cos(player.yaw) * side,
      h,
      Math.cos(player.yaw) * dist - Math.sin(player.yaw) * side
    );
    var target = player.group.position.clone().add(new THREE.Vector3(0, 1.4, 0));
    player.camera.position.lerp(target.clone().add(offset), 0.15);
    player.camera.lookAt(target);
  }

  function findNearestVehicle(player, maxDist) {
    maxDist = maxDist || 3.5;
    var best = null, bestD = maxDist * maxDist;
    var px = player.group.position.x, pz = player.group.position.z;
    for (var i = 0; i < state.buildObjects.length; i++) {
      var o = state.buildObjects[i];
      if (!o || !o.userData || !o.userData.isVehicle) continue;
      // occupied by someone else?
      if (o.userData.drivenBy != null && o.userData.drivenBy !== player.id) continue;
      var dx = o.position.x - px, dz = o.position.z - pz;
      var d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = o; }
    }
    return best;
  }

  function enterVehicle(player, vehicle) {
    if (!player || !vehicle) return;
    player.vehicle = vehicle;
    vehicle.userData.drivenBy = player.id;
    player.yaw = vehicle.rotation.y;
    if (player.group) player.group.visible = true;
    toast('ركبت العربة — E للنزول', 'info');
  }

  function exitVehicle(player) {
    if (!player || !player.vehicle) return;
    var v = player.vehicle;
    v.userData.drivenBy = null;
    player.vehicle = null;
    if (player.group) {
      player.group.position.x = v.position.x + Math.sin(player.yaw) * 2;
      player.group.position.z = v.position.z + Math.cos(player.yaw) * 2;
      player.group.position.y = 0;
    }
    toast('نزلت من العربة', 'info');
  }

  function tryToggleVehicle(player) {
    if (!player || !player.group) return;
    if (player.vehicle) exitVehicle(player);
    else {
      var v = findNearestVehicle(player);
      if (v) enterVehicle(player, v);
      else toast('مفيش عربية قريبة', 'info');
    }
  }

  // Solid collision vs build objects (and other players)
  function playerCollides(player) {
    if (!player || !player.group) return false;
    var x = player.group.position.x;
    var y = player.group.position.y;
    var z = player.group.position.z;
    var r = 0.38;
    var h = 1.75;
    var pBox = new THREE.Box3(
      new THREE.Vector3(x - r, y + 0.05, z - r),
      new THREE.Vector3(x + r, y + h, z + r)
    );
    var i, o, b;
    for (i = 0; i < state.buildObjects.length; i++) {
      o = state.buildObjects[i];
      if (!o || !o.visible) continue;
      if (o.userData && o.userData.noCollision) continue;
      b = new THREE.Box3().setFromObject(o);
      // ignore ultra-flat ground-like if height almost 0 at world y0 - still collide walls/buildings
      if (b.isEmpty()) continue;
      if (pBox.intersectsBox(b)) return true;
    }
    // other local player (split only — soft, so you don't freeze if spawned stacked)
    if (state.playType === 'split') {
      for (i = 0; i < players.length; i++) {
        if (!players[i] || players[i] === player || !players[i].group) continue;
        var ox = players[i].group.position.x, oz = players[i].group.position.z;
        var dx = x - ox, dz = z - oz;
        if (dx * dx + dz * dz < (r * 1.6) * (r * 1.6)) return true;
      }
    }
    // IMPORTANT: do NOT solid-collide remote net players.
    // In LAN/online everyone often starts near the same spawn → collision froze movement
    // while jump still worked (Y is not blocked the same way).
    return false;
  }

  function updatePlayerMovement(player, delta, input) {
    if (!player.group) return;
    // Script can lock player input or force movement
    if (state.script.inputLocked[player.id]) {
      if (state.script.forcedInput[player.id]) {
        input = state.script.forcedInput[player.id];
      } else {
        input = { up: false, down: false, left: false, right: false, jump: false, run: false };
      }
    } else if (state.script.forcedInput[player.id]) {
      // merge forced over real
      var fi = state.script.forcedInput[player.id];
      input = {
        up: fi.up != null ? fi.up : input.up,
        down: fi.down != null ? fi.down : input.down,
        left: fi.left != null ? fi.left : input.left,
        right: fi.right != null ? fi.right : input.right,
        jump: fi.jump != null ? fi.jump : input.jump,
        run: fi.run != null ? fi.run : input.run,
        lookX: fi.lookX != null ? fi.lookX : input.lookX
      };
    }
    // Driving a vehicle
    if (player.vehicle) {
      var v = player.vehicle;
      var vSpeed = input.run ? 14 : 8;
      if (input.lookX !== undefined) player.yaw -= input.lookX * 0.04;
      v.rotation.y = player.yaw;
      var vfX = -Math.sin(player.yaw), vfZ = -Math.cos(player.yaw);
      var vm = 0, vz = 0;
      if (input.up) { vm += vfX; vz += vfZ; }
      if (input.down) { vm -= vfX; vz -= vfZ; }
      var vlen = Math.sqrt(vm * vm + vz * vz);
      if (vlen > 0.001) {
        vm /= vlen; vz /= vlen;
        var oldvx = v.position.x, oldvz = v.position.z;
        v.position.x += vm * vSpeed * delta;
        v.position.z += vz * vSpeed * delta;
        // simple vehicle collision: if player would collide, revert (use vehicle center)
        var saved = { x: player.group.position.x, z: player.group.position.z };
        player.group.position.x = v.position.x;
        player.group.position.z = v.position.z;
        if (playerCollides(player)) {
          v.position.x = oldvx;
          v.position.z = oldvz;
        }
        player.group.position.x = v.position.x;
        player.group.position.z = v.position.z;
      }
      // seat player on vehicle
      player.group.position.x = v.position.x;
      player.group.position.y = v.position.y + 0.9;
      player.group.position.z = v.position.z;
      player.group.rotation.y = player.yaw + Math.PI;
      player.velocity.y = 0;
      return;
    }

    var speed = input.run ? 7.5 : 4.2;
    if (input.lookX !== undefined) player.yaw -= input.lookX * 0.04;

    // Character faces camera direction
    player.group.rotation.y = THREE.MathUtils.lerp(player.group.rotation.y, player.yaw + Math.PI, 0.3);

    // Camera forward = where the player should walk on W
    // Camera sits at (sin(yaw)*d, cos(yaw)*d) behind player, so forward is (-sin, -cos)
    var fwdX = -Math.sin(player.yaw);
    var fwdZ = -Math.cos(player.yaw);
    var rightX = Math.cos(player.yaw);
    var rightZ = -Math.sin(player.yaw);

    var mx = 0, mz = 0;
    if (input.up) { mx += fwdX; mz += fwdZ; }      // W = toward camera look
    if (input.down) { mx -= fwdX; mz -= fwdZ; }    // S = opposite
    if (input.right) { mx += rightX; mz += rightZ; }
    if (input.left) { mx -= rightX; mz -= rightZ; }

    var ud = player.group.userData;
    var len = Math.sqrt(mx * mx + mz * mz);
    if (len > 0.001) {
      mx /= len; mz /= len;
      var step = speed * delta;
      var oldX = player.group.position.x;
      var oldZ = player.group.position.z;
      // Move X then Z separately so you slide along walls (solid bodies)
      player.group.position.x = oldX + mx * step;
      if (playerCollides(player)) player.group.position.x = oldX;
      player.group.position.z = oldZ + mz * step;
      if (playerCollides(player)) player.group.position.z = oldZ;
      ud.walkCycle += delta * speed * 3.2;
      var swing = Math.sin(ud.walkCycle) * 0.55;
      ud.leftArm.rotation.x = swing; ud.rightArm.rotation.x = -swing;
      ud.leftLeg.rotation.x = -swing; ud.rightLeg.rotation.x = swing;
    } else {
      ud.leftArm.rotation.x *= 0.85; ud.rightArm.rotation.x *= 0.85;
      ud.leftLeg.rotation.x *= 0.85; ud.rightLeg.rotation.x *= 0.85;
    }
    if (input.jump && player.canJump) { player.velocity.y = 6.5; player.canJump = false; }
    player.velocity.y -= 16 * delta;
    player.group.position.y += player.velocity.y * delta;
    if (player.group.position.y <= 0) { player.group.position.y = 0; player.velocity.y = 0; player.canJump = true; }
  }

  // ===== FLY CAMERA =====
  function updateFlyCamera(delta) {
    var speed = (state.keys['ShiftLeft'] || state.keys['ShiftRight']) ? 8 : 14;
    // When shift held for down, don't use it as speed boost - separate
    var moveSpeed = 14;
    if (state.keys['KeyW'] || state.keys['KeyS'] || state.keys['KeyA'] || state.keys['KeyD']) {
      // normal
    }
    var forward = new THREE.Vector3(-Math.sin(state.flyYaw) * Math.cos(state.flyPitch), 0, -Math.cos(state.flyYaw) * Math.cos(state.flyPitch));
    forward.y = 0; forward.normalize();
    var right = new THREE.Vector3(Math.cos(state.flyYaw), 0, -Math.sin(state.flyYaw));
    if (state.keys['KeyW']) state.flyPos.addScaledVector(forward, moveSpeed * delta);
    if (state.keys['KeyS']) state.flyPos.addScaledVector(forward, -moveSpeed * delta);
    if (state.keys['KeyA']) state.flyPos.addScaledVector(right, -moveSpeed * delta);
    if (state.keys['KeyD']) state.flyPos.addScaledVector(right, moveSpeed * delta);
    // Space = up, Shift = down
    if (state.keys['Space']) state.flyPos.y += moveSpeed * delta;
    if (state.keys['ShiftLeft'] || state.keys['ShiftRight']) state.flyPos.y -= moveSpeed * delta;
    if (state.flyPos.y < 1) state.flyPos.y = 1;

    buildCamera.position.copy(state.flyPos);
    var lookDir = new THREE.Vector3(
      -Math.sin(state.flyYaw) * Math.cos(state.flyPitch),
      Math.sin(state.flyPitch),
      -Math.cos(state.flyYaw) * Math.cos(state.flyPitch)
    );
    buildCamera.lookAt(state.flyPos.clone().add(lookDir));
  }

  function toggleFlyMode() {
    if (state.mode !== 'build') return;
    state.flyMode = !state.flyMode;
    if (state.flyMode) {
      flyIndicator.style.display = 'block';
      document.body.style.cursor = 'none';
      canvas.requestPointerLock && canvas.requestPointerLock();
      state.flyPos.copy(buildCamera.position);
    } else {
      flyIndicator.style.display = 'none';
      document.body.style.cursor = 'default';
      document.exitPointerLock && document.exitPointerLock();
    }
  }

  // ===== GAMEPAD =====
  var prevXPressed = false;
  var prevOptionsPressed = false;
  var prevGpMenuNav = { up: false, down: false, left: false, right: false, confirm: false, back: false };

  function pollGamepad() {
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    var pad = null;
    for (var i = 0; i < pads.length; i++) { if (pads[i]) { pad = pads[i]; break; } }
    if (!pad) return null;
    var xPressed = pad.buttons[0] && pad.buttons[0].pressed;
    if (state.mode === 'lobby' && xPressed && !prevXPressed && !state.player2Joined) joinPlayer2();
    prevXPressed = xPressed;
    var lx = pad.axes[0] || 0, ly = pad.axes[1] || 0, rx = pad.axes[2] || 0, dead = 0.2;
    // Buttons: 0=A/X, 1=B/Circle, 8=Share, 9=Options/Start (varies by pad)
    var optionsPressed = (pad.buttons[9] && pad.buttons[9].pressed) || (pad.buttons[8] && pad.buttons[8].pressed);
    var circlePressed = pad.buttons[1] && pad.buttons[1].pressed;
    // D-pad
    var dUp = pad.buttons[12] && pad.buttons[12].pressed;
    var dDown = pad.buttons[13] && pad.buttons[13].pressed;
    var dLeft = pad.buttons[14] && pad.buttons[14].pressed;
    var dRight = pad.buttons[15] && pad.buttons[15].pressed;

    // Options opens/closes pause for player 2 in split (or full in online if host uses pad - only P2)
    if (state.mode === 'play' && optionsPressed && !prevOptionsPressed) {
      if (state.paused && state.pauseOwner === 1) {
        closePause();
      } else if (!state.paused) {
        if (state.playType === 'split') openPause('right');
        else openPause('full');
        state.pauseOwner = state.playType === 'split' ? 1 : 0;
      }
    }
    prevOptionsPressed = optionsPressed;

    return {
      up: ly < -dead || dUp, down: ly > dead || dDown, left: lx < -dead || dLeft, right: lx > dead || dRight,
      jump: xPressed, run: circlePressed,
      lookX: Math.abs(rx) > dead ? rx : 0,
      options: optionsPressed, confirm: xPressed, back: circlePressed,
      dUp: dUp, dDown: dDown, dLeft: dLeft, dRight: dRight,
      stickY: ly, stickX: lx
    };
  }
  function joinPlayer2() {
    state.player2Joined = true;
    document.getElementById('player2-card').classList.add('ready');
    document.getElementById('player2-status').textContent = 'READY ✓';
    document.getElementById('player2-status').classList.add('online');
    document.getElementById('p2-avatar').textContent = '✅';
    btnStart.disabled = false; btnStart.textContent = 'START GAME';
    document.getElementById('gamepad-hint').textContent = 'اللاعب 2 انضم!';
  }

  // ===== LEVELS =====
  function generateLevelId() { return 'level_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
  function safeName(n) { return (n || 'level').replace(/[^\w\u0600-\u06FF\- ]+/g, '_').trim() || 'level'; }

  function clearBuildObjects() {
    state.buildObjects.forEach(function (o) { scene.remove(o); });
    state.buildObjects = [];
    clearRespawnMarkers();
    var el = document.getElementById('object-count');
    if (el) el.textContent = '0 عنصر';
    if (typeof refreshHierarchy === 'function') refreshHierarchy();
  }

  // ===== RESPAWN MARKERS =====
  function clearRespawnMarkers() {
    (state.respawnMarkers || []).forEach(function (m) { scene.remove(m); });
    state.respawnMarkers = [];
  }

  function makeRespawnMarker(kind, index, pos) {
    var color = kind === 'lan' ? 0x30d158 : 0xff2d55;
    var g = new THREE.Group();
    var pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 1.6, 8),
      new THREE.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: 0.35 })
    );
    pole.position.y = 0.8;
    g.add(pole);
    var flag = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.35, 0.04),
      new THREE.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: 0.5 })
    );
    flag.position.set(0.3, 1.4, 0);
    g.add(flag);
    var base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.4, 0.12, 12),
      new THREE.MeshStandardMaterial({ color: 0x222222 })
    );
    base.position.y = 0.06;
    g.add(base);
    // number disc
    var disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.22, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    disc.position.set(0, 1.85, 0.02);
    disc.rotation.x = -0.3;
    g.add(disc);
    g.position.set(pos.x, 0, pos.z);
    g.userData.isRespawn = true;
    g.userData.respawnKind = kind;
    g.userData.respawnIndex = index;
    return g;
  }

  function ensureLevelRespawns(level) {
    if (!level.respawns) level.respawns = { lan: [], split: [] };
    if (!level.respawns.lan) level.respawns.lan = [];
    if (!level.respawns.split) level.respawns.split = [];
    return level.respawns;
  }

  function loadRespawnMarkers(levelId) {
    clearRespawnMarkers();
    var level = state.levels[levelId];
    if (!level) return;
    var r = ensureLevelRespawns(level);
    (r.lan || []).forEach(function (p, i) {
      var m = makeRespawnMarker('lan', i, p);
      scene.add(m);
      state.respawnMarkers.push(m);
    });
    (r.split || []).forEach(function (p, i) {
      var m = makeRespawnMarker('split', i, p);
      scene.add(m);
      state.respawnMarkers.push(m);
    });
    updateRespawnHint();
  }

  function serializeRespawns() {
    if (!state.currentLevelId || !state.levels[state.currentLevelId]) return { lan: [], split: [] };
    return ensureLevelRespawns(state.levels[state.currentLevelId]);
  }

  function saveRespawnsFromMarkers() {
    if (!state.currentLevelId || !state.levels[state.currentLevelId]) return;
    var lan = [];
    var split = [];
    (state.respawnMarkers || []).forEach(function (m) {
      var p = { x: m.position.x, y: 0, z: m.position.z };
      if (m.userData.respawnKind === 'lan') lan.push(p);
      else if (m.userData.respawnKind === 'split') split.push(p);
    });
    state.levels[state.currentLevelId].respawns = { lan: lan, split: split };
  }

  function updateRespawnHint() {
    var el = document.getElementById('respawn-mode-hint');
    if (!el) return;
    var mode = state.respawnPlaceMode;
    if (!mode) {
      el.textContent = 'اختر الوضع ثم اضغط على الأرض لوضع النقاط';
      return;
    }
    var r = state.currentLevelId && state.levels[state.currentLevelId]
      ? ensureLevelRespawns(state.levels[state.currentLevelId])
      : { lan: [], split: [] };
    // count from markers for live accuracy
    var lanCount = 0, splitCount = 0;
    (state.respawnMarkers || []).forEach(function (m) {
      if (m.userData.respawnKind === 'lan') lanCount++;
      else if (m.userData.respawnKind === 'split') splitCount++;
    });
    if (mode === 'lan') {
      el.textContent = 'وضع LAN (أخضر) — ' + lanCount + ' / 8 — اضغط على الأرض للوضع، أو على نقطة لحذفها';
    } else {
      el.textContent = 'وضع Split (أحمر) — ' + splitCount + ' / 2 — اضغط على الأرض للوضع، أو على نقطة لحذفها';
    }
  }

  function placeRespawnAt(point) {
    if (!state.respawnPlaceMode || !state.currentLevelId) {
      toast('أنشئ لفل أولاً', 'error');
      return;
    }
    var kind = state.respawnPlaceMode;
    var max = kind === 'lan' ? 8 : 2;
    var count = 0;
    (state.respawnMarkers || []).forEach(function (m) {
      if (m.userData.respawnKind === kind) count++;
    });
    if (count >= max) {
      toast(kind === 'lan' ? 'وصلت لحد 8 أماكن LAN' : 'وصلت لحد مكانين Split', 'error');
      return;
    }
    var m = makeRespawnMarker(kind, count, point);
    scene.add(m);
    state.respawnMarkers.push(m);
    saveRespawnsFromMarkers();
    updateRespawnHint();
    toast('تم وضع ريسبون ' + (kind === 'lan' ? 'LAN' : 'Split') + ' (' + (count + 1) + '/' + max + ')', 'success');
  }

  function removeRespawnMarker(mesh) {
    scene.remove(mesh);
    state.respawnMarkers = state.respawnMarkers.filter(function (m) { return m !== mesh; });
    // re-index
    var lanI = 0, splitI = 0;
    state.respawnMarkers.forEach(function (m) {
      if (m.userData.respawnKind === 'lan') m.userData.respawnIndex = lanI++;
      else m.userData.respawnIndex = splitI++;
    });
    saveRespawnsFromMarkers();
    updateRespawnHint();
    toast('تم حذف نقطة الريسبون', 'info');
  }

  function loadLevelIntoScene(levelId) {
    clearBuildObjects();
    var level = state.levels[levelId];
    if (!level) return;
    ensureLevelRespawns(level);
    (level.objects || []).forEach(function (o) {
      var item = findCatalogItem(o.id);
      var mesh = (item && item.factory) ? item.factory() : makeSimpleBlock([1, 1, 1], 0x888);
      mesh.position.set(o.position.x, 0, o.position.z);
      mesh.rotation.y = (o.rotation && o.rotation.y) || 0;
      mesh.userData.buildId = o.id;
      mesh.userData.catalogItem = item || { id: o.id };
      mesh.userData.instanceName = o.name || (item ? item.name : o.id);
      scene.add(mesh);
      state.buildObjects.push(mesh);
    });
    loadRespawnMarkers(levelId);
    var el = document.getElementById('object-count');
    if (el) el.textContent = state.buildObjects.length + ' عنصر';
    if (typeof refreshHierarchy === 'function') refreshHierarchy();
  }

  function serializeObjects() {
    return state.buildObjects.map(function (obj) {
      return { id: obj.userData.buildId, name: obj.userData.instanceName || obj.userData.buildId, position: { x: obj.position.x, y: obj.position.y, z: obj.position.z }, rotation: { y: obj.rotation.y } };
    });
  }

  function saveCurrentLevel() {
    if (!state.currentLevelId) { toast('أنشئ لفل أولاً', 'error'); return; }
    state.levels[state.currentLevelId].objects = serializeObjects();
    saveRespawnsFromMarkers();
    state.levels[state.currentLevelId].updatedAt = Date.now();
    renderLevelsList(); updateLobbyLevelSelect();
    toast('تم حفظ: ' + state.levels[state.currentLevelId].name, 'success');
  }

  function createNewLevel() {
    askName('اسم اللفل:', 'لفل ' + (Object.keys(state.levels).length + 1), function (name) {
      if (!name) return;
      // SAVE current level objects before switching away
      if (state.currentLevelId && state.levels[state.currentLevelId]) {
        state.levels[state.currentLevelId].objects = serializeObjects();
        saveRespawnsFromMarkers();
      }
      var id = generateLevelId();
      state.levels[id] = { name: name, objects: [], scripts: [], sounds: [], respawns: { lan: [], split: [] }, createdAt: Date.now() };
      state.currentLevelId = id;
      clearBuildObjects();
      document.getElementById('current-level-label').textContent = name;
      updateAssetsInfo(); renderLevelsList(); updateLobbyLevelSelect();
      toast('تم إنشاء: ' + name, 'success');
    });
  }

  function switchToLevel(id) {
    // Always save current level state before switching (even if empty)
    if (state.currentLevelId && state.levels[state.currentLevelId]) {
      state.levels[state.currentLevelId].objects = serializeObjects();
      saveRespawnsFromMarkers();
    }
    state.currentLevelId = id;
    loadLevelIntoScene(id);
    document.getElementById('current-level-label').textContent = state.levels[id] ? state.levels[id].name : id;
    updateAssetsInfo(); renderLevelsList();
  }

  function deleteLevel(id, e) {
    e.stopPropagation();
    /* no confirm */
    delete state.levels[id];
    if (state.currentLevelId === id) {
      state.currentLevelId = null; clearBuildObjects();
      document.getElementById('current-level-label').textContent = '—';
      updateAssetsInfo();
    }
    renderLevelsList(); updateLobbyLevelSelect();
  }

  function renderLevelsList() {
    var list = document.getElementById('levels-list');
    if (!list) return;
    list.innerHTML = '';
    var ids = Object.keys(state.levels);
    if (!ids.length) { list.innerHTML = '<div style="color:#8e9aaf;font-size:0.82rem;padding:8px">لا توجد لفلز</div>'; return; }
    ids.forEach(function (id) {
      var lv = state.levels[id];
      var el = document.createElement('div');
      el.className = 'level-item' + (id === state.currentLevelId ? ' active' : '');
      var sc = '';
      if (lv.scripts && lv.scripts.length) sc += ' 📜' + lv.scripts.length;
      if (lv.sounds && lv.sounds.length) sc += ' 🔊' + lv.sounds.length;
      el.innerHTML = '<span>' + lv.name + ' (' + (lv.objects ? lv.objects.length : 0) + ')' + sc + '</span>';
      var del = document.createElement('button'); del.className = 'del-btn'; del.textContent = '✕';
      del.onclick = function (e) { deleteLevel(id, e); };
      el.appendChild(del);
      el.onclick = function () { switchToLevel(id); };
      list.appendChild(el);
    });
  }

  function updateLobbyLevelSelect() {
    var sel = document.getElementById('lobby-level-select');
    if (!sel) return;
    var cur = sel.value;
    sel.innerHTML = '<option value="">عالم فارغ</option>';
    Object.keys(state.levels).forEach(function (id) {
      var opt = document.createElement('option'); opt.value = id; opt.textContent = state.levels[id].name; sel.appendChild(opt);
    });
    if (cur && state.levels[cur]) sel.value = cur;
  }

  function updateAssetsInfo() {
    var el = document.getElementById('scripts-info');
    if (!el) return;
    if (!state.currentLevelId || !state.levels[state.currentLevelId]) { el.textContent = ''; return; }
    var lv = state.levels[state.currentLevelId];
    var parts = [];
    if (lv.scripts && lv.scripts.length) parts.push('برمجات: ' + lv.scripts.length);
    if (lv.sounds && lv.sounds.length) parts.push('أصوات: ' + lv.sounds.length);
    el.textContent = parts.join(' | ');
  }

  // ===== ZIP DOWNLOAD =====
  function downloadAllAsZip() {
    if (typeof JSZip === 'undefined') { toast('JSZip غير متوفر', 'error'); return; }
    // Auto-save current
    if (state.currentLevelId) {
      state.levels[state.currentLevelId].objects = serializeObjects();
      saveRespawnsFromMarkers();
    }

    var zip = new JSZip();
    var levelsFolder = zip.folder('levels');
    var globalFolder = zip.folder('الشامل');
    var globalBuild = globalFolder.folder('البناء');
    var globalSounds = globalFolder.folder('الاصوات');
    var globalScripts = globalFolder.folder('البرمجيات');

    var levelIds = Object.keys(state.levels);
    if (!levelIds.length) { toast('لا توجد لفلز للحفظ', 'error'); return; }

    levelIds.forEach(function (id) {
      var lv = state.levels[id];
      var folderName = safeName(lv.name) + '_' + id.slice(-4);
      var lf = levelsFolder.folder(folderName);
      var buildF = lf.folder('البناء');
      var soundsF = lf.folder('الاصوات');
      var scriptsF = lf.folder('البرمجيات');

      // Build data (includes respawn points)
      var resp = ensureLevelRespawns(lv);
      var buildData = JSON.stringify({
        levelId: id,
        name: lv.name,
        objects: lv.objects || [],
        respawns: { lan: resp.lan || [], split: resp.split || [] }
      }, null, 2);
      buildF.file('build.json', buildData);
      globalBuild.file(folderName + '_build.json', buildData);

      // Scripts
      (lv.scripts || []).forEach(function (s) {
        scriptsF.file(s.name, s.content || '');
        globalScripts.file(folderName + '_' + s.name, s.content || '');
      });

      // Sounds (data URLs)
      (lv.sounds || []).forEach(function (s) {
        if (s.dataUrl) {
          var base64 = s.dataUrl.split(',')[1] || '';
          soundsF.file(s.name, base64, { base64: true });
          globalSounds.file(folderName + '_' + s.name, base64, { base64: true });
        }
      });
    });

    // Manifest
    zip.file('manifest.json', JSON.stringify({
      version: 4,
      exportedAt: new Date().toISOString(),
      levels: levelIds.map(function (id) {
        return { id: id, name: state.levels[id].name, objects: (state.levels[id].objects || []).length, scripts: (state.levels[id].scripts || []).length, sounds: (state.levels[id].sounds || []).length };
      })
    }, null, 2));

    zip.generateAsync({ type: 'blob' }).then(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'story_mode_data_' + Date.now() + '.zip';
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  // ===== ZIP UPLOAD (comprehensive) =====
  function processZipArrayBuffer(arrayBuffer, onDone) {
    if (typeof JSZip === 'undefined') { toast('JSZip غير متوفر', 'error'); if (onDone) onDone(false, 0); return; }
    JSZip.loadAsync(arrayBuffer).then(function (zip) {
        var promises = [];
        var levelMap = {}; // folderName -> { id, name, objects, scripts, sounds }

        zip.forEach(function (relativePath, zipEntry) {
          if (zipEntry.dir) return;
          var parts = relativePath.replace(/\\/g, '/').split('/');

          // levels/LevelName/البناء/build.json
          // levels/LevelName/البرمجيات/file.js
          // levels/LevelName/الاصوات/file.mp3
          if (parts[0] === 'levels' && parts.length >= 3) {
            var levelFolder = parts[1];
            if (!levelMap[levelFolder]) {
              levelMap[levelFolder] = { name: levelFolder.replace(/_level_.*$/, '').replace(/_[a-z0-9]+$/, '') || levelFolder, objects: [], scripts: [], sounds: [], respawns: { lan: [], split: [] } };
            }
            var sub = parts[2];
            var fileName = parts.slice(3).join('/') || parts[parts.length - 1];

            if (sub === 'البناء' || sub === 'build') {
              if (fileName.endsWith('.json')) {
                promises.push(zipEntry.async('string').then(function (text) {
                  try {
                    var data = JSON.parse(text);
                    if (data.objects) levelMap[levelFolder].objects = data.objects;
                    if (data.name) levelMap[levelFolder].name = data.name;
                    if (data.levelId) levelMap[levelFolder].id = data.levelId;
                    if (data.respawns) levelMap[levelFolder].respawns = data.respawns;
                  } catch (err) { console.warn(err); }
                }));
              }
            } else if (sub === 'البرمجيات' || sub === 'scripts') {
              promises.push(zipEntry.async('string').then(function (text) {
                levelMap[levelFolder].scripts.push({ name: fileName, content: text });
              }));
            } else if (sub === 'الاصوات' || sub === 'sounds') {
              promises.push(zipEntry.async('base64').then(function (b64) {
                var ext = fileName.split('.').pop().toLowerCase();
                var mime = ext === 'wav' ? 'audio/wav' : ext === 'ogg' ? 'audio/ogg' : 'audio/mpeg';
                levelMap[levelFolder].sounds.push({ name: fileName, dataUrl: 'data:' + mime + ';base64,' + b64, type: mime });
              }));
            }
          }
        });

        Promise.all(promises).then(function () {
          var count = 0;
          Object.keys(levelMap).forEach(function (folder) {
            var data = levelMap[folder];
            var id = data.id || generateLevelId();
            // Merge if exists by name
            var existingId = null;
            Object.keys(state.levels).forEach(function (lid) {
              if (state.levels[lid].name === data.name) existingId = lid;
            });
            if (existingId) id = existingId;

            state.levels[id] = {
              name: data.name,
              objects: data.objects || (state.levels[id] && state.levels[id].objects) || [],
              scripts: data.scripts.length ? data.scripts : (state.levels[id] && state.levels[id].scripts) || [],
              sounds: data.sounds.length ? data.sounds : (state.levels[id] && state.levels[id].sounds) || [],
              respawns: data.respawns || (state.levels[id] && state.levels[id].respawns) || { lan: [], split: [] },
              createdAt: Date.now()
            };
            count++;
          });
          renderLevelsList();
          updateLobbyLevelSelect();
          if (count > 0) {
            // Prefer a level that actually has objects
            var bestId = null;
            Object.keys(state.levels).forEach(function (lid) {
              var lv = state.levels[lid];
              if (lv.objects && lv.objects.length && !bestId) bestId = lid;
            });
            if (!bestId) bestId = Object.keys(state.levels)[0];
            state.currentLevelId = bestId;
            loadLevelIntoScene(bestId);
            var lbl = document.getElementById('current-level-label');
            if (lbl) lbl.textContent = state.levels[bestId].name;
            updateAssetsInfo();
            if (typeof refreshHierarchy === 'function') refreshHierarchy();
          }
          toast('تم رفع ' + count + ' لفل', 'success');
          if (onDone) onDone(true, count);
        }).catch(function (err) {
          console.error(err);
          toast('خطأ في معالجة البيانات', 'error');
          if (onDone) onDone(false, 0);
        });
    }).catch(function (err) {
      console.error(err);
      toast('خطأ في قراءة ملف ZIP', 'error');
      if (onDone) onDone(false, 0);
    });
  }

  function uploadComprehensiveZip(file, onDone) {
    if (!file) { if (onDone) onDone(false, 0); return; }
    var reader = new FileReader();
    reader.onload = function (e) { processZipArrayBuffer(e.target.result, onDone); };
    reader.onerror = function () { toast('فشل قراءة الملف', 'error'); if (onDone) onDone(false, 0); };
    reader.readAsArrayBuffer(file);
  }

  // Load pack ZIP from same folder as index.html (works local server + GitHub Pages)
  // User types name without .zip — we try name.zip then name
  function normalizePackName(name) {
    name = (name || '').trim();
    if (!name) return '';
    name = name.replace(/\\/g, '/');
    // strip path, keep basename
    if (name.indexOf('/') !== -1) name = name.split('/').pop();
    if (/\.zip$/i.test(name)) name = name.replace(/\.zip$/i, '');
    return name;
  }

  function loadPackByName(packName, onDone) {
    var base = normalizePackName(packName);
    if (!base) {
      toast('اكتب اسم النسخة', 'error');
      if (onDone) onDone(false, 0);
      return;
    }
    // Relative to the page URL (GitHub Pages friendly)
    var candidates = [
      base + '.zip',
      base,
      encodeURIComponent(base) + '.zip',
      encodeURIComponent(base)
    ];
    // unique
    candidates = candidates.filter(function (v, i, a) { return a.indexOf(v) === i; });

    function tryNext(i) {
      if (i >= candidates.length) {
        toast('لم يُعثر على الملف: ' + base + '.zip بجانب index', 'error');
        if (onDone) onDone(false, 0);
        return;
      }
      var url = candidates[i];
      fetch(url, { cache: 'no-cache' }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.arrayBuffer();
      }).then(function (buf) {
        processZipArrayBuffer(buf, onDone);
      }).catch(function () {
        tryNext(i + 1);
      });
    }
    tryNext(0);
  }

  // ===== BUILD =====
  var raycaster = new THREE.Raycaster();
  var mouse = new THREE.Vector2();
  var ghostMesh = null;

  function populateSidebar(filter) {
    var sidebar = document.getElementById('build-sidebar');
    if (!sidebar) return;
    sidebar.innerHTML = '';
    filter = (filter || '').trim().toLowerCase();
    var items = [];
    if (filter) {
      // search all categories
      Object.keys(buildCatalog).forEach(function (cat) {
        buildCatalog[cat].forEach(function (item) {
          if (item.name.toLowerCase().indexOf(filter) !== -1 || item.id.toLowerCase().indexOf(filter) !== -1) {
            items.push(item);
          }
        });
      });
    } else {
      items = buildCatalog[state.currentCategory] || [];
    }
    items.forEach(function (item) {
      var el = document.createElement('div');
      el.className = 'build-item' + (state.selectedItem && state.selectedItem.id === item.id ? ' selected' : '');
      el.innerHTML = '<div class="icon">' + item.icon + '</div><div>' + item.name + '</div>';
      el.onclick = function () {
        state.selectedItem = item; state.currentTool = 'place';
        selectBuildObject(null);
        var btns = document.querySelectorAll('.tool-btn');
        for (var i = 0; i < btns.length; i++) btns[i].classList.remove('active');
        var pb = document.querySelector('[data-tool="place"]'); if (pb) pb.classList.add('active');
        document.getElementById('current-tool').textContent = 'أداة: وضع';
        populateSidebar(filter);
        updateGhost();
      };
      sidebar.appendChild(el);
    });
    if (!items.length) {
      sidebar.innerHTML = '<div style="grid-column:1/-1;color:#8e9aaf;font-size:0.85rem;padding:12px;text-align:center">لا نتائج</div>';
    }
  }

  function updateGhost() {
    if (ghostMesh) { scene.remove(ghostMesh); ghostMesh = null; }
    if (state.mode !== 'build' || state.flyMode || !state.selectedItem || state.currentTool !== 'place') return;
    if (state.selectedItem.factory) {
      ghostMesh = state.selectedItem.factory();
      ghostMesh.traverse(function (c) {
        if (c.isMesh && c.material) {
          c.material = c.material.clone();
          c.material.transparent = true; c.material.opacity = 0.4;
        }
      });
      scene.add(ghostMesh);
    }
  }

  function placeObject(pos) {
    if (!state.selectedItem || !state.currentLevelId) { if (!state.currentLevelId) toast('أنشئ لفل أولاً', 'error'); return; }
    var mesh = state.selectedItem.factory();
    mesh.position.set(pos.x, 0, pos.z);
    mesh.userData.buildId = state.selectedItem.id;
    mesh.userData.catalogItem = state.selectedItem;
    // Auto name: first = base name, next = name 2, name 3...
    var baseName = state.selectedItem.name;
    var sameCount = 0;
    state.buildObjects.forEach(function (o) {
      if (o.userData.buildId === state.selectedItem.id) sameCount++;
    });
    mesh.userData.instanceName = sameCount === 0 ? baseName : (baseName + ' ' + (sameCount + 1));
    scene.add(mesh);
    state.buildObjects.push(mesh);
    document.getElementById('object-count').textContent = state.buildObjects.length + ' عنصر';
    refreshHierarchy();
  }

  function onBuildClick(e) {
    if (state.mode !== 'build' || state.flyMode) return;
    // ignore clicks on UI
    if (e.target.closest && (e.target.closest('#obj-toolbar') || e.target.closest('.hierarchy-panel') || e.target.closest('.build-toolbar') || e.target.closest('.build-sidebar-wrap') || e.target.closest('.level-panel') || e.target.closest('#respawn-choice-panel'))) return;

    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, buildCamera);

    // ===== RESPAWN PLACEMENT MODE =====
    if (state.respawnPlaceMode) {
      // click existing respawn marker to remove
      var hitsR = raycaster.intersectObjects(state.respawnMarkers, true);
      if (hitsR.length) {
        var rm = hitsR[0].object;
        while (rm.parent && !rm.userData.isRespawn) rm = rm.parent;
        if (rm.userData && rm.userData.isRespawn) {
          removeRespawnMarker(rm);
          return;
        }
      }
      var hitsG = raycaster.intersectObject(ground);
      if (hitsG.length) placeRespawnAt(hitsG[0].point);
      return;
    }

    // Move mode from hierarchy context
    if (typeof moveModeObj !== 'undefined' && moveModeObj) {
      var hitsM = raycaster.intersectObject(ground);
      if (hitsM.length) {
        moveModeObj.position.set(hitsM[0].point.x, 0, hitsM[0].point.z);
        moveModeObj = null;
        refreshHierarchy();
        toast('تم النقل', 'success');
        return;
      }
    }

    // Gizmo handled on mousedown

    // Click on existing object to select
    var hitsObj = raycaster.intersectObjects(state.buildObjects, true);
    if (hitsObj.length && state.currentTool !== 'place') {
      var obj = hitsObj[0].object;
      while (obj.parent && state.buildObjects.indexOf(obj) === -1) obj = obj.parent;
      if (state.buildObjects.indexOf(obj) !== -1) {
        selectBuildObject(obj);
        objToolMode = 'move';
        rebuildGizmo();
        return;
      }
    }

    if (state.currentTool === 'place') {
      var hits = raycaster.intersectObject(ground);
      if (hits.length) placeObject(hits[0].point);
    } else if (state.currentTool === 'delete') {
      // also allow deleting respawn markers
      var hitsR2 = raycaster.intersectObjects(state.respawnMarkers, true);
      if (hitsR2.length) {
        var rm2 = hitsR2[0].object;
        while (rm2.parent && !rm2.userData.isRespawn) rm2 = rm2.parent;
        if (rm2.userData && rm2.userData.isRespawn) {
          removeRespawnMarker(rm2);
          return;
        }
      }
      var hits2 = raycaster.intersectObjects(state.buildObjects, true);
      if (hits2.length) {
        var obj2 = hits2[0].object;
        while (obj2.parent && state.buildObjects.indexOf(obj2) === -1) obj2 = obj2.parent;
        if (state.buildObjects.indexOf(obj2) !== -1) {
          scene.remove(obj2);
          state.buildObjects = state.buildObjects.filter(function (o) { return o !== obj2; });
          if (selectedBuildObj === obj2) selectBuildObject(null);
          document.getElementById('object-count').textContent = state.buildObjects.length + ' عنصر';
          refreshHierarchy();
        }
      }
    } else {
      // click empty - deselect
      if (!hitsObj.length) selectBuildObject(null);
    }
  }

  function onBuildMove(e) {
    if (state.mode !== 'build' || state.flyMode) return;
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, buildCamera);

    // Hover highlight on axes when not dragging
    if (!gizmoDrag && selectedBuildObj && transformGizmo && (objToolMode === 'move' || objToolMode === 'scale')) {
      var hAxis = pickGizmo(raycaster);
      setGizmoHover(hAxis);
    } else if (!gizmoDrag) {
      setGizmoHover(null);
    }

    // Axis gizmo drag — click axis + drag along it (also accept buttons===0 with pointer capture fallback via grabbed flag)
    if (gizmoDrag && gizmoDrag.grabbed && selectedBuildObj) {
      var axis = gizmoDrag.axis;
      // Mouse delta in NDC-ish pixels projected onto screen axis direction
      var mx = (e.clientX - gizmoDrag.startX);
      var my = -(e.clientY - gizmoDrag.startY); // screen y up
      var sa = gizmoDrag.screenAxis || { x: 1, y: 0 };
      var along = mx * sa.x + my * sa.y;
      // Scale sensitivity by distance to object
      var dist = buildCamera.position.distanceTo(gizmoDrag.startPos);
      var sens = dist * 0.0025;
      var moveAmt = along * sens;

      if (gizmoDrag.mode === 'move') {
        var pos = gizmoDrag.startPos.clone();
        if (axis === 'x') pos.x += moveAmt;
        else if (axis === 'y') pos.y += moveAmt;
        else if (axis === 'z') pos.z += moveAmt;
        selectedBuildObj.position.copy(pos);
      } else if (gizmoDrag.mode === 'scale') {
        var sc = gizmoDrag.startScale.clone();
        var factor = 1 + along * 0.008;
        factor = Math.max(0.05, Math.min(6, factor));
        if (state.scaleMode === 'uniform') {
          var nx = Math.max(0.15, Math.min(8, sc.x * factor));
          selectedBuildObj.scale.set(nx, nx, nx);
        } else {
          if (axis === 'x') sc.x = Math.max(0.15, Math.min(8, sc.x * factor));
          if (axis === 'y') sc.y = Math.max(0.15, Math.min(8, sc.y * factor));
          if (axis === 'z') sc.z = Math.max(0.15, Math.min(8, sc.z * factor));
          selectedBuildObj.scale.copy(sc);
        }
      }
      syncGizmoTransform();
      updateObjToolbarPos();
      return;
    }

    // Legacy free drag on ground (optional when isDraggingObj)
    if (selectedBuildObj && isDraggingObj && objToolMode === 'move') {
      var hits = raycaster.intersectObject(ground);
      if (hits.length) {
        selectedBuildObj.position.set(hits[0].point.x, selectedBuildObj.position.y, hits[0].point.z);
        syncGizmoTransform();
        updateObjToolbarPos();
      }
      return;
    }
    if (selectedBuildObj && objToolMode === 'rotate' && (e.buttons === 1) && !gizmoDrag) {
      selectedBuildObj.rotation.y += e.movementX * 0.01;
      updateObjToolbarPos();
      return;
    }
    // Fallback scale drag without axis (uniform) if no gizmo handle grabbed
    if (selectedBuildObj && objToolMode === 'scale' && (e.buttons === 1) && !gizmoDrag && state.scaleMode === 'uniform') {
      var s = selectedBuildObj.scale.x + e.movementY * -0.01;
      s = Math.max(0.15, Math.min(8, s));
      selectedBuildObj.scale.set(s, s, s);
      syncGizmoTransform();
      updateObjToolbarPos();
      return;
    }

    if (!ghostMesh) return;
    var hits2 = raycaster.intersectObject(ground);
    if (hits2.length) ghostMesh.position.set(hits2[0].point.x, 0, hits2[0].point.z);
  }

  // ===== SCREENS =====

  // ===== SCRIPT RUNTIME (PLAY MODE ONLY) =====
  // IMPORTANT: Scripts never affect build mode.
  // Objects in build mode are pure static data.
  // Scripts only execute when state.mode === 'play'.
  var activeScriptCleanups = [];

  function stopAllScripts() {
    activeScriptCleanups.forEach(function (fn) {
      try { fn(); } catch (e) { console.warn('script cleanup', e); }
    });
    activeScriptCleanups = [];
    // reset script control layer
    state.script.inputLocked = [false, false];
    state.script.forcedInput = [null, null];
    state.script.cameraOverride = [null, null];
    state.script.cutscene = false;
    state.script.cutsceneCam = null;
    state.script.timeScale = 1;
    state.script.blackBars = false;
    state.script.subtitle = '';
    state.script.waiters = [];
    var bars = document.getElementById('cutscene-bars');
    var sub = document.getElementById('cutscene-subtitle');
    if (bars) bars.style.display = 'none';
    if (sub) { sub.style.display = 'none'; sub.textContent = ''; }
  }

  function runLevelScripts(levelId) {
    // HARD GUARD: never run in build mode
    if (state.mode === 'build' || state.mode === 'menu' || state.mode === 'lobby') {
      return;
    }
    stopAllScripts();
    state.script.flags = {};
    state.script.waiters = [];
    var level = state.levels[levelId];
    if (!level || !level.scripts || !level.scripts.length) return;

    // ===== FULL GameAPI — programming controls everything =====
    function wrapObj(o) {
      if (!o) return null;
      return {
        name: o.userData.instanceName,
        id: o.userData.buildId,
        position: o.position,
        rotation: o.rotation,
        scale: o.scale,
        mesh: o,
        isCharacter: !!o.userData.isCharacter,
        isVehicle: !!o.userData.isVehicle,
        job: o.userData.job || null,
        limbs: o.userData.leftArm ? {
          leftArm: o.userData.leftArm,
          rightArm: o.userData.rightArm,
          leftLeg: o.userData.leftLeg,
          rightLeg: o.userData.rightLeg
        } : null
      };
    }

    var GameAPI = {
      // --- meta ---
      mode: function () { return state.mode; },
      isPlay: function () { return state.mode === 'play'; },
      THREE: THREE,
      scene: scene,
      time: function () { return state.clock.elapsedTime; },
      delta: function () { return Math.min(state.clock.getDelta(), 0.05) * (state.script.timeScale || 1); },

      // --- objects ---
      getObjects: function () {
        if (state.mode !== 'play') return [];
        return state.buildObjects.map(wrapObj);
      },
      getCharacters: function () {
        return this.getObjects().filter(function (o) { return o.isCharacter; });
      },
      getVehicles: function () {
        return this.getObjects().filter(function (o) { return o.isVehicle; });
      },
      getSeats: function (vehicleMesh) {
        if (!vehicleMesh) return [];
        var seats = [];
        vehicleMesh.traverse(function (c) {
          if (c.userData && c.userData.isSeat) seats.push({ mesh: c, name: c.userData.seatName || 'seat', position: c.position });
        });
        return seats;
      },
      findByName: function (name) {
        if (state.mode !== 'play') return null;
        for (var i = 0; i < state.buildObjects.length; i++) {
          if (state.buildObjects[i].userData.instanceName === name) return wrapObj(state.buildObjects[i]);
        }
        return null;
      },
      findAllById: function (buildId) {
        if (state.mode !== 'play') return [];
        return state.buildObjects.filter(function (o) { return o.userData.buildId === buildId; }).map(wrapObj);
      },
      setPosition: function (nameOrMesh, x, y, z) {
        var m = typeof nameOrMesh === 'string' ? (this.findByName(nameOrMesh) || {}).mesh : nameOrMesh;
        if (m && m.position) m.position.set(x, y != null ? y : m.position.y, z);
      },
      setRotation: function (nameOrMesh, yRad) {
        var m = typeof nameOrMesh === 'string' ? (this.findByName(nameOrMesh) || {}).mesh : nameOrMesh;
        if (m) m.rotation.y = yRad;
      },
      setScale: function (nameOrMesh, s) {
        var m = typeof nameOrMesh === 'string' ? (this.findByName(nameOrMesh) || {}).mesh : nameOrMesh;
        if (m) m.scale.setScalar(s);
      },
      setVisible: function (nameOrMesh, vis) {
        var m = typeof nameOrMesh === 'string' ? (this.findByName(nameOrMesh) || {}).mesh : nameOrMesh;
        if (m) m.visible = !!vis;
      },
      moveTowards: function (nameOrMesh, tx, tz, speed, delta) {
        var m = typeof nameOrMesh === 'string' ? (this.findByName(nameOrMesh) || {}).mesh : nameOrMesh;
        if (!m) return false;
        var dx = tx - m.position.x, dz = tz - m.position.z;
        var len = Math.sqrt(dx * dx + dz * dz);
        if (len < 0.15) return true;
        var sp = (speed || 3) * (delta || 0.016);
        m.position.x += (dx / len) * sp;
        m.position.z += (dz / len) * sp;
        m.rotation.y = Math.atan2(dx, dz);
        return false;
      },
      animateCharacter: function (mesh, delta, speed) {
        if (!mesh || !mesh.userData || !mesh.userData.leftArm) return;
        var ud = mesh.userData;
        ud.walkCycle = (ud.walkCycle || 0) + (delta || 0.016) * (speed || 8);
        var s = Math.sin(ud.walkCycle);
        if (ud.leftArm) ud.leftArm.rotation.x = s * 0.6;
        if (ud.rightArm) ud.rightArm.rotation.x = -s * 0.6;
        if (ud.leftLeg) ud.leftLeg.rotation.x = -s * 0.5;
        if (ud.rightLeg) ud.rightLeg.rotation.x = s * 0.5;
      },

      // --- players (the actual human-controlled characters) ---
      getPlayer: function (idx) {
        idx = idx || 0;
        var p = players[idx];
        if (!p || !p.group) return null;
        return {
          index: idx,
          mesh: p.group,
          position: p.group.position,
          rotation: p.group.rotation,
          yaw: p.yaw,
          velocity: p.velocity,
          camera: p.camera,
          canJump: p.canJump,
          limbs: p.group.userData ? {
            leftArm: p.group.userData.leftArm,
            rightArm: p.group.userData.rightArm,
            leftLeg: p.group.userData.leftLeg,
            rightLeg: p.group.userData.rightLeg
          } : null
        };
      },
      setPlayerPosition: function (idx, x, y, z) {
        var p = players[idx || 0];
        if (p && p.group) p.group.position.set(x, y != null ? y : 0, z);
      },
      setPlayerYaw: function (idx, yaw) {
        var p = players[idx || 0];
        if (p) p.yaw = yaw;
      },
      lockPlayer: function (idx, locked) {
        state.script.inputLocked[idx || 0] = !!locked;
      },
      lockAllPlayers: function (locked) {
        state.script.inputLocked[0] = !!locked;
        state.script.inputLocked[1] = !!locked;
      },
      forcePlayerInput: function (idx, inputObj) {
        // { up, down, left, right, jump, run, lookX } or null to clear
        state.script.forcedInput[idx || 0] = inputObj;
      },
      teleportPlayer: function (idx, x, y, z, yaw) {
        var p = players[idx || 0];
        if (!p || !p.group) return;
        p.group.position.set(x, y != null ? y : 0, z);
        if (yaw != null) p.yaw = yaw;
        p.velocity.set(0, 0, 0);
      },

      // --- camera ---
      setCamera: function (idx, opts) {
        // opts: { x,y,z, lookX,lookY,lookZ, fov, lerp }
        state.script.cameraOverride[idx || 0] = opts || null;
      },
      clearCamera: function (idx) {
        state.script.cameraOverride[idx || 0] = null;
      },
      clearAllCameras: function () {
        state.script.cameraOverride[0] = null;
        state.script.cameraOverride[1] = null;
      },
      setCamDist: function (d) { state.camDist = d; },
      setCamHeight: function (h) { state.camHeight = h; },
      setCamSide: function (s) { state.camSide = s; },

      // --- cutscene system ---
      startCutscene: function (opts) {
        // opts: { x,y,z, lookX,lookY,lookZ, fov, blackBars, lockPlayers }
        state.script.cutscene = true;
        state.script.cutsceneCam = opts || { x: 10, y: 8, z: 10, lookX: 0, lookY: 1, lookZ: 0, fov: 50 };
        if (opts && opts.blackBars !== false) state.script.blackBars = true;
        if (!opts || opts.lockPlayers !== false) {
          state.script.inputLocked[0] = true;
          state.script.inputLocked[1] = true;
        }
        updateScriptUI();
      },
      setCutsceneCamera: function (opts) {
        if (!state.script.cutscene) state.script.cutscene = true;
        state.script.cutsceneCam = opts;
        updateScriptUI();
      },
      endCutscene: function () {
        state.script.cutscene = false;
        state.script.cutsceneCam = null;
        state.script.blackBars = false;
        state.script.inputLocked[0] = false;
        state.script.inputLocked[1] = false;
        state.script.subtitle = '';
        updateScriptUI();
      },
      isCutscene: function () { return !!state.script.cutscene; },

      // --- UI / subtitle / bars ---
      subtitle: function (text) {
        state.script.subtitle = text || '';
        updateScriptUI();
      },
      blackBars: function (on) {
        state.script.blackBars = !!on;
        updateScriptUI();
      },
      toast: function (msg, type) { if (state.mode === 'play') toast(msg, type || 'info'); },

      // --- time ---
      setTimeScale: function (s) { state.script.timeScale = Math.max(0, s); },
      getTimeScale: function () { return state.script.timeScale; },
      wait: function (seconds, callback) {
        var t = { left: seconds, cb: callback, done: false };
        state.script.waiters.push(t);
        activeScriptCleanups.push(function () { t.done = true; });
      },
      after: function (seconds, callback) { this.wait(seconds, callback); },

      // --- flags / state machine for story ---
      setFlag: function (key, val) { state.script.flags[key] = val; },
      getFlag: function (key, def) { return state.script.flags.hasOwnProperty(key) ? state.script.flags[key] : def; },
      toggleFlag: function (key) { state.script.flags[key] = !state.script.flags[key]; return state.script.flags[key]; },

      // --- sounds (if level has them) ---
      playSound: function (name) {
        var lid = state.currentLevelId || state.selectedPlayLevel;
        var lv = lid && state.levels[lid];
        if (!lv || !lv.sounds) return;
        for (var i = 0; i < lv.sounds.length; i++) {
          if (lv.sounds[i].name === name || lv.sounds[i].name.indexOf(name) !== -1) {
            try {
              var a = new Audio(lv.sounds[i].dataUrl);
              a.volume = state.volume;
              a.play();
            } catch (e) {}
            return;
          }
        }
      },

      // --- input query ---
      isKeyDown: function (code) { return !!state.keys[code]; },
      getPlayerInput: function (idx) {
        if (idx === 1) return null; // gamepad polled elsewhere
        return {
          up: !!state.keys['KeyW'], down: !!state.keys['KeyS'],
          left: !!state.keys['KeyA'], right: !!state.keys['KeyD'],
          jump: !!state.keys['Space'], run: !!state.keys['KeyF']
        };
      },

      // --- distance helpers ---
      distance: function (a, b) {
        var ax = a.x != null ? a.x : (a.position ? a.position.x : 0);
        var az = a.z != null ? a.z : (a.position ? a.position.z : 0);
        var bx = b.x != null ? b.x : (b.position ? b.position.x : 0);
        var bz = b.z != null ? b.z : (b.position ? b.position.z : 0);
        var dx = ax - bx, dz = az - bz;
        return Math.sqrt(dx * dx + dz * dz);
      },
      near: function (a, b, radius) {
        return this.distance(a, b) <= (radius || 2);
      },

      // --- main loop hook ---
      onUpdate: function (fn) {
        if (state.mode !== 'play') return;
        var running = true;
        function loop() {
          if (!running || state.mode !== 'play') return;
          var d = 0.016 * (state.script.timeScale || 1);
          // process waiters
          for (var i = state.script.waiters.length - 1; i >= 0; i--) {
            var w = state.script.waiters[i];
            if (w.done) { state.script.waiters.splice(i, 1); continue; }
            w.left -= d;
            if (w.left <= 0) {
              w.done = true;
              state.script.waiters.splice(i, 1);
              try { w.cb && w.cb(); } catch (e) { console.warn(e); }
            }
          }
          try { fn(d); } catch (e) { console.warn(e); }
          requestAnimationFrame(loop);
        }
        requestAnimationFrame(loop);
        activeScriptCleanups.push(function () { running = false; });
      },

      // --- sequence helper for cutscenes ---
      sequence: function (steps) {
        // steps: [ { wait: 1 }, { fn: function(){} }, { subtitle: '...' }, { camera: {...} }, ... ]
        var self = this;
        var i = 0;
        function next() {
          if (i >= steps.length || state.mode !== 'play') return;
          var step = steps[i++];
          if (step.wait) {
            self.wait(step.wait, next);
            return;
          }
          if (step.subtitle != null) self.subtitle(step.subtitle);
          if (step.camera) self.setCutsceneCamera(step.camera);
          if (step.startCutscene) self.startCutscene(step.startCutscene === true ? step.camera : step.startCutscene);
          if (step.endCutscene) self.endCutscene();
          if (step.lock) self.lockAllPlayers(true);
          if (step.unlock) self.lockAllPlayers(false);
          if (step.toast) self.toast(step.toast);
          if (step.flag) self.setFlag(step.flag[0], step.flag[1]);
          if (step.fn) try { step.fn(self); } catch (e) { console.warn(e); }
          if (step.waitAfter) {
            self.wait(step.waitAfter, next);
          } else {
            next();
          }
        }
        next();
      }
    };

    function updateScriptUI() {
      var bars = document.getElementById('cutscene-bars');
      var sub = document.getElementById('cutscene-subtitle');
      if (!bars) {
        bars = document.createElement('div');
        bars.id = 'cutscene-bars';
        bars.innerHTML = '<div class="bar top"></div><div class="bar bottom"></div>';
        bars.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5000;display:none';
        var style = document.createElement('style');
        style.textContent = '#cutscene-bars .bar{position:absolute;left:0;right:0;height:12%;background:#000;transition:height .4s}' +
          '#cutscene-bars .top{top:0}#cutscene-bars .bottom{bottom:0}' +
          '#cutscene-subtitle{position:fixed;left:10%;right:10%;bottom:14%;text-align:center;color:#fff;font-size:1.25rem;' +
          'text-shadow:0 2px 8px #000;z-index:5001;pointer-events:none;font-family:Tahoma,Arial,sans-serif;display:none;line-height:1.5}';
        document.head.appendChild(style);
        document.body.appendChild(bars);
      }
      if (!sub) {
        sub = document.createElement('div');
        sub.id = 'cutscene-subtitle';
        document.body.appendChild(sub);
      }
      bars.style.display = state.script.blackBars ? 'block' : 'none';
      if (state.script.subtitle) {
        sub.style.display = 'block';
        sub.textContent = state.script.subtitle;
      } else {
        sub.style.display = 'none';
        sub.textContent = '';
      }
    }

    level.scripts.forEach(function (s) {
      if (!s.content) return;
      try {
        // Scripts receive GameAPI; they should no-op if not in play
        var fn = new Function('Game', '"use strict";\n' + s.content);
        fn(GameAPI);
      } catch (err) {
        console.warn('Script error (' + s.name + '):', err);
        toast('خطأ في برمجة: ' + s.name, 'error');
      }
    });
  }


  function showScreen(name) {
    // Stop any running scripts when leaving play mode
    if (state.mode === 'play' && name !== 'play') {
      if (typeof stopAllScripts === 'function') stopAllScripts();
    }
    // Hide ALL menu overlays
    mainMenu.classList.add('hidden');
    lobbyScreen.classList.add('hidden');
    buildUI.classList.add('hidden');
    gameUI.classList.add('hidden');
    ['story-choice','online-confirm','online-hub','create-room','join-room'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
    var pm = document.getElementById('pause-menu');
    if (pm) pm.classList.add('hidden');
    var sp = document.getElementById('settings-panel');
    if (sp) sp.classList.add('hidden');
    state.paused = false;

    gridHelper.visible = false;
    renderer.setScissorTest(false);
    state.mode = name;
    state.flyMode = false;
    flyIndicator.style.display = 'none';
    document.body.style.cursor = 'default';
    document.exitPointerLock && document.exitPointerLock();

    if (name === 'menu') {
      mainMenu.classList.remove('hidden');
    } else if (name === 'lobby') {
      // Do NOT reset player2Joined here — callers set it intentionally
      lobbyScreen.classList.remove('hidden');
      if (lobbyScreen) lobbyScreen.classList.remove('online-lobby');
      updateLobbyLevelSelect();
    } else if (name === 'build') {
      if (typeof stopAllScripts === 'function') stopAllScripts();
      players.forEach(function (p) {
        if (p.group) { scene.remove(p.group); p.group = null; }
      });
      clearRemoteMeshes && clearRemoteMeshes();
      buildUI.classList.remove('hidden');
      gridHelper.visible = true;
      populateSidebar(); renderLevelsList(); updateAssetsInfo(); refreshHierarchy();
      state.flyPos.set(15, 18, 15); state.flyYaw = 0.8; state.flyPitch = 0.35;
      buildCamera.position.copy(state.flyPos);
      buildCamera.lookAt(0, 0, 0);
      state.respawnPlaceMode = null;
      var rp = document.getElementById('respawn-choice-panel');
      if (rp) rp.classList.add('hidden');
      if (state.currentLevelId) loadRespawnMarkers(state.currentLevelId);
    } else if (name === 'play') {
      gameUI.classList.remove('hidden');
      if (state.playType === 'split') {
        renderer.setScissorTest(true);
        var labels = document.getElementById('split-labels');
        if (labels) labels.style.display = 'flex';
      } else {
        renderer.setScissorTest(false);
        var labels2 = document.getElementById('split-labels');
        if (labels2) labels2.style.display = 'none';
      }
    }
  }

  function startGame() {
    if (state.playType === 'online' && !state.isHost) {
      toast('انتظر القائد لبدء اللعبة', 'info');
      return;
    }
    if (state.playType === 'split' && !state.player2Joined) {
      toast('اضغط على كارت اللاعب 2 أو زر X على الدراعة', 'info');
      return;
    }
    if (state.playType === 'online' && state.isHost) {
      var n = (state.netRoster || []).length;
      if (n < 2) {
        toast('لازم لاعب واحد على الأقل ينضم', 'info');
        return;
      }
    }
    // Apply customization from UI
    try {
      if (typeof readCustomFromUI === 'function') {
        if (state.playType === 'online') {
          readCustomFromUI(0);
        } else if (document.getElementById('custom-player-select')) {
          var prev = document.getElementById('custom-player-select').value;
          document.getElementById('custom-player-select').value = '0';
          readCustomFromUI(0);
          document.getElementById('custom-player-select').value = '1';
          readCustomFromUI(1);
          document.getElementById('custom-player-select').value = prev;
          readCustomFromUI(parseInt(prev) || 0);
        }
      }
    } catch (e) { console.warn(e); }

    var levelId = '';
    var sel = document.getElementById('lobby-level-select');
    if (sel) levelId = sel.value || '';
    // Save respawns from markers before loading into play (if still in build)
    if (state.currentLevelId && state.levels[state.currentLevelId]) {
      saveRespawnsFromMarkers();
    }
    if (levelId) {
      state.currentLevelId = levelId;
      loadLevelIntoScene(levelId);
    } else clearBuildObjects();
    // Hide respawn markers during play (build-only visuals)
    clearRespawnMarkers();

    if (lobbyScreen) lobbyScreen.classList.remove('online-lobby');

    if (state.playType === 'online') {
      setupPlayersForNet();
      // force next pose to include clothes so remotes get appearance
      state._lastSentCustomKey = null;
    } else {
      setupPlayers();
    }
    showScreen('play');

    if (state.playType === 'online' && state.isHost) {
      var levelName = (levelId && state.levels[levelId]) ? state.levels[levelId].name : '';
      var startMsg = { type: 'start', levelId: levelId, levelName: levelName, roster: state.netRoster };
      if (state.useLan) {
        lanSend(startMsg);
        try {
          fetch(lanBaseUrl() + '/roommeta', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room: state.roomCode, host: state.playerName || 'القائد', players: (state.netRoster || []).length, playing: true })
          });
        } catch (e) {}
      }
      else broadcastToAll(startMsg);
    }
    // send first poses quickly after start
    if (state.playType === 'online') {
      setTimeout(function () { try { sendMyPose(); } catch (e) {} }, 100);
      setTimeout(function () { try { sendMyPose(); } catch (e) {} }, 400);
    }
    if (levelId) {
      setTimeout(function () { if (typeof runLevelScripts === 'function') runLevelScripts(levelId); }, 100);
    }
    toast('بدء اللعب!' + (state.playType === 'online' ? ' (' + (state.netRoster || []).length + ' لاعبين)' : ''), 'success');
  }

  // ===== INPUT =====
  window.addEventListener('keydown', function (e) {
    state.keys[e.code] = true;
    if (e.code === 'KeyE' && state.mode === 'play') {
      tryToggleVehicle(players[0]);
    }
    if (e.code === 'Escape') {
      if (state.mode === 'build') {
        // save and go menu
        if (state.currentLevelId && state.levels[state.currentLevelId]) {
          state.levels[state.currentLevelId].objects = serializeObjects();
          saveRespawnsFromMarkers();
        }
        state.respawnPlaceMode = null;
        var rpEsc = document.getElementById('respawn-choice-panel');
        if (rpEsc) rpEsc.classList.add('hidden');
        showScreen('menu');
      } else if (state.mode === 'lobby') {
        showScreen('menu');
      }
      // play mode Escape handled by pause listener (capture)
    }
    if (e.code === 'ControlLeft' || e.code === 'ControlRight') {
      if (state.mode === 'build') { e.preventDefault(); toggleFlyMode(); }
      if (state.mode === 'play') {
        e.preventDefault();
        state.mouseHidden = !state.mouseHidden;
        if (state.mouseHidden) { document.body.style.cursor = 'none'; canvas.requestPointerLock && canvas.requestPointerLock(); }
        else { document.body.style.cursor = 'default'; document.exitPointerLock && document.exitPointerLock(); }
      }
    }
  });
  window.addEventListener('keyup', function (e) { state.keys[e.code] = false; });

  window.addEventListener('mousemove', function (e) {
    if (state.mode === 'build' && state.flyMode) {
      state.flyYaw -= e.movementX * state.mouseSens;
      // Mouse up = look up (fixed invert)
      state.flyPitch -= e.movementY * (state.mouseSens * 0.8); // mouse up = look up
      state.flyPitch = Math.max(-1.2, Math.min(1.2, state.flyPitch));
    } else if (state.mode === 'build') {
      onBuildMove(e);
    }
    if (state.mode === 'play' && players[0].group && (state.mouseHidden || document.pointerLockElement === canvas)) {
      // Only pause P0 movement when P0 has menu; still block look if P0 paused
      if (state.paused && state.pauseOwner === 0) return;
      var sens0 = 0.0005 * (players[0].settings.sens || 5);
      players[0].yaw -= e.movementX * sens0;
    }
  });
  window.addEventListener('mousedown', function (e) {
    if (state.mode !== 'build' || state.flyMode) return;
    if (e.button !== 0) return;
    if (e.target.closest && (e.target.closest('#obj-toolbar') || e.target.closest('.hierarchy-panel') || e.target.closest('.build-toolbar') || e.target.closest('.build-sidebar-wrap') || e.target.closest('.level-panel') || e.target.closest('#respawn-choice-panel'))) return;
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, buildCamera);
    if (selectedBuildObj && transformGizmo && (objToolMode === 'move' || objToolMode === 'scale')) {
      var axisHit = pickGizmo(raycaster);
      if (axisHit) {
        e.preventDefault();
        e.stopPropagation();
        try { if (e.target && e.target.setPointerCapture) e.target.setPointerCapture(e.pointerId); } catch (err) {}
        var origin = selectedBuildObj.position.clone();
        var axisDir = new THREE.Vector3(
          axisHit === 'x' ? 1 : 0,
          axisHit === 'y' ? 1 : 0,
          axisHit === 'z' ? 1 : 0
        );
        var hitPoint = null;
        var hitsG = raycaster.intersectObject(transformGizmo, true);
        if (hitsG.length) hitPoint = hitsG[0].point.clone();
        gizmoDrag = {
          axis: axisHit,
          mode: objToolMode,
          startX: e.clientX,
          startY: e.clientY,
          startPos: selectedBuildObj.position.clone(),
          startScale: selectedBuildObj.scale.clone(),
          origin: origin,
          axisDir: axisDir,
          startPointerDist: 0,
          grabbed: true
        };
        if (hitPoint) {
          var toHit = hitPoint.clone().sub(origin);
          gizmoDrag.startPointerDist = toHit.dot(axisDir);
        }
        var cam = buildCamera;
        var axisEnd = origin.clone().add(axisDir);
        var a0 = origin.clone().project(cam);
        var a1 = axisEnd.clone().project(cam);
        gizmoDrag.screenAxis = new THREE.Vector2(a1.x - a0.x, a1.y - a0.y);
        if (gizmoDrag.screenAxis.length() > 1e-6) gizmoDrag.screenAxis.normalize();
        else gizmoDrag.screenAxis.set(1, 0);
        setGizmoHover(axisHit);
        document.body.style.cursor = 'grabbing';
        return;
      }
    }
  }, true);
  window.addEventListener('click', function (e) {
    if (state.mode === 'build' && !state.flyMode) {
      // If we just finished a gizmo drag, ignore the click selection
      if (state._gizmoJustDragged) {
        state._gizmoJustDragged = false;
        return;
      }
      onBuildClick(e);
    }
  });
  window.addEventListener('mouseup', function () {
    if (gizmoDrag && gizmoDrag.grabbed) {
      state._gizmoJustDragged = true;
      document.body.style.cursor = '';
    }
    gizmoDrag = null;
    if (typeof setGizmoHover === 'function') setGizmoHover(null);
  });
  window.addEventListener('gamepadconnected', function (e) {
    document.getElementById('gamepad-hint').textContent = 'دراعة: ' + e.gamepad.id + ' — اضغط ✕';
  });


  // ===== HIERARCHY =====
  var selectedHierarchyObj = null;
  var moveModeObj = null;
  var selectedBuildObj = null;
  var isDraggingObj = false;
  var objToolMode = null; // move | rotate | scale
  var dragOffset = new THREE.Vector3();
  var originalMaterials = [];



  function clearObjectHighlight(obj) {
    if (!obj || !obj.userData._hlMats) return;
    obj.userData._hlMats.forEach(function (o) {
      if (o.color && o.mat.color) o.mat.color.copy(o.color);
      if (o.emissive && o.mat.emissive) {
        o.mat.emissive.copy(o.emissive);
        o.mat.emissiveIntensity = o.ei || 0;
      }
    });
    delete obj.userData._hlMats;
  }

  function setObjectHighlight(obj, lightGreen) {
    if (!obj) return;
    clearObjectHighlight(obj);
    var saved = [];
    obj.traverse(function (child) {
      if (child.isMesh && child.material) {
        var mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(function (m) {
          // clone material so we don't affect other instances
          var cloned = m.clone();
          child.material = Array.isArray(child.material) ? child.material.map(function (mm) { return mm === m ? cloned : mm; }) : cloned;
          saved.push({
            mat: cloned,
            color: cloned.color ? cloned.color.clone() : null,
            emissive: cloned.emissive ? cloned.emissive.clone() : null,
            ei: cloned.emissiveIntensity
          });
          if (cloned.color) cloned.color.lerp(new THREE.Color(0x66ff88), 0.35);
          if (cloned.emissive) {
            cloned.emissive.set(0x22aa44);
            cloned.emissiveIntensity = 0.25;
          }
        });
      }
    });
    obj.userData._hlMats = saved;
  }


  // ===== Transform Gizmo (move / scale axes) =====
  var transformGizmo = null;
  var gizmoDrag = null; // { axis, mode, startMouse, startPos, startScale }
  var gizmoHoverAxis = null;

  function makeAxisArrow(color, axis) {
    var g = new THREE.Group();
    g.userData.gizmoAxis = axis;
    g.userData.isGizmo = true;
    var mat = new THREE.MeshBasicMaterial({ color: color, depthTest: false, depthWrite: false, transparent: true, opacity: 0.98 });
    mat.toneMapped = false;
    var shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 1.35, 10), mat);
    var head = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.35, 12), mat.clone());
    shaft.renderOrder = 1000;
    head.renderOrder = 1000;
    if (axis === 'x') {
      shaft.rotation.z = -Math.PI / 2;
      shaft.position.x = 0.7;
      head.rotation.z = -Math.PI / 2;
      head.position.x = 1.45;
    } else if (axis === 'y') {
      shaft.position.y = 0.7;
      head.position.y = 1.45;
    } else {
      shaft.rotation.x = Math.PI / 2;
      shaft.position.z = 0.7;
      head.rotation.x = Math.PI / 2;
      head.position.z = 1.45;
    }
    shaft.userData.gizmoAxis = axis;
    shaft.userData.isGizmo = true;
    head.userData.gizmoAxis = axis;
    head.userData.isGizmo = true;
    g.add(shaft);
    g.add(head);
    // fat invisible collider so mouse easy to grab
    var pickMat = new THREE.MeshBasicMaterial({ visible: false });
    var pick = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 2.2, 8), pickMat);
    pick.rotation.copy(shaft.rotation);
    pick.position.copy(shaft.position);
    pick.userData.gizmoAxis = axis;
    pick.userData.isGizmo = true;
    g.add(pick);
    return g;
  }

  function makeScaleHandle(color, axis) {
    var g = new THREE.Group();
    g.userData.gizmoAxis = axis;
    g.userData.isGizmo = true;
    var mat = new THREE.MeshBasicMaterial({ color: color, depthTest: false, depthWrite: false, transparent: true, opacity: 0.98 });
    mat.toneMapped = false;
    var box = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), mat);
    box.renderOrder = 1000;
    if (axis === 'x') box.position.x = 1.25;
    else if (axis === 'y') box.position.y = 1.25;
    else box.position.z = 1.25;
    box.userData.gizmoAxis = axis;
    box.userData.isGizmo = true;
    g.add(box);
    var line = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.1, 8), mat.clone());
    line.renderOrder = 1000;
    if (axis === 'x') { line.rotation.z = -Math.PI / 2; line.position.x = 0.55; }
    else if (axis === 'y') { line.position.y = 0.55; }
    else { line.rotation.x = Math.PI / 2; line.position.z = 0.55; }
    line.userData.gizmoAxis = axis;
    line.userData.isGizmo = true;
    g.add(line);
    var pickMat = new THREE.MeshBasicMaterial({ visible: false });
    var pick = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), pickMat);
    pick.position.copy(box.position);
    pick.userData.gizmoAxis = axis;
    pick.userData.isGizmo = true;
    g.add(pick);
    return g;
  }

  function disposeGizmo() {
    if (!transformGizmo) return;
    scene.remove(transformGizmo);
    transformGizmo.traverse(function (c) {
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    });
    transformGizmo = null;
    gizmoDrag = null;
    gizmoHoverAxis = null;
    try { document.body.style.cursor = ''; } catch (e) {}
  }

  function rebuildGizmo() {
    disposeGizmo();
    if (!selectedBuildObj || state.mode !== 'build') return;
    var mode = objToolMode || 'move';
    if (mode !== 'move' && mode !== 'scale') return;
    var root = new THREE.Group();
    root.userData.isGizmo = true;
    root.renderOrder = 999;
    if (mode === 'move') {
      root.add(makeAxisArrow(0xff3333, 'x'));
      root.add(makeAxisArrow(0x33ff66, 'y'));
      root.add(makeAxisArrow(0x3388ff, 'z'));
    } else {
      // scale
      root.add(makeScaleHandle(0xff3333, 'x'));
      root.add(makeScaleHandle(0x33ff66, 'y'));
      root.add(makeScaleHandle(0x3388ff, 'z'));
    }
    transformGizmo = root;
    scene.add(transformGizmo);
    syncGizmoTransform();
  }

  function syncGizmoTransform() {
    if (!transformGizmo || !selectedBuildObj) return;
    transformGizmo.position.copy(selectedBuildObj.position);
    // keep gizmo readable size relative to camera distance
    var dist = buildCamera.position.distanceTo(selectedBuildObj.position);
    var s = Math.max(0.85, Math.min(3.2, dist * 0.1));
    transformGizmo.scale.set(s, s, s);
  }

  function pickGizmo(raycaster) {
    if (!transformGizmo) return null;
    var hits = raycaster.intersectObject(transformGizmo, true);
    if (!hits.length) return null;
    // nearest hit with axis
    for (var i = 0; i < hits.length; i++) {
      var o = hits[i].object;
      var guard = 0;
      while (o && !o.userData.gizmoAxis && guard++ < 8) o = o.parent;
      if (o && o.userData.gizmoAxis) return o.userData.gizmoAxis;
    }
    return null;
  }

  function setGizmoHover(axis) {
    if (!transformGizmo) { gizmoHoverAxis = null; return; }
    if (gizmoHoverAxis === axis) return;
    gizmoHoverAxis = axis;
    transformGizmo.children.forEach(function (child) {
      var ax = child.userData && child.userData.gizmoAxis;
      var active = ax && axis && ax === axis;
      child.traverse(function (c) {
        if (!c.isMesh || !c.material || c.material.visible === false) return;
        if (c.userData && c.userData.isGizmo && c.material.color) {
          // restore base color from axis
          var base = ax === 'x' ? 0xff3333 : (ax === 'y' ? 0x33ff66 : 0x3388ff);
          if (active) {
            c.material.color.setHex(0xffffff);
            c.material.opacity = 1;
            if (c.geometry && c.geometry.type === 'CylinderGeometry') {
              // thicken shaft slightly via scale
              c.scale.set(1.55, 1, 1.55);
            } else if (c.geometry && (c.geometry.type === 'ConeGeometry' || c.geometry.type === 'BoxGeometry')) {
              c.scale.set(1.35, 1.35, 1.35);
            }
          } else {
            c.material.color.setHex(base);
            c.material.opacity = 0.98;
            c.scale.set(1, 1, 1);
          }
        }
      });
    });
    document.body.style.cursor = axis ? 'grab' : '';
  }

  function selectBuildObject(obj) {
    if (selectedBuildObj && selectedBuildObj !== obj) {
      clearObjectHighlight(selectedBuildObj);
    }
    selectedBuildObj = obj;
    selectedHierarchyObj = obj;
    isDraggingObj = false;
    objToolMode = obj ? 'move' : null;
    if (obj) {
      setObjectHighlight(obj, true);
      showObjToolbar(obj);
      rebuildGizmo();
    } else {
      hideObjToolbar();
      disposeGizmo();
    }
    refreshHierarchy();
    updateScaleModeButtons();
  }

  function showObjToolbar(obj) {
    var tb = document.getElementById('obj-toolbar');
    if (!tb || !obj) return;
    tb.classList.remove('hidden');
    // position above object in screen space
    updateObjToolbarPos();
    tb.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-action') === objToolMode);
    });
  }

  function hideObjToolbar() {
    var tb = document.getElementById('obj-toolbar');
    if (tb) tb.classList.add('hidden');
  }

  function updateObjToolbarPos() {
    var tb = document.getElementById('obj-toolbar');
    if (!tb || !selectedBuildObj || tb.classList.contains('hidden')) return;
    var pos = selectedBuildObj.position.clone();
    pos.y += 2.5;
    pos.project(buildCamera);
    var x = (pos.x * 0.5 + 0.5) * window.innerWidth;
    var y = (-pos.y * 0.5 + 0.5) * window.innerHeight;
    tb.style.left = (x - 90) + 'px';
    tb.style.top = (y - 50) + 'px';
  }

  function updateScaleModeButtons() {
    var tb = document.getElementById('obj-toolbar');
    if (!tb) return;
    var show = objToolMode === 'scale';
    tb.querySelectorAll('.scale-mode-btn').forEach(function (b) {
      if (show) b.classList.remove('hidden');
      else b.classList.add('hidden');
      var act = b.getAttribute('data-action');
      if (act === 'scale-uniform') b.classList.toggle('active', state.scaleMode === 'uniform');
      if (act === 'scale-axis') b.classList.toggle('active', state.scaleMode === 'axis');
    });
  }

  function bindObjToolbar() {
    var tb = document.getElementById('obj-toolbar');
    if (!tb) return;
    tb.querySelectorAll('button').forEach(function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        var action = btn.getAttribute('data-action');
        if (!selectedBuildObj) return;
        if (action === 'delete') {
          disposeGizmo();
          scene.remove(selectedBuildObj);
          state.buildObjects = state.buildObjects.filter(function (o) { return o !== selectedBuildObj; });
          selectBuildObject(null);
          document.getElementById('object-count').textContent = state.buildObjects.length + ' عنصر';
          refreshHierarchy();
          toast('تم الحذف', 'success');
          return;
        }
        if (action === 'scale-uniform') {
          state.scaleMode = 'uniform';
          updateScaleModeButtons();
          toast('تكبير كلي (كل المحاور معاً)', 'info');
          return;
        }
        if (action === 'scale-axis') {
          state.scaleMode = 'axis';
          updateScaleModeButtons();
          toast('تكبير محاور (X / Y / Z منفصل)', 'info');
          return;
        }
        objToolMode = action;
        isDraggingObj = false;
        gizmoDrag = null;
        tb.querySelectorAll('button').forEach(function (b) {
          var a = b.getAttribute('data-action');
          if (a === 'scale-uniform' || a === 'scale-axis') return;
          b.classList.toggle('active', a === action);
        });
        updateScaleModeButtons();
        rebuildGizmo();
        var labels = { move: 'وضع التحريك — اسحب الأسهم', rotate: 'وضع الدوران', scale: 'وضع التكبير — اسحب المقابض' };
        toast(labels[action] || action, 'info');
      };
    });
  }


  function refreshHierarchy() {
    var list = document.getElementById('hierarchy-list');
    if (!list) return;
    list.innerHTML = '';
    // Group by buildId
    var groups = {};
    state.buildObjects.forEach(function (obj, idx) {
      var id = obj.userData.buildId || 'unknown';
      if (!groups[id]) groups[id] = { name: (obj.userData.catalogItem && obj.userData.catalogItem.name) || id, items: [] };
      groups[id].items.push({ obj: obj, idx: idx });
    });
    Object.keys(groups).forEach(function (gid) {
      var g = groups[gid];
      var groupEl = document.createElement('div');
      groupEl.className = 'hierarchy-group';
      var title = document.createElement('div');
      title.className = 'hierarchy-group-title';
      title.innerHTML = '<span>' + g.name + ' (' + g.items.length + ')</span><span>▸</span>';
      var children = document.createElement('div');
      children.className = 'hierarchy-children';
      title.onclick = function () {
        var open = children.classList.toggle('open');
        title.classList.toggle('open', open);
        title.querySelector('span:last-child').textContent = open ? '▾' : '▸';
      };
      g.items.forEach(function (entry) {
        var item = document.createElement('div');
        item.className = 'hierarchy-item';
        item.textContent = entry.obj.userData.instanceName || g.name;
        item.ondblclick = function () {
          focusOnObject(entry.obj);
          selectBuildObject(entry.obj);
          isDraggingObj = true;
          objToolMode = 'move';
        };
        item.oncontextmenu = function (e) {
          e.preventDefault();
          e.stopPropagation();
          selectedHierarchyObj = entry.obj;
          showContextMenu(e.clientX, e.clientY, item);
          // Don't full refresh - keep menu open; just mark selected visually
          document.querySelectorAll('.hierarchy-item.selected').forEach(function (el) { el.classList.remove('selected'); });
          item.classList.add('selected');
        };
        item.onclick = function () {
          selectBuildObject(entry.obj);
        };
        if (selectedBuildObj === entry.obj || selectedHierarchyObj === entry.obj) item.classList.add('selected');
        children.appendChild(item);
      });
      groupEl.appendChild(title);
      groupEl.appendChild(children);
      list.appendChild(groupEl);
    });
    if (!Object.keys(groups).length) {
      list.innerHTML = '<div style="color:#8e9aaf;font-size:0.8rem;padding:8px">لا توجد كائنات</div>';
    }
  }

  function showContextMenu(x, y, anchorEl) {
    var menu = document.getElementById('context-menu');
    if (!menu) return;
    var title = document.getElementById('ctx-title');
    if (title && selectedHierarchyObj) {
      title.textContent = selectedHierarchyObj.userData.instanceName || selectedHierarchyObj.userData.buildId || 'كائن';
    }
    // Mark active item
    document.querySelectorAll('.hierarchy-item.ctx-active').forEach(function (el) { el.classList.remove('ctx-active'); });
    if (anchorEl) anchorEl.classList.add('ctx-active');

    menu.classList.remove('hidden');
    // Position next to the item
    if (anchorEl) {
      var rect = anchorEl.getBoundingClientRect();
      var menuW = 160;
      var left = rect.right + 8;
      if (left + menuW > window.innerWidth) left = rect.left - menuW - 8;
      var top = rect.top;
      if (top + 220 > window.innerHeight) top = window.innerHeight - 230;
      menu.style.left = left + 'px';
      menu.style.top = top + 'px';
    } else {
      menu.style.left = x + 'px';
      menu.style.top = y + 'px';
    }
  }
  function hideContextMenu() {
    var menu = document.getElementById('context-menu');
    if (menu) menu.classList.add('hidden');
    document.querySelectorAll('.hierarchy-item.ctx-active').forEach(function (el) { el.classList.remove('ctx-active'); });
  }

  // Close only when clicking outside menu and hierarchy
  document.addEventListener('click', function (e) {
    var menu = document.getElementById('context-menu');
    if (!menu || menu.classList.contains('hidden')) return;
    if (menu.contains(e.target)) return;
    if (e.target.closest && e.target.closest('.hierarchy-item')) return;
    hideContextMenu();
  });

  // Context menu actions - bind after DOM ready in init
  function highlightObject(obj, durationMs) {
    if (!obj) return;
    var originals = [];
    obj.traverse(function (child) {
      if (child.isMesh && child.material) {
        var mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(function (m) {
          originals.push({ mat: m, color: m.color ? m.color.clone() : null, emissive: m.emissive ? m.emissive.clone() : null, ei: m.emissiveIntensity });
          if (m.color) m.color.set(0x00ff44);
          if (m.emissive) { m.emissive.set(0x00ff44); m.emissiveIntensity = 0.6; }
        });
      }
    });
    setTimeout(function () {
      originals.forEach(function (o) {
        if (o.color && o.mat.color) o.mat.color.copy(o.color);
        if (o.emissive && o.mat.emissive) {
          o.mat.emissive.copy(o.emissive);
          o.mat.emissiveIntensity = o.ei || 0;
        }
      });
    }, durationMs || 2000);
  }

  function focusOnObject(obj) {
    if (!obj) return;
    var p = obj.position;
    state.flyPos.set(p.x + 8, Math.max(p.y + 6, 6), p.z + 8);
    buildCamera.position.copy(state.flyPos);
    buildCamera.lookAt(p.x, p.y + 1, p.z);
  }

  function bindContextMenu() {
    var rn = document.getElementById('ctx-rename');
    var mv = document.getElementById('ctx-move');
    var dl = document.getElementById('ctx-delete');
    var gt = document.getElementById('ctx-goto');
    var hl = document.getElementById('ctx-highlight');

    if (gt) gt.onclick = function (e) {
      e.stopPropagation();
      if (!selectedHierarchyObj) return;
      focusOnObject(selectedHierarchyObj);
      selectBuildObject(selectedHierarchyObj);
      isDraggingObj = true;
      objToolMode = 'move';
      hideContextMenu();
      toast('حرّك ثم اضغط للتثبيت', 'info');
    };
    if (hl) hl.onclick = function (e) {
      e.stopPropagation();
      if (!selectedHierarchyObj) return;
      highlightObject(selectedHierarchyObj, 2000);
      hideContextMenu();
    };
    if (rn) rn.onclick = function (e) {
      e.stopPropagation();
      if (!selectedHierarchyObj) return;
      var obj = selectedHierarchyObj;
      hideContextMenu();
      askName('الاسم الجديد:', obj.userData.instanceName || '', function (newName) {
        if (newName) {
          obj.userData.instanceName = newName;
          refreshHierarchy();
          toast('تم التغيير إلى: ' + newName, 'success');
        }
      });
    };
    if (mv) mv.onclick = function (e) {
      e.stopPropagation();
      if (!selectedHierarchyObj) return;
      moveModeObj = selectedHierarchyObj;
      toast('اضغط على الأرض لنقل الكائن', 'info');
      hideContextMenu();
    };
    if (dl) dl.onclick = function (e) {
      e.stopPropagation();
      if (!selectedHierarchyObj) return;
      scene.remove(selectedHierarchyObj);
      state.buildObjects = state.buildObjects.filter(function (o) { return o !== selectedHierarchyObj; });
      selectedHierarchyObj = null;
      document.getElementById('object-count').textContent = state.buildObjects.length + ' عنصر';
      refreshHierarchy();
      hideContextMenu();
    };
    var ref = document.getElementById('btn-refresh-hierarchy');
    if (ref) ref.onclick = refreshHierarchy;

    // Prevent menu from closing when clicking inside it
    var menu = document.getElementById('context-menu');
    if (menu) {
      menu.addEventListener('click', function (e) { e.stopPropagation(); });
      menu.addEventListener('contextmenu', function (e) { e.preventDefault(); e.stopPropagation(); });
    }
  }

  // Patch onBuildClick for move mode
  var _origOnBuildClick = null;

  // ===== CUSTOMIZATION =====
  var customOptions = {
    hat: ['بدون','قبعة بيسبول','كاب','طاقية','برنيطة','خوذة','تاج','عمامة','قبعة شتوية','قبعة سفر'],
    glasses: ['بدون','نظارة شمس','نظارة طبية','نظارة رياضية','نظارة طيار','مونوكل','نظارة سباحة','نظارة VR','نظارة أنيقة','نظارة مستطيلة'],
    shirt: ['عادي','بولو','هودي','جاكيت','قميص رسمي','تيشيرت رياضي','درع','سترة','قميص كاروهات','تيشيرت طويل'],
    pants: ['عادي','جينز','شورت','رياضي','رسمي','بضاعة','عسكري','واسع','ضيق','بجامة'],
    shoes: ['عادي','رياضي','بوت','صندل','رسمي','كعب','عسكري','جزم مطر','شبشب','حذاء تسلق']
  };
  var playerCustom = [
    { hat: 0, glasses: 0, shirt: 0, pants: 0, shoes: 0, colorHat: '#333333', colorGlasses: '#111111', colorShirt: '#1e40af', colorPants: '#1a252f', colorShoes: '#111111' },
    { hat: 0, glasses: 0, shirt: 0, pants: 0, shoes: 0, colorHat: '#333333', colorGlasses: '#111111', colorShirt: '#b91c1c', colorPants: '#1a252f', colorShoes: '#111111' }
  ];

  function fillCustomSelects() {
    ['hat','glasses','shirt','pants','shoes'].forEach(function (key) {
      var sel = document.getElementById('custom-' + key);
      if (!sel) return;
      sel.innerHTML = '';
      customOptions[key].forEach(function (name, i) {
        var opt = document.createElement('option');
        opt.value = i; opt.textContent = name;
        sel.appendChild(opt);
      });
    });
  }

  function applyCustomToUI(playerIdx) {
    var c = playerCustom[playerIdx];
    var map = { hat: 'custom-hat', glasses: 'custom-glasses', shirt: 'custom-shirt', pants: 'custom-pants', shoes: 'custom-shoes' };
    var cmap = { hat: 'color-hat', glasses: 'color-glasses', shirt: 'color-shirt', pants: 'color-pants', shoes: 'color-shoes' };
    Object.keys(map).forEach(function (k) {
      var s = document.getElementById(map[k]); if (s) s.value = c[k];
      var col = document.getElementById(cmap[k]); if (col) col.value = c['color' + k.charAt(0).toUpperCase() + k.slice(1)] || c['color' + k[0].toUpperCase() + k.slice(1)];
    });
    // fix color keys
    if (document.getElementById('color-hat')) document.getElementById('color-hat').value = c.colorHat;
    if (document.getElementById('color-glasses')) document.getElementById('color-glasses').value = c.colorGlasses;
    if (document.getElementById('color-shirt')) document.getElementById('color-shirt').value = c.colorShirt;
    if (document.getElementById('color-pants')) document.getElementById('color-pants').value = c.colorPants;
    if (document.getElementById('color-shoes')) document.getElementById('color-shoes').value = c.colorShoes;
  }

  function readCustomFromUI(playerIdx) {
    var c = playerCustom[playerIdx];
    c.hat = parseInt(document.getElementById('custom-hat').value) || 0;
    c.glasses = parseInt(document.getElementById('custom-glasses').value) || 0;
    c.shirt = parseInt(document.getElementById('custom-shirt').value) || 0;
    c.pants = parseInt(document.getElementById('custom-pants').value) || 0;
    c.shoes = parseInt(document.getElementById('custom-shoes').value) || 0;
    c.colorHat = document.getElementById('color-hat').value;
    c.colorGlasses = document.getElementById('color-glasses').value;
    c.colorShirt = document.getElementById('color-shirt').value;
    c.colorPants = document.getElementById('color-pants').value;
    c.colorShoes = document.getElementById('color-shoes').value;
  }

  function bindCustomUI() {
    fillCustomSelects();
    var sel = document.getElementById('custom-player-select');
    if (sel) {
      sel.onchange = function () {
        applyCustomToUI(parseInt(sel.value) || 0);
      };
    }
    ['custom-hat','custom-glasses','custom-shirt','custom-pants','custom-shoes','color-hat','color-glasses','color-shirt','color-pants','color-shoes'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.onchange = function () {
        var idx = 0;
        if (state.playType === 'split') {
          idx = parseInt(document.getElementById('custom-player-select').value) || 0;
        }
        // Online: always only own clothes (slot 0)
        readCustomFromUI(idx);
        if (state.playType === 'online' && state.myNetId && typeof playerCustom !== 'undefined') {
          var msg = { type: 'custom', id: state.myNetId, custom: playerCustom[0], name: state.playerName };
          if (state.netRoster) {
            state.netRoster.forEach(function (r) {
              if (r.id === state.myNetId) r.custom = playerCustom[0];
            });
          }
          if (state.useLan) lanSend(msg);
          else if (state.isHost) broadcastToAll(msg);
          else if (state.connection) try { state.connection.send(msg); } catch (e) {}
        }
      };
    });
    applyCustomToUI(0);
  }

  function configureCustomUIForMode() {
    var row = document.getElementById('custom-player-row');
    var sel = document.getElementById('custom-player-select');
    var hint = document.getElementById('custom-owner-hint');
    if (state.playType === 'online') {
      if (row) row.style.display = 'none';
      if (sel) {
        sel.innerHTML = '<option value="0">ملابسي</option>';
        sel.value = '0';
        sel.disabled = true;
      }
      if (hint) hint.textContent = 'تعدل ملابسك أنت فقط — مش تقدر تغيّر لبس حد تاني';
      applyCustomToUI(0);
    } else {
      if (row) row.style.display = '';
      if (sel) {
        sel.disabled = false;
        sel.innerHTML = '<option value="0">' + (state.playerName || 'اللاعب 1') + '</option><option value="1">اللاعب 2</option>';
        sel.value = '0';
      }
      if (hint) hint.textContent = 'Split: اختر اللاعب عشان تعدّل ملابسه (نفس الجهاز)';
      applyCustomToUI(0);
    }
  }


  // ===== UI =====
  var _bgl = document.getElementById('btn-go-lobby'); if (_bgl) _bgl.onclick = function () { showUI('story-choice'); };
  document.getElementById('btn-build-mode').onclick = function () {
    if (state.playType === 'online' && !state.isHost && state.peer) {
      toast('المنضم يقدر يعدل ملابسه فقط — البناء للقائد/وضع المطور المنفصل', 'error');
      return;
    }
    showScreen('build');
  };
  document.getElementById('btn-start-game').onclick = startGame;
  document.getElementById('btn-leave-lobby').onclick = function () {
    if (state.playType === 'online' && state.myNetId) {
      var leaveMsg = { type: 'leave', id: state.myNetId, name: state.playerName || 'لاعب', isHost: !!state.isHost };
      if (state.useLan) {
        lanSend(leaveMsg);
        if (state.isHost) {
          try {
            fetch(lanBaseUrl() + '/roommeta', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ room: state.roomCode, close: true })
            });
          } catch (e) {}
        }
      } else broadcastToAll(leaveMsg);
    }
    stopLanPoll();
    if (state.peer) try { state.peer.destroy(); } catch (e) {}
    state.peer = null; state.connection = null; state.connections = [];
    state.player2Joined = false; state.netRoster = []; state.myNetId = null;
    state.useLan = false;
    state.remoteTargets = {};
    clearRemoteMeshes();
    showScreen('menu');
  };

  // Notify others if tab closes mid-game
  window.addEventListener('beforeunload', function () {
    if (state.playType === 'online' && state.myNetId && state.useLan) {
      try {
        var payload = JSON.stringify({
          room: state.roomCode,
          data: { type: 'leave', id: state.myNetId, name: state.playerName || 'لاعب', isHost: !!state.isHost }
        });
        if (navigator.sendBeacon) {
          navigator.sendBeacon(lanBaseUrl() + '/send', new Blob([payload], { type: 'application/json' }));
          if (state.isHost) {
            navigator.sendBeacon(lanBaseUrl() + '/roommeta', new Blob([JSON.stringify({ room: state.roomCode, close: true })], { type: 'application/json' }));
          }
        }
      } catch (e) {}
    }
  });
  document.getElementById('btn-exit-build').onclick = function () {
    if (state.currentLevelId && state.levels[state.currentLevelId]) {
      state.levels[state.currentLevelId].objects = serializeObjects();
      saveRespawnsFromMarkers();
    }
    state.respawnPlaceMode = null;
    var rp = document.getElementById('respawn-choice-panel');
    if (rp) rp.classList.add('hidden');
    showScreen('menu');
  };
  document.getElementById('btn-download-data').onclick = downloadAllAsZip;
  document.getElementById('btn-save-level').onclick = saveCurrentLevel;

  // ===== RESPAWN UI =====
  var btnRespawnPlaces = document.getElementById('btn-respawn-places');
  if (btnRespawnPlaces) {
    btnRespawnPlaces.onclick = function () {
      if (!state.currentLevelId) {
        toast('أنشئ لفل أولاً', 'error');
        return;
      }
      var panel = document.getElementById('respawn-choice-panel');
      if (!panel) return;
      panel.classList.toggle('hidden');
      if (panel.classList.contains('hidden')) {
        state.respawnPlaceMode = null;
        updateRespawnHint();
      }
    };
  }
  var btnRespawnLan = document.getElementById('btn-respawn-lan');
  if (btnRespawnLan) {
    btnRespawnLan.onclick = function () {
      state.respawnPlaceMode = 'lan';
      state.selectedItem = null;
      state.currentTool = 'select';
      selectBuildObject(null);
      if (ghostMesh) { scene.remove(ghostMesh); ghostMesh = null; }
      updateRespawnHint();
      toast('وضع LAN: اضغط على الأرض لوضع نقاط خضراء (حد أقصى 8)', 'info');
    };
  }
  var btnRespawnSplit = document.getElementById('btn-respawn-split');
  if (btnRespawnSplit) {
    btnRespawnSplit.onclick = function () {
      state.respawnPlaceMode = 'split';
      state.selectedItem = null;
      state.currentTool = 'select';
      selectBuildObject(null);
      if (ghostMesh) { scene.remove(ghostMesh); ghostMesh = null; }
      updateRespawnHint();
      toast('وضع Split: اضغط على الأرض لوضع نقاط حمراء (حد أقصى 2)', 'info');
    };
  }
  var btnRespawnDone = document.getElementById('btn-respawn-done');
  if (btnRespawnDone) {
    btnRespawnDone.onclick = function () {
      state.respawnPlaceMode = null;
      saveRespawnsFromMarkers();
      var panel = document.getElementById('respawn-choice-panel');
      if (panel) panel.classList.add('hidden');
      updateRespawnHint();
      toast('تم حفظ أماكن الريسبون', 'success');
    };
  }
  document.getElementById('btn-new-level').onclick = createNewLevel;
  document.getElementById('btn-upload-all').onclick = function () { document.getElementById('upload-all-input').click(); };
  document.getElementById('upload-all-input').onchange = function (e) {
    if (e.target.files && e.target.files[0]) uploadComprehensiveZip(e.target.files[0]);
    e.target.value = '';
  };

  var toolBtns = document.querySelectorAll('.tool-btn');
  for (var t = 0; t < toolBtns.length; t++) {
    toolBtns[t].onclick = (function (btn) {
      return function () {
        for (var i = 0; i < toolBtns.length; i++) toolBtns[i].classList.remove('active');
        btn.classList.add('active');
        state.currentTool = btn.getAttribute('data-tool');
        document.getElementById('current-tool').textContent = 'أداة: ' + btn.textContent;
        updateGhost();
      };
    })(toolBtns[t]);
  }
  var catBtns = document.querySelectorAll('.cat-btn');
  for (var c = 0; c < catBtns.length; c++) {
    catBtns[c].onclick = (function (btn) {
      return function () {
        for (var i = 0; i < catBtns.length; i++) catBtns[i].classList.remove('active');
        btn.classList.add('active');
        state.currentCategory = btn.getAttribute('data-cat');
        populateSidebar();
      };
    })(catBtns[c]);
  }

  window.addEventListener('resize', function () {
    var w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    buildCamera.aspect = w / h; buildCamera.updateProjectionMatrix();
    if (players[0].camera) {
      players[0].camera.aspect = (w / 2) / h; players[0].camera.updateProjectionMatrix();
      if (players[1].camera) { players[1].camera.aspect = (w / 2) / h; players[1].camera.updateProjectionMatrix(); }
    }
  });

  // Shared cutscene camera (created once)
  var cutsceneCamera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 500);

  function animate() {
    requestAnimationFrame(animate);
    var rawDelta = Math.min(state.clock.getDelta(), 0.05);
    var delta = rawDelta * (state.script.timeScale || 1);
    var gpInput = pollGamepad();

    // FPS counter
    state._fpsFrames = (state._fpsFrames || 0) + 1;
    state._fpsAcc = (state._fpsAcc || 0) + rawDelta;
    if (state._fpsAcc >= 0.4) {
      var fps = Math.round(state._fpsFrames / state._fpsAcc);
      state._fpsFrames = 0;
      state._fpsAcc = 0;
      var fpsNet = document.getElementById('fps-counter');
      var fpsSolo = document.getElementById('fps-counter-solo');
      var fpsHud = document.getElementById('fps-hud');
      var netHud = document.getElementById('net-ping-hud');
      var online = state.playType === 'online' && state.useLan && state._lanPollActive;
      if (online) {
        if (fpsNet) fpsNet.textContent = fps + ' FPS';
        if (fpsHud) fpsHud.classList.add('hidden');
        if (netHud) netHud.classList.remove('hidden');
      } else {
        if (fpsHud) {
          fpsHud.classList.remove('hidden');
          if (fpsSolo) fpsSolo.textContent = fps + ' FPS';
        }
        if (netHud) netHud.classList.add('hidden');
      }
    }

    if (state.mode === 'play') {
      // Per-player pause: only freeze the player who opened the menu
      var p0Paused = state.paused && (state.pauseOwner === 0 || state.pauseOwner === null && state.playType !== 'split');
      var p1Paused = state.paused && (state.pauseOwner === 1 || state.pauseOwner === null && state.playType !== 'split');
      // Full pause (online / both) freezes everyone
      if (state.paused && state.playType !== 'split') { p0Paused = true; p1Paused = true; }

      if (!p0Paused) {
        updatePlayerMovement(players[0], delta, {
          up: state.keys['KeyW'], down: state.keys['KeyS'], left: state.keys['KeyA'], right: state.keys['KeyD'],
          jump: state.keys['Space'], run: state.keys['KeyF']
        });
      }
      // Split only: local player 2 via gamepad. Online: everyone is players[0] on their device
      if (state.playType === 'split' && !p1Paused && gpInput) {
        var gpScale = 0.008 * (players[1].settings.sens || 5);
        gpInput.lookX = (gpInput.lookX || 0) * (gpScale / 0.04);
        updatePlayerMovement(players[1], delta, gpInput);
      }
      if (state.paused && state.pauseOwner === 1) {
        handleGamepadMenuNav(gpInput, rawDelta);
      }
      // Network pose sync — PeerJS ~30Hz, LAN HTTP ~20Hz (lighter on lan_host)
      if (state.playType === 'online') {
        updateRemoteMeshes(delta);
        state.netPoseTimer = (state.netPoseTimer || 0) + rawDelta;
        // Steady pose rate — don't over-flood HTTP (was causing freeze after ~10s)
        // Host يرسل بثبات؛ المنضم عالي البنح يقلل إرساله
        var ping = state.netPing || 80;
        var poseInterval;
        if (!state.useLan) poseInterval = 0.033;
        else if (state.isHost) {
          poseInterval = (ping > 600) ? 0.07 : 0.04;
        } else if (ping > 900) poseInterval = 0.18;
        else if (ping > 500) poseInterval = 0.12;
        else if (ping > 250) poseInterval = 0.07;
        else poseInterval = 0.048;
        if (state.netPoseTimer >= poseInterval) {
          state.netPoseTimer = 0;
          sendMyPose();
        }
      }

      // Cutscene: full-screen cinematic camera
      if (state.script.cutscene && state.script.cutsceneCam) {
        var cc = state.script.cutsceneCam;
        var lerp = cc.lerp != null ? cc.lerp : 0.08;
        cutsceneCamera.aspect = window.innerWidth / window.innerHeight;
        cutsceneCamera.updateProjectionMatrix();
        if (cc.fov) { cutsceneCamera.fov = cc.fov; cutsceneCamera.updateProjectionMatrix(); }
        cutsceneCamera.position.lerp(new THREE.Vector3(cc.x, cc.y, cc.z), lerp);
        if (cc.lookX != null) {
          var lookTarget = new THREE.Vector3(cc.lookX, cc.lookY, cc.lookZ);
          // smooth look
          if (!cutsceneCamera.userData._look) cutsceneCamera.userData._look = lookTarget.clone();
          cutsceneCamera.userData._look.lerp(lookTarget, lerp);
          cutsceneCamera.lookAt(cutsceneCamera.userData._look);
        }
        renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
        renderer.setScissor(0, 0, window.innerWidth, window.innerHeight);
        renderer.render(scene, cutsceneCamera);
      } else if (state.playType === 'online') {
        updatePlayerCamera(players[0]);
        var w = window.innerWidth, h = window.innerHeight;
        if (players[0].camera) {
          players[0].camera.aspect = w / h;
          players[0].camera.updateProjectionMatrix();
        }
        renderer.setViewport(0, 0, w, h);
        renderer.setScissor(0, 0, w, h);
        renderer.render(scene, players[0].camera);
      } else {
        updatePlayerCamera(players[0]);
        updatePlayerCamera(players[1]);
        var w = window.innerWidth, h = window.innerHeight, half = Math.floor(w / 2);
        // P1 camera: hide own name, show P2
        setNameTagVisible(players[0].group, false);
        setNameTagVisible(players[1].group, true);
        renderer.setViewport(0, 0, half, h); renderer.setScissor(0, 0, half, h);
        renderer.render(scene, players[0].camera);
        // P2 camera: hide own name, show P1
        setNameTagVisible(players[0].group, true);
        setNameTagVisible(players[1].group, false);
        renderer.setViewport(half, 0, w - half, h); renderer.setScissor(half, 0, w - half, h);
        renderer.render(scene, players[1].camera);
      }
    } else if (state.mode === 'build') {
      if (state.flyMode) updateFlyCamera(rawDelta);
      if (selectedBuildObj) {
        updateObjToolbarPos();
        if (typeof syncGizmoTransform === 'function') syncGizmoTransform();
      }
      renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
      renderer.render(scene, buildCamera);
    } else {
      renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
      renderer.render(scene, buildCamera);
    }
  }


  
  // ===== LEVEL SYNC OVER LAN =====
  function serializeAllLevels() {
    // Save current level first
    if (state.currentLevelId && state.levels[state.currentLevelId]) {
      state.levels[state.currentLevelId].objects = serializeObjects();
    }
    var out = {};
    Object.keys(state.levels).forEach(function (id) {
      var lv = state.levels[id];
      out[id] = {
        name: lv.name,
        objects: lv.objects || [],
        scripts: (lv.scripts || []).map(function (s) { return { name: s.name, content: s.content }; }),
        // sounds can be large — still send (dataUrls)
        sounds: (lv.sounds || []).map(function (s) { return { name: s.name, dataUrl: s.dataUrl, type: s.type }; }),
        createdAt: lv.createdAt
      };
    });
    return out;
  }

  function applySyncedLevels(levelsData) {
    state.levels = {};
    Object.keys(levelsData || {}).forEach(function (id) {
      var lv = levelsData[id];
      state.levels[id] = {
        name: lv.name,
        objects: lv.objects || [],
        scripts: lv.scripts || [],
        sounds: lv.sounds || [],
        createdAt: lv.createdAt || Date.now()
      };
    });
    renderLevelsList();
    updateLobbyLevelSelect();
  }

  function showSyncLoading(textMsg) {
    var ls = document.getElementById('loading-screen');
    var lt = document.getElementById('loading-text');
    if (ls) { ls.classList.remove('hidden'); }
    if (lt) lt.textContent = textMsg || 'جاري مزامنة اللفلز...';
  }
  function hideSyncLoading() {
    var ls = document.getElementById('loading-screen');
    if (ls) ls.classList.add('hidden');
  }

  
  // ===== Pure LAN bus (no internet) via lan_host.py on host machine =====
  function normalizeLanHost(raw) {
    var s = (raw || '').trim();
    if (!s) return 'http://127.0.0.1:27100';
    // Full URL already
    if (/^https?:\/\//i.test(s)) {
      return s.replace(/\/$/, '');
    }
    // host:port
    if (s.indexOf(':') !== -1 && s.indexOf('/') === -1) {
      return 'http://' + s;
    }
    // bare domain/tunnel hostname (no port) — use as https if looks public, else http + default port
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(s) && !/^\d+\.\d+\.\d+\.\d+$/.test(s)) {
      // trycloudflare / ngrok style hostnames
      return 'https://' + s.replace(/\/$/, '');
    }
    // plain IP
    return 'http://' + s + ':' + (state.lanPort || 27100);
  }

  function lanBaseUrl() {
    return normalizeLanHost(state.lanIp || '127.0.0.1');
  }

  function stopLanPoll() {
    state._lanPollActive = false;
    if (state.lanPollTimer) {
      clearTimeout(state.lanPollTimer);
      state.lanPollTimer = null;
    }
    if (state._lanAbort) {
      try { state._lanAbort.abort(); } catch (e) {}
      state._lanAbort = null;
    }
    if (typeof hidePingHud === 'function') hidePingHud();
  }

  function lanSend(data) {
    if (!state.useLan || !state.roomCode) return;
    // Limit in-flight sends so the browser doesn't queue hundreds of hung requests
    state._lanSendInflight = state._lanSendInflight || 0;
    var maxInflight = (state.netPing > 800) ? 2 : ((state.netPing > 400) ? 3 : 5);
    if (state._lanSendInflight > maxInflight) return;
    state._lanSendInflight++;
    fetch(lanBaseUrl() + '/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: state.roomCode, data: data }),
      cache: 'no-store'
    }).then(function () {
      state._lanSendInflight = Math.max(0, state._lanSendInflight - 1);
    }).catch(function () {
      state._lanSendInflight = Math.max(0, state._lanSendInflight - 1);
    });
  }

  function updatePingHud(ms) {
    state.netPing = ms;
    var hud = document.getElementById('net-ping-hud');
    var bars = document.getElementById('wifi-bars');
    var label = document.getElementById('ping-ms');
    if (!hud || !bars || !label) return;
    if (!(state.playType === 'online' && state.useLan && state._lanPollActive)) {
      hud.classList.add('hidden');
      return;
    }
    hud.classList.remove('hidden');
    // bars: 5 best ... 1 worst
    var level = 1;
    if (ms <= 60) level = 5;
    else if (ms <= 100) level = 4;
    else if (ms <= 160) level = 3;
    else if (ms <= 250) level = 2;
    else level = 1;
    state.netPingBars = level;
    bars.className = 'wifi-bars level-' + level;
    if (level >= 4) bars.classList.add('color-green');
    else if (level >= 2) bars.classList.add('color-orange');
    else bars.classList.add('color-red');
    label.textContent = (ms > 0 ? Math.round(ms) : '--') + ' ms';
    label.style.color = level >= 4 ? '#30d158' : (level >= 2 ? '#f59e0b' : '#ff2d55');
    label.style.fontSize = '0.85rem';
  }

  function hidePingHud() {
    var hud = document.getElementById('net-ping-hud');
    if (hud) hud.classList.add('hidden');
  }

  function lanPollOnce() {
    if (!state.useLan || !state.roomCode || !state._lanPollActive) return;
    if (state._lanAbort) {
      try { state._lanAbort.abort(); } catch (e) {}
    }
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    state._lanAbort = ctrl;
    var url = lanBaseUrl() + '/poll?room=' + encodeURIComponent(state.roomCode) + '&since=' + (state.lanSince || 0);
    var finished = false;
    var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    var watchdogMs = (state.netPing > 800) ? 3500 : ((state.netPing > 400) ? 2500 : 1500);
    var watchdog = setTimeout(function () {
      if (finished) return;
      finished = true;
      if (ctrl) try { ctrl.abort(); } catch (e) {}
      if (state._lanPollActive) {
        state.lanPollTimer = setTimeout(lanPollOnce, 60);
      }
    }, watchdogMs);

    var opts = { cache: 'no-store' };
    if (ctrl) opts.signal = ctrl.signal;

    fetch(url, opts).then(function (r) { return r.json(); }).then(function (j) {
      if (finished) return;
      finished = true;
      clearTimeout(watchdog);
      var t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      // EMA smooth ping so UI doesn't jump
      var sample = t1 - t0;
      state.netPing = state.netPing ? (state.netPing * 0.7 + sample * 0.3) : sample;
      updatePingHud(state.netPing);

      // Room closed (host left / timeout)
      if (j && j.dead) {
        if (!state.isHost) {
          toast('القائد خرج — الروم اتقفل', 'error');
          stopLanPoll();
          clearRemoteMeshes && clearRemoteMeshes();
          state.useLan = false;
          state.netRoster = [];
          state.myNetId = null;
          showScreen('menu');
          showUI('main-menu');
        }
        return;
      }

      if (j && j.messages && j.messages.length) {
        j.messages.forEach(function (m) {
          if (m.id > (state.lanSince || 0)) state.lanSince = m.id;
          if (!m.data) return;
          var d = m.data;
          if (d.type === 'pose') return;
          if (d.id && d.id === state.myNetId) {
            if (d.type === 'custom' || d.type === 'leave') return;
          }
          if (d.type === 'start' && state.mode === 'play') return;
          handlePeerData(d, !!state.isHost, null);
        });
      }
      if (j && j.poses && j.poses.length) {
        j.poses.forEach(function (m) {
          if (!m || !m.data) return;
          if (m.id > (state.lanSince || 0)) state.lanSince = m.id;
          var d = m.data;
          if (d.id && d.id === state.myNetId) return;
          handlePeerData(d, !!state.isHost, null);
        });
      }

      // Host heartbeat keeps room visible in /rooms list
      state._hostBeatTimer = (state._hostBeatTimer || 0) + 1;
      if (state.isHost && state._hostBeatTimer % 8 === 0) {
        lanSend({
          type: 'hostbeat',
          isHost: true,
          id: state.myNetId,
          name: state.playerName || 'القائد',
          players: (state.netRoster || []).length || 1
        });
      }

      if (state._lanPollActive) {
        // Adaptive poll: high ping → poll slower to avoid stacking requests
        var ping = state.netPing || 80;
        var delay;
        if (ping > 600) delay = 80;
        else if (ping > 300) delay = 50;
        else if (state.isHost) delay = 25;
        else delay = 32;
        if (state.mode !== 'play') delay = Math.max(delay, 50);
        if (typeof document !== 'undefined' && document.hidden) delay = Math.max(delay, 100);
        state.lanPollTimer = setTimeout(lanPollOnce, delay);
      }
    }).catch(function () {
      if (finished) return;
      finished = true;
      clearTimeout(watchdog);
      if (state._lanPollActive) {
        var delay = (state.netPing > 500) ? 120 : 80;
        state.lanPollTimer = setTimeout(lanPollOnce, delay);
      }
    });
  }

  function startLanPoll() {
    stopLanPoll();
    state.lanSince = 0;
    state._lanSendInflight = 0;
    state._lanPollActive = true;
    lanPollOnce();
  }

  // When tab becomes visible again, kick the network hard (Chrome throttles background tabs)
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && state.useLan && state._lanPollActive) {
      if (state.lanPollTimer) { clearTimeout(state.lanPollTimer); state.lanPollTimer = null; }
      lanPollOnce();
      if (state.mode === 'play') {
        try { sendMyPose(); } catch (e) {}
      }
    }
  });

  function lanCheckHost(ip, cb) {
    var url = 'http://' + ip + ':' + (state.lanPort || 27100) + '/status';
    fetch(url, { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (j) {
      cb(!!(j && j.ok), j);
    }).catch(function () { cb(false, null); });
  }

  function broadcastToAll(msg, exceptConn) {
    if (state.isHost) {
      (state.connections || []).forEach(function (c) {
        if (c && c !== exceptConn && c.open) {
          try { c.send(msg); } catch (e) {}
        }
      });
    } else if (state.connection && state.connection.open) {
      try { state.connection.send(msg); } catch (e) {}
    }
  }

  function renderNetLobbyList() {
    var list = document.getElementById('players-list');
    if (!list) return;
    var hint = document.getElementById('net-players-hint');
    if (state.playType !== 'online') {
      if (hint) hint.style.display = 'none';
      return;
    }
    if (hint) hint.style.display = 'block';
    list.innerHTML = '';
    var roster = state.netRoster || [];
    if (!roster.length) {
      roster = [{ id: 'host', name: state.playerName || 'القائد', isHost: true }];
    }
    roster.forEach(function (p, i) {
      var card = document.createElement('div');
      card.className = 'player-card ready' + (p.isHost ? ' host' : '');
      if (p.id === state.myNetId) card.style.borderColor = '#00d4ff';
      var nameStr = (p.name || ('لاعب ' + (i + 1))) + (p.id === state.myNetId ? ' (أنت)' : '');
      card.innerHTML =
        '<div class="avatar">' + (p.isHost ? '👑' : '🎮') + '</div>' +
        '<div class="player-info">' +
        '<span class="name">' + nameStr + '</span>' +
        '<span class="status online">READY ✓</span></div>';
      // Host can kick others
      if (state.isHost && !p.isHost && p.id !== state.myNetId) {
        var kickBtn = document.createElement('button');
        kickBtn.className = 'btn-kick';
        kickBtn.textContent = 'طرد';
        kickBtn.type = 'button';
        kickBtn.onclick = (function (targetId, targetName) {
          return function (e) {
            e.stopPropagation();
            kickPlayer(targetId, targetName);
          };
        })(p.id, p.name);
        card.appendChild(kickBtn);
      }
      list.appendChild(card);
    });
    var canStart = state.isHost && roster.length >= 2;
    var btn = document.getElementById('btn-start-game');
    if (btn && state.isHost) {
      btn.disabled = !canStart;
      btn.textContent = canStart ? ('START GAME (' + roster.length + ')') : 'انتظر لاعبين...';
    }
  }

  function kickPlayer(targetId, targetName) {
    if (!state.isHost || !targetId) return;
    // Notify everyone
    var msg = { type: 'kick', id: targetId };
    if (state.useLan) lanSend(msg);
    else broadcastToAll(msg);
    // Close peer connection if any
    if (state.connections) {
      state.connections.forEach(function (c) {
        if (c._netId === targetId) {
          try { c.send({ type: 'kick', id: targetId }); } catch (e) {}
          try { c.close(); } catch (e) {}
        }
      });
      state.connections = state.connections.filter(function (c) { return c._netId !== targetId; });
    }
    // Remove from roster locally
    state.netRoster = (state.netRoster || []).filter(function (r) { return r.id !== targetId; });
    if (state.remoteMeshes[targetId]) {
      scene.remove(state.remoteMeshes[targetId]);
      delete state.remoteMeshes[targetId];
    }
    renderNetLobbyList();
    toast('تم طرد ' + (targetName || 'اللاعب'), 'info');
  }

  function clearRemoteMeshes() {
    Object.keys(state.remoteMeshes || {}).forEach(function (id) {
      var m = state.remoteMeshes[id];
      if (m) scene.remove(m);
    });
    state.remoteMeshes = {};
    state.remoteTargets = {};
  }

  function ensureRemoteMesh(netId, custom, displayName) {
    if (netId === state.myNetId) return null;
    if (state.remoteMeshes[netId]) {
      if (displayName && state.remoteMeshes[netId].userData.displayName !== displayName) {
        attachNameTag(state.remoteMeshes[netId], displayName, true);
      }
      return state.remoteMeshes[netId];
    }
    var colors = [0xb91c1c, 0x16a34a, 0xca8a04, 0x7c3aed, 0x0891b2, 0xdb2777, 0x65a30d];
    var idx = Object.keys(state.remoteMeshes).length % colors.length;
    var mesh = createCharacterMesh(colors[idx], 0xe0ac69, custom || null);
    mesh.position.set(idx * 2, 0, 2);
    var nm = displayName;
    if (!nm && state.netRoster) {
      for (var i = 0; i < state.netRoster.length; i++) {
        if (state.netRoster[i].id === netId) { nm = state.netRoster[i].name; break; }
      }
    }
    attachNameTag(mesh, nm || 'لاعب', true);
    scene.add(mesh);
    state.remoteMeshes[netId] = mesh;
    return mesh;
  }

  function applyNetPose(d) {
    if (!d || d.id === state.myNetId) return;
    var mesh = ensureRemoteMesh(d.id, d.custom, d.name);
    if (!mesh) return;
    if (d.custom && mesh.userData._customKey !== JSON.stringify(d.custom)) {
      var pos = mesh.position.clone();
      var rot = mesh.rotation.y;
      var oldName = mesh.userData.displayName;
      scene.remove(mesh);
      var neu = createCharacterMesh(0xb91c1c, 0xe0ac69, d.custom);
      neu.position.copy(pos);
      neu.rotation.y = rot;
      neu.userData._customKey = JSON.stringify(d.custom);
      attachNameTag(neu, d.name || oldName || 'لاعب', true);
      scene.add(neu);
      state.remoteMeshes[d.id] = neu;
      mesh = neu;
    } else if (d.name && mesh.userData.displayName !== d.name) {
      attachNameTag(mesh, d.name, true);
    }
    if (!state.remoteTargets) state.remoteTargets = {};
    var prev = state.remoteTargets[d.id];
    var nowT = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    // velocity from message or estimate from previous target
    var vx = (d.vx != null) ? d.vx : 0;
    var vz = (d.vz != null) ? d.vz : 0;
    if (prev && prev._t) {
      var dt = Math.max(0.016, (nowT - prev._t) / 1000);
      if (d.vx == null) vx = (d.x - prev.x) / dt;
      if (d.vz == null) vz = (d.z - prev.z) / dt;
      // clamp crazy spikes from lag spikes
      var spd = Math.sqrt(vx * vx + vz * vz);
      if (spd > 25) { vx *= 25 / spd; vz *= 25 / spd; }
    }
    state.remoteTargets[d.id] = {
      x: d.x, y: d.y || 0, z: d.z,
      yaw: (d.yaw || 0) + Math.PI,
      moving: !!d.moving,
      vx: vx, vz: vz, vy: d.vy || 0,
      _t: nowT,
      inVehicle: !!d.inVehicle,
      vehicleName: d.vehicleName || null,
      vehicleX: d.vehicleX, vehicleY: d.vehicleY, vehicleZ: d.vehicleZ,
      vehicleYaw: d.vehicleYaw
    };
    if (d.inVehicle && d.vehicleName) {
      for (var i = 0; i < state.buildObjects.length; i++) {
        var o = state.buildObjects[i];
        if (o && o.userData && o.userData.instanceName === d.vehicleName) {
          if (d.vehicleX != null) {
            o.position.x = d.vehicleX;
            o.position.y = d.vehicleY || 0;
            o.position.z = d.vehicleZ;
          }
          if (d.vehicleYaw != null) o.rotation.y = d.vehicleYaw;
          break;
        }
      }
    }
  }

  function updateRemoteMeshes(delta) {
    if (!state.remoteTargets) return;
    var ids = Object.keys(state.remoteTargets);
    var ping = state.netPing || 100;
    // With high ping, blend slower + extrapolate more so motion stays smooth
    var lagSec = Math.min(0.8, (ping / 1000) * 0.45);
    var followRate = ping > 400 ? 8 : (ping > 200 ? 14 : 22);
    var snapDist2 = ping > 400 ? 36 : 16; // only snap if very far
    var nowT = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var mesh = state.remoteMeshes[id];
      var t = state.remoteTargets[id];
      if (!mesh || !t) continue;
      // Extrapolate target forward using velocity (dead reckoning)
      var age = t._t ? Math.min(1.4, (nowT - t._t) / 1000) : 0;
      // damp velocity over time so we don't fly forever on stale data
      var damp = age > 0.5 ? Math.max(0.15, 1 - (age - 0.5) * 1.2) : 1;
      var ex = t.x + (t.vx || 0) * (age * damp + lagSec * 0.55);
      var ey = t.y;
      var ez = t.z + (t.vz || 0) * (age * damp + lagSec * 0.55);
      var dx = ex - mesh.position.x;
      var dy = ey - mesh.position.y;
      var dz = ez - mesh.position.z;
      var dist2 = dx * dx + dy * dy + dz * dz;
      if (dist2 > snapDist2) {
        // soft catch-up instead of hard teleport when laggy
        var catchUp = Math.min(1, 0.35);
        mesh.position.x += dx * catchUp;
        mesh.position.y += dy * catchUp;
        mesh.position.z += dz * catchUp;
      } else {
        var lerp = Math.min(1, followRate * delta);
        mesh.position.x += dx * lerp;
        mesh.position.y += dy * Math.min(1, (followRate + 10) * delta);
        mesh.position.z += dz * lerp;
      }
      var cy = mesh.rotation.y;
      var ty = t.yaw;
      var dYaw = ty - cy;
      while (dYaw > Math.PI) dYaw -= Math.PI * 2;
      while (dYaw < -Math.PI) dYaw += Math.PI * 2;
      mesh.rotation.y = cy + dYaw * Math.min(1, 12 * delta);
      if (t.moving && mesh.userData && mesh.userData.leftArm) {
        mesh.userData.walkCycle = (mesh.userData.walkCycle || 0) + delta * 10;
        var s = Math.sin(mesh.userData.walkCycle) * 0.5;
        mesh.userData.leftArm.rotation.x = s;
        mesh.userData.rightArm.rotation.x = -s;
        if (mesh.userData.leftLeg) mesh.userData.leftLeg.rotation.x = -s;
        if (mesh.userData.rightLeg) mesh.userData.rightLeg.rotation.x = s;
      }
    }
  }

  function sendMyPose() {
    var p = players[0];
    if (!p || !p.group || !state.myNetId) return;
    var moving = false;
    var airborne = p.group.position.y > 0.05;
    if (p.group.userData && p.group.userData._lastPos) {
      var lp = p.group.userData._lastPos;
      var dx = p.group.position.x - lp.x, dy = p.group.position.y - lp.y, dz = p.group.position.z - lp.z;
      moving = (dx * dx + dz * dz) > 0.00005 || Math.abs(dy) > 0.01;
    }
    p.group.userData._lastPos = p.group.position.clone();
    var custom = null;
    try {
      custom = (typeof playerCustom !== 'undefined') ? playerCustom[0] : null;
    } catch (e) {}
    // Only attach full custom when it changes (cuts LAN bandwidth a lot)
    var customKey = custom ? JSON.stringify(custom) : '';
    var sendCustom = null;
    if (customKey !== state._lastSentCustomKey) {
      state._lastSentCustomKey = customKey;
      sendCustom = custom;
    }
    // compact pose + velocity for high-ping extrapolation
    var px = p.group.position.x, py = p.group.position.y, pz = p.group.position.z;
    var prev = state._lastPosePos || { x: px, y: py, z: pz, t: 0 };
    var nowP = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    var dtP = Math.max(0.016, (nowP - (prev.t || nowP)) / 1000);
    var vx = (px - prev.x) / dtP;
    var vz = (pz - prev.z) / dtP;
    state._lastPosePos = { x: px, y: py, z: pz, t: nowP };
    var msg = {
      type: 'pose',
      id: state.myNetId,
      x: Math.round(px * 100) / 100,
      y: Math.round(py * 100) / 100,
      z: Math.round(pz * 100) / 100,
      yaw: Math.round(p.yaw * 1000) / 1000,
      moving: moving,
      vx: Math.round(vx * 100) / 100,
      vz: Math.round(vz * 100) / 100
    };
    if (state.isHost) msg.isHost = true;
    // name only occasionally (every ~1s) to save bandwidth
    state._nameTick = (state._nameTick || 0) + 1;
    if (state._nameTick === 1 || state._nameTick % 40 === 0) {
      msg.name = state.playerName || 'لاعب';
    }
    if (p.vehicle) {
      msg.inVehicle = true;
      msg.vehicleName = (p.vehicle.userData && p.vehicle.userData.instanceName) || null;
      msg.vehicleX = Math.round(p.vehicle.position.x * 100) / 100;
      msg.vehicleY = Math.round(p.vehicle.position.y * 100) / 100;
      msg.vehicleZ = Math.round(p.vehicle.position.z * 100) / 100;
      msg.vehicleYaw = Math.round(p.vehicle.rotation.y * 1000) / 1000;
    }
    if (sendCustom) msg.custom = sendCustom;
    // High-ping sacrifice: skip tiny movements to cut traffic
    if (state.useLan && (state.netPing || 0) > 400) {
      var lp = state._lastSentPose;
      if (lp) {
        var ddx = msg.x - lp.x, ddz = msg.z - lp.z;
        var dyaw = Math.abs((msg.yaw || 0) - (lp.yaw || 0));
        var minMove = (state.netPing > 800) ? 0.35 : 0.18;
        if (ddx * ddx + ddz * ddz < minMove * minMove && dyaw < 0.08 && !msg.inVehicle) {
          // still heartbeat occasionally
          state._poseSkip = (state._poseSkip || 0) + 1;
          if (state._poseSkip < 4) return;
        }
      }
      state._poseSkip = 0;
      state._lastSentPose = { x: msg.x, z: msg.z, yaw: msg.yaw };
    }
    if (state.useLan) {
      lanSend(msg);
    } else if (state.isHost) {
      broadcastToAll(msg);
    } else if (state.connection) {
      try { state.connection.send(msg); } catch (e) {}
    }
  }

  function handlePeerData(d, isHostSide, fromConn) {
    if (!d || !d.type) return;
    // NO levels / story data transfer — each device uses its own local comprehensive ZIP
    if (d.type === 'join') {
      if (state.isHost) {
        var newId = d.clientId || ('p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5));
        if (fromConn) {
          fromConn._netId = newId;
          fromConn._custom = d.custom || null;
        }
        if (!state.netRoster) state.netRoster = [];
        if (!state.netRoster.some(function (r) { return r.isHost; })) {
          state.netRoster.unshift({ id: state.myNetId || 'host', name: state.playerName || 'القائد', isHost: true });
        }
        // avoid duplicate join
        if (state.netRoster.some(function (r) { return r.id === newId; })) {
          if (state.useLan) lanSend({ type: 'welcome', yourId: newId, roster: state.netRoster });
          return;
        }
        if (state.netRoster.length >= state.maxNetPlayers) {
          if (fromConn) {
            try { fromConn.send({ type: 'full' }); } catch (e) {}
            try { fromConn.close(); } catch (e) {}
          }
          if (state.useLan) lanSend({ type: 'full' });
          toast('اللوبية ممتلئة (حد أقصى ' + state.maxNetPlayers + ')', 'error');
          return;
        }
        state.netRoster.push({
          id: newId,
          name: d.name || ('لاعب ' + state.netRoster.length),
          isHost: false,
          custom: d.custom
        });
        state.player2Joined = true;
        var welcome = { type: 'welcome', yourId: newId, roster: state.netRoster };
        var rosterMsg = { type: 'roster', roster: state.netRoster };
        if (state.useLan) {
          lanSend(welcome);
          lanSend(rosterMsg);
        } else {
          if (fromConn) try { fromConn.send(welcome); } catch (e) {}
          broadcastToAll(rosterMsg, fromConn);
        }
        renderNetLobbyList();
        toast('لاعب انضم! (' + state.netRoster.length + '/' + state.maxNetPlayers + ')', 'success');
        document.getElementById('gamepad-hint').textContent =
          state.netRoster.length + ' لاعبين في اللوبي — يمكنك بدء اللعب أو انتظار المزيد';
      }
    }
    if (d.type === 'welcome') {
      // CRITICAL: host must IGNORE welcome echoes on the LAN bus
      // otherwise state.myNetId becomes the joiner's id and all pose sync breaks
      if (state.isHost) {
        return;
      }
      if (d.yourId) state.myNetId = d.yourId;
      state.netRoster = d.roster || [];
      renderNetLobbyList();
      document.getElementById('gamepad-hint').textContent = 'متصل — أنت في اللوبي (' + state.netRoster.length + ' لاعبين)';
      document.getElementById('btn-start-game').disabled = true;
      document.getElementById('btn-start-game').textContent = 'في انتظار القائد...';
    }
    if (d.type === 'roster') {
      // Host already has authoritative roster; still allow refresh from self-broadcast is ok
      if (d.roster && d.roster.length) {
        state.netRoster = d.roster;
        renderNetLobbyList();
      }
    }
    if (d.type === 'full') {
      toast('اللوبية ممتلئة', 'error');
    }
    if (d.type === 'custom') {
      if (d.id && d.custom) {
        // update roster custom/name
        if (state.netRoster) {
          state.netRoster.forEach(function (r) {
            if (r.id === d.id) {
              r.custom = d.custom;
              if (d.name) r.name = d.name;
            }
          });
        }
        var mesh = state.remoteMeshes[d.id];
        if (mesh && d.custom) {
          var pos = mesh.position.clone();
          var rotY = mesh.rotation.y;
          var oldName = mesh.userData.displayName || d.name;
          scene.remove(mesh);
          var neu = createCharacterMesh(0xb91c1c, 0xe0ac69, d.custom);
          neu.position.copy(pos);
          neu.rotation.y = rotY;
          neu.userData._customKey = JSON.stringify(d.custom);
          attachNameTag(neu, d.name || oldName || 'لاعب', true);
          scene.add(neu);
          state.remoteMeshes[d.id] = neu;
        }
        renderNetLobbyList();
      }
      if (isHostSide && !state.useLan) broadcastToAll(d, fromConn);
    }
    if (d.type === 'pose') {
      applyNetPose(d);
      // PeerJS: host relays. LAN: everyone already sees the bus — no relay
      if (isHostSide && !state.useLan) broadcastToAll(d, fromConn);
    }
    if (d.type === 'kick') {
      if (d.id === state.myNetId) {
        // I was kicked
        toast('تم طردك من اللوبي', 'error');
        stopLanPoll && stopLanPoll();
        if (state.peer) try { state.peer.destroy(); } catch (e) {}
        state.peer = null; state.connection = null; state.connections = [];
        state.netRoster = []; state.myNetId = null; state.player2Joined = false;
        clearRemoteMeshes();
        closePause && closePause();
        showScreen('menu');
        showUI('main-menu');
        return;
      }
      // Someone else was kicked
      if (d.id && state.remoteMeshes[d.id]) {
        scene.remove(state.remoteMeshes[d.id]);
        delete state.remoteMeshes[d.id];
      }
      if (state.netRoster) {
        state.netRoster = state.netRoster.filter(function (r) { return r.id !== d.id; });
        renderNetLobbyList();
      }
      if (isHostSide && !state.useLan) broadcastToAll(d, fromConn);
    }
    if (d.type === 'start') {
      if (state.mode === 'play') return; // already started (host)
      var levelId = d.levelId || '';
      if (levelId && !state.levels[levelId] && d.levelName) {
        Object.keys(state.levels).forEach(function (lid) {
          if (state.levels[lid].name === d.levelName) levelId = lid;
        });
      }
      if (d.roster) state.netRoster = d.roster;
      if (levelId && state.levels[levelId]) {
        state.currentLevelId = levelId;
        loadLevelIntoScene(levelId);
      } else if (levelId) {
        state.currentLevelId = levelId;
        loadLevelIntoScene(levelId);
      } else clearBuildObjects();
      clearRespawnMarkers(); // build-only visuals
      setupPlayersForNet();
      state._lastSentCustomKey = null;
      showScreen('play');
      var labels = document.getElementById('split-labels');
      if (labels) labels.style.display = 'none';
      if (levelId) setTimeout(function () { runLevelScripts(levelId); }, 100);
      setTimeout(function () { try { sendMyPose(); } catch (e) {} }, 100);
      setTimeout(function () { try { sendMyPose(); } catch (e) {} }, 400);
    }
    if (d.type === 'exit' || d.type === 'leave') {
      var leftId = d.id;
      if (!leftId || leftId === state.myNetId) return;
      if (state.remoteMeshes[leftId]) {
        scene.remove(state.remoteMeshes[leftId]);
        delete state.remoteMeshes[leftId];
      }
      if (state.remoteTargets) delete state.remoteTargets[leftId];
      var leftName = d.name || 'لاعب';
      var leftWasHost = !!d.isHost;
      if (state.netRoster) {
        state.netRoster.forEach(function (r) {
          if (r.id === leftId) {
            leftName = r.name || leftName;
            if (r.isHost) leftWasHost = true;
          }
        });
        state.netRoster = state.netRoster.filter(function (r) { return r.id !== leftId; });
        renderNetLobbyList();
      }
      toast(leftName + ' خرج', 'info');
      // If host left, send everyone back to menu
      if (leftWasHost && !state.isHost) {
        closePause && closePause();
        clearRemoteMeshes();
        stopLanPoll && stopLanPoll();
        if (state.peer) try { state.peer.destroy(); } catch (e) {}
        state.connection = null; state.peer = null; state.connections = [];
        state.useLan = false;
        state.netRoster = [];
        state.myNetId = null;
        showScreen('menu');
        showUI('main-menu');
        toast('القائد خرج — انتهى اللوبي', 'error');
      }
    }
  }

  function setupPlayersForNet() {
    // Always control local as players[0]; remotes are separate meshes
    clearRemoteMeshes();
    players.forEach(function (p) { if (p.group) { scene.remove(p.group); p.group = null; } });
    var myCustom = null;
    try {
      if (typeof playerCustom !== 'undefined') {
        // Everyone uses slot 0 for their own clothes
        myCustom = playerCustom[0];
      }
    } catch (e) {}
    var lanSpawns = getLevelRespawnPoints('lan');
    // Assign spawn index by roster order
    var myIndex = 0;
    (state.netRoster || []).forEach(function (r, i) {
      if (r.id === state.myNetId) myIndex = i;
    });
    var mySpawn = lanSpawns[myIndex % lanSpawns.length] || { x: 0, y: 0, z: 0 };
    players[0].group = createCharacterMesh(0x1e40af, 0xe0ac69, myCustom);
    players[0].group.position.set(mySpawn.x, 0, mySpawn.z);
    players[0].yaw = 0;
    players[0].velocity.set(0, 0, 0);
    scene.add(players[0].group);
    // Local name tag exists but hidden for own camera
    attachNameTag(players[0].group, state.playerName || 'أنا', false);
    // hide unused local p2 in online
    if (players[1].group) { scene.remove(players[1].group); players[1].group = null; }
    var aspect = window.innerWidth / window.innerHeight;
    players[0].camera = new THREE.PerspectiveCamera(70, aspect, 0.1, 400);
    players[1].camera = new THREE.PerspectiveCamera(70, aspect, 0.1, 400);
    // spawn remote placeholders from roster at their LAN respawn points
    (state.netRoster || []).forEach(function (r, i) {
      if (r.id === state.myNetId) return;
      ensureRemoteMesh(r.id, r.custom, r.name);
      if (state.remoteMeshes[r.id]) {
        var sp = lanSpawns[i % lanSpawns.length] || { x: (i + 1) * 2.2, y: 0, z: 0 };
        state.remoteMeshes[r.id].position.set(sp.x, 0, sp.z);
      }
    });
  }


  // ===== STORY / ONLINE / PAUSE UI =====
  function hideAllScreens() {
    ['main-menu','story-choice','online-confirm','online-hub','create-room','join-room','lobby-screen','name-entry-screen'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
  }

  function showUI(id) {
    hideAllScreens();
    var el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
  }

  // Override main menu buttons
  var btnStory = document.getElementById('btn-story-mode');
  if (btnStory) btnStory.onclick = function () { showUI('story-choice'); state.mode = 'menu'; };

  var btnSplit = document.getElementById('btn-split-mode');
  if (btnSplit) btnSplit.onclick = function () {
    state.playType = 'split';
    state.isHost = true;
    state.player2Joined = false;
    state.netRoster = [];
    clearRemoteMeshes();
    // restore classic 2-player cards for split
    var list = document.getElementById('players-list');
    var hint = document.getElementById('net-players-hint');
    if (hint) hint.style.display = 'none';
    var p1Name = state.playerName || 'اللاعب 1';
    if (list) {
      list.innerHTML =
        '<div class="player-card host ready" id="player1-card"><div class="avatar">💻</div><div class="player-info">' +
        '<span class="name" id="p1-label">' + p1Name + '</span><span class="status online" id="p1-status">READY</span></div></div>' +
        '<div class="player-card" id="player2-card"><div class="avatar" id="p2-avatar">🎮</div><div class="player-info">' +
        '<span class="name" id="p2-label">اللاعب 2</span><span class="status" id="player2-status">اضغط هنا أو X على الدراعة</span></div></div>';
      var p2card = document.getElementById('player2-card');
      if (p2card) {
        p2card.style.cursor = 'pointer';
        p2card.addEventListener('click', function () {
          if (state.playType === 'split' && !state.player2Joined) {
            state.player2Joined = true;
            p2card.classList.add('ready');
            document.getElementById('player2-status').textContent = 'READY ✓';
            document.getElementById('player2-status').classList.add('online');
            document.getElementById('p2-avatar').textContent = '✅';
            document.getElementById('btn-start-game').disabled = false;
            document.getElementById('btn-start-game').textContent = 'START GAME';
            toast('اللاعب 2 جاهز', 'success');
          }
        });
      }
    }
    document.getElementById('lobby-title').textContent = '⚔️ SPLIT LOBBY';
    document.getElementById('lobby-code-display').style.display = 'none';
    document.getElementById('btn-start-game').disabled = true;
    document.getElementById('btn-start-game').textContent = 'START GAME';
    document.getElementById('gamepad-hint').textContent = 'اضغط كارت اللاعب 2 للجاهزية';
    configureCustomUIForMode();
    var levelBox = document.querySelector('.level-select-box');
    if (levelBox) levelBox.style.display = '';
    showScreen('lobby');
  };

  function checkLanServer(ip, cb) {
    var base = normalizeLanHost(ip || '127.0.0.1');
    var url = base + '/status';
    var done = false;
    var t = setTimeout(function () {
      if (done) return;
      done = true;
      cb(false, null);
    }, 4000);
    fetch(url, { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (j) {
      if (done) return;
      done = true;
      clearTimeout(t);
      cb(!!(j && j.ok), j);
    }).catch(function () {
      if (done) return;
      done = true;
      clearTimeout(t);
      cb(false, null);
    });
  }

  function runServerCheck(ip) {
    var st = document.getElementById('server-check-status');
    var okBtn = document.getElementById('btn-online-ok');
    ip = (ip || '127.0.0.1').trim();
    if (st) { st.textContent = 'جاري فحص السيرفر على ' + ip + ' ...'; st.style.color = '#94a3b8'; }
    if (okBtn) { okBtn.disabled = true; okBtn.textContent = 'جاري الفحص...'; }
    checkLanServer(ip, function (ok, info) {
      if (ok) {
        if (st) { st.textContent = 'السيرفر شغال ✓ على ' + ip; st.style.color = '#30d158'; }
        if (okBtn) { okBtn.disabled = false; okBtn.textContent = 'موافق — متابعة'; }
        state._lastCheckedLanIp = ip;
        if (info && info.ips && info.ips.length) state._detectedLanIps = info.ips;
        // prefill create/join IP fields
        var ci = document.getElementById('create-ip-input');
        var ji = document.getElementById('join-ip-input');
        if (ci) ci.value = ip;
        if (ji) ji.value = ip;
      } else {
        if (st) {
          st.innerHTML = 'السيرفر مش شغال على ' + ip + ' ❌<br><span style="font-weight:500;font-size:0.85rem">القائد: شغّل python lan_host.py ثم cloudflared tunnel --url http://localhost:27100<br>المنضم: الصق نفس رابط trycloudflare.com أو IP القائد</span>';
          st.style.color = '#ff6b8a';
        }
        if (okBtn) { okBtn.disabled = true; okBtn.textContent = 'السيرفر مش شغال بعد'; }
      }
    });
  }

  var btnOnline = document.getElementById('btn-online-mode');
  if (btnOnline) btnOnline.onclick = function () {
    // مباشرة للـ hub — اختيار LAN / كلاودفير داخل إنشاء أو انضمام
    showUI('online-hub');
    var hub = document.getElementById('hub-server-status');
    if (hub) hub.textContent = 'القائد يشغّل: python lan_host.py — LAN بدون نت أو كلاودفير للإنترنت';
  };

  var btnCheckServer = document.getElementById('btn-check-server');
  if (btnCheckServer) btnCheckServer.onclick = function () {
    var ipEl = document.getElementById('confirm-server-ip');
    var ip = (ipEl && ipEl.value) ? ipEl.value.trim() : '';
    if (!ip) { toast('اكتب IP السيرفر', 'error'); return; }
    runServerCheck(ip);
  };

  var btnOnlineOk = document.getElementById('btn-online-ok');
  if (btnOnlineOk) btnOnlineOk.onclick = function () {
    if (btnOnlineOk.disabled) {
      toast('افحص السيرفر أولًا بـ IP الصحيح', 'error');
      return;
    }
    showUI('online-hub');
    var hub = document.getElementById('hub-server-status');
    var ip = state._lastCheckedLanIp || '127.0.0.1';
    if (hub) hub.textContent = 'السيرفر متصل ✓ (' + ip + ')';
  };

  var btnOnlineCancel = document.getElementById('btn-online-cancel');
  if (btnOnlineCancel) btnOnlineCancel.onclick = function () { showUI('story-choice'); };

  var btnStoryBack = document.getElementById('btn-story-back');
  if (btnStoryBack) btnStoryBack.onclick = function () { showUI('main-menu'); showScreen('menu'); };

  var btnOnlineHubBack = document.getElementById('btn-online-hub-back');
  if (btnOnlineHubBack) btnOnlineHubBack.onclick = function () { showUI('story-choice'); };

  // ---- Create room: LAN vs Cloud mode ----
  state._createNetMode = null; // 'lan' | 'cloud'
  state._joinNetMode = null;

  function setCreateNetMode(mode) {
    state._createNetMode = mode;
    var lanP = document.getElementById('create-lan-panel');
    var cloudP = document.getElementById('create-cloud-panel');
    var btnLan = document.getElementById('btn-create-mode-lan');
    var btnCloud = document.getElementById('btn-create-mode-cloud');
    var doBtn = document.getElementById('btn-do-create');
    if (lanP) lanP.classList.toggle('hidden', mode !== 'lan');
    if (cloudP) cloudP.classList.toggle('hidden', mode !== 'cloud');
    if (btnLan) {
      btnLan.classList.toggle('btn-success', mode === 'lan');
      btnLan.classList.toggle('btn-ghost', mode !== 'lan');
    }
    if (btnCloud) {
      btnCloud.classList.toggle('btn-accent', mode === 'cloud');
      btnCloud.classList.toggle('btn-ghost', mode !== 'cloud');
    }
    if (doBtn) {
      doBtn.disabled = false;
      doBtn.textContent = mode === 'lan' ? 'تأكيد وإنشاء (LAN)' : 'تأكيد وإنشاء (كلاودفير)';
    }
    if (mode === 'lan') {
      var ipEl = document.getElementById('create-ip-input');
      if (ipEl && (!ipEl.value || ipEl.value === '')) ipEl.value = '127.0.0.1';
      // try detect local IP hint from previous check
      var hint = document.getElementById('create-lan-hint');
      if (hint && state._detectedLanIps && state._detectedLanIps.length) {
        hint.textContent = 'IP جهازك المحتمل: ' + state._detectedLanIps.join(' · ') + ' — أعطِه لصحابك على نفس الشبكة';
      }
    }
  }

  function setJoinNetMode(mode) {
    state._joinNetMode = mode;
    var lanP = document.getElementById('join-lan-panel');
    var cloudP = document.getElementById('join-cloud-panel');
    var btnLan = document.getElementById('btn-join-mode-lan');
    var btnCloud = document.getElementById('btn-join-mode-cloud');
    if (lanP) lanP.classList.toggle('hidden', mode !== 'lan');
    if (cloudP) cloudP.classList.toggle('hidden', mode !== 'cloud');
    if (btnLan) {
      btnLan.classList.toggle('btn-success', mode === 'lan');
      btnLan.classList.toggle('btn-ghost', mode !== 'lan');
    }
    if (btnCloud) {
      btnCloud.classList.toggle('btn-accent', mode === 'cloud');
      btnCloud.classList.toggle('btn-ghost', mode !== 'cloud');
    }
  }

  // زر الجرافيكس في القائمة الرئيسية
  var btnMenuGfx = document.getElementById('btn-menu-graphics');
  if (btnMenuGfx) btnMenuGfx.onclick = function () {
    var sel = document.getElementById('set-graphics');
    if (sel) sel.value = String(state.graphicsLevel || 3);
    var hint = document.getElementById('graphics-hint');
    if (hint && sel) {
      var hints = {
        1: 'الجرافيكس الحقير — أعلى فريمات لأضعف الأجهزة',
        2: 'جرافيكس منخفض — أجهزة ضعيفة',
        3: 'جرافيكس متوسط — توازن الشكل والأداء',
        4: 'جرافيكس عالي — أجهزة قوية',
        5: 'الجرافيكس الأسطوري — أقصى جودة'
      };
      hint.textContent = hints[parseInt(sel.value, 10)] || '';
    }
    var sp = document.getElementById('settings-panel');
    if (sp) sp.classList.remove('hidden');
    // لو مش في pause، رجوع يخفي فقط
  };

  var btnCreateModeLan = document.getElementById('btn-create-mode-lan');
  if (btnCreateModeLan) btnCreateModeLan.onclick = function () { setCreateNetMode('lan'); };
  var btnCreateModeCloud = document.getElementById('btn-create-mode-cloud');
  if (btnCreateModeCloud) btnCreateModeCloud.onclick = function () { setCreateNetMode('cloud'); };
  var btnJoinModeLan = document.getElementById('btn-join-mode-lan');
  if (btnJoinModeLan) btnJoinModeLan.onclick = function () { setJoinNetMode('lan'); };
  var btnJoinModeCloud = document.getElementById('btn-join-mode-cloud');
  if (btnJoinModeCloud) btnJoinModeCloud.onclick = function () { setJoinNetMode('cloud'); };

  var btnOnlineCreate = document.getElementById('btn-online-create');
  if (btnOnlineCreate) btnOnlineCreate.onclick = function () {
    state._createNetMode = null;
    setCreateNetMode(null);
    // reset panels
    var lanP = document.getElementById('create-lan-panel');
    var cloudP = document.getElementById('create-cloud-panel');
    if (lanP) lanP.classList.add('hidden');
    if (cloudP) cloudP.classList.add('hidden');
    var doBtn = document.getElementById('btn-do-create');
    if (doBtn) { doBtn.disabled = true; doBtn.textContent = 'اختر LAN أو كلاودفير أولاً'; }
    showUI('create-room');
    // quick probe localhost to fill detected IPs for LAN hint
    checkLanServer('127.0.0.1', function (ok, info) {
      if (ok && info && info.ips) state._detectedLanIps = info.ips;
    });
  };

  var btnOnlineJoin = document.getElementById('btn-online-join');
  if (btnOnlineJoin) btnOnlineJoin.onclick = function () {
    state._joinNetMode = null;
    setJoinNetMode(null);
    var lanP = document.getElementById('join-lan-panel');
    var cloudP = document.getElementById('join-cloud-panel');
    if (lanP) lanP.classList.add('hidden');
    if (cloudP) cloudP.classList.add('hidden');
    showUI('join-room');
  };

  var btnCreateBack = document.getElementById('btn-create-back');
  if (btnCreateBack) btnCreateBack.onclick = function () { showUI('online-hub'); };

  var btnJoinBack = document.getElementById('btn-join-back');
  if (btnJoinBack) btnJoinBack.onclick = function () { showUI('online-hub'); };

  function setupOnlineLobby(isHost, code) {
    state.playType = 'online';
    state.isHost = isHost;
    state.roomCode = code;
    state.player2Joined = !isHost;
    state.connections = [];
    state.connection = null;
    state.netRoster = [];
    state.myNetId = isHost ? ('host_' + code) : null;
    clearRemoteMeshes();

    document.getElementById('lobby-title').textContent = isHost ? '⚔️ لوبي القائد (سيرفر)' : '⚔️ لوبي المنضم';
    document.getElementById('lobby-code-display').style.display = 'block';
    document.getElementById('lobby-code-display').textContent = 'الرمز: ' + code;
    document.getElementById('gamepad-hint').textContent = isHost
      ? 'بانتظار اللاعبين... يمكن انضمام حتى ' + state.maxNetPlayers
      : 'جاري الاتصال...';

    if (isHost) {
      state.netRoster = [{ id: state.myNetId, name: state.playerName || 'القائد', isHost: true }];
      document.getElementById('btn-start-game').disabled = true;
      document.getElementById('btn-start-game').textContent = 'انتظر لاعبين...';
    } else {
      document.getElementById('btn-start-game').disabled = true;
      document.getElementById('btn-start-game').textContent = 'في انتظار القائد...';
    }
    renderNetLobbyList();
    configureCustomUIForMode();
    // Joiner: clothes only — no level control
    var levelBox = document.querySelector('.level-select-box');
    if (!isHost) {
      if (levelBox) levelBox.style.display = 'none';
      toast('تعدّل ملابسك فقط — اختيار اللفل للقائد', 'info');
    } else {
      if (levelBox) levelBox.style.display = '';
    }

    try {
      if (state.peer) { try { state.peer.destroy(); } catch (e) {} }
      var peerId = isHost ? ('sm_' + code) : undefined;
      showSyncLoading(isHost ? 'جاري فتح اللوبي...' : 'جاري الاتصال بالمضيف...');
      // PeerJS: signaling عبر الخدمة العامة، والبيانات P2P مباشرة (LAN/Radmin أفضل)
      // من غير إنترنت للإشارة الاتصال قد يفشل — بعد الاتصال الحركة تفضل P2P
      state.peer = new Peer(peerId, {
        debug: 0,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        }
      });
      state.peer.on('open', function (id) {
        if (isHost) {
          hideSyncLoading();
          toast('اللوبي جاهز: ' + code + ' — اتصال مباشر بين الأجهزة', 'success');
        } else {
          var conn = state.peer.connect('sm_' + code, { reliable: true });
          state.connection = conn;
          conn.on('open', function () {
            hideSyncLoading();
            try { readCustomFromUI && readCustomFromUI(0); } catch (e) {}
            try {
              conn.send({
                type: 'join',
                custom: (typeof playerCustom !== 'undefined' ? playerCustom[0] : null),
                name: state.playerName || 'لاعب'
              });
            } catch (e) {}
            toast('انضممت للوبي', 'success');
          });
          conn.on('data', function (d) { handlePeerData(d, false, conn); });
          conn.on('close', function () {
            toast('انقطع الاتصال بالمضيف', 'error');
            hideSyncLoading();
          });
        }
      });
      if (isHost) {
        state.peer.on('connection', function (conn) {
          state.connections.push(conn);
          // keep last connection ref for compatibility
          state.connection = conn;
          conn.on('open', function () {
            // join handled on data
          });
          conn.on('data', function (d) { handlePeerData(d, true, conn); });
          conn.on('close', function () {
            var leftId = conn._netId;
            state.connections = state.connections.filter(function (c) { return c !== conn; });
            if (leftId) {
              state.netRoster = (state.netRoster || []).filter(function (r) { return r.id !== leftId; });
              if (state.remoteMeshes[leftId]) {
                scene.remove(state.remoteMeshes[leftId]);
                delete state.remoteMeshes[leftId];
              }
              broadcastToAll({ type: 'leave', id: leftId });
              renderNetLobbyList();
              toast('لاعب خرج', 'info');
            }
            state.player2Joined = state.connections.length > 0;
            if (state.connections.length === 0) {
              document.getElementById('btn-start-game').disabled = true;
              document.getElementById('btn-start-game').textContent = 'انتظر لاعبين...';
            }
          });
        });
      }
      state.peer.on('error', function (err) {
        console.warn(err);
        hideSyncLoading();
        toast('فشل الاتصال — تأكد من الرمز وأن الاتنين فاتحين اللعبة ومتصلين', 'error');
      });
    } catch (e) {
      hideSyncLoading();
      toast('PeerJS غير متاح', 'error');
    }
    showScreen('lobby');
  }

  // ===== Create / Join: رفع ZIP + LAN بدون إنترنت =====
  var createZipReady = false;
  var joinZipReady = false;
  var createUploadInput = document.getElementById('create-upload-input');
  var joinUploadInput = document.getElementById('join-upload-input');
  var createPackStatus = document.getElementById('create-pack-status');
  var joinUploadStatus = document.getElementById('join-upload-status');

  var btnCreatePick = document.getElementById('btn-create-pick-zip');
  if (btnCreatePick && createUploadInput) {
    btnCreatePick.onclick = function () { createUploadInput.click(); };
  }
  if (createUploadInput) {
    createUploadInput.onchange = function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) { createZipReady = false; if (createPackStatus) createPackStatus.textContent = ''; return; }
      if (createPackStatus) createPackStatus.textContent = 'جاري قراءة «' + f.name + '» ...';
      uploadComprehensiveZip(f, function (ok, count) {
        createZipReady = !!ok;
        if (ok) {
          if (createPackStatus) createPackStatus.textContent = '✓ تم التعرف على الملف — ' + (count || 0) + ' لفل';
          toast('تم التعرف على الملف', 'success');
        } else {
          if (createPackStatus) createPackStatus.textContent = 'فشل قراءة الملف';
          toast('لم يتم التعرف على الملف', 'error');
        }
      });
    };
  }

  var btnJoinPick = document.getElementById('btn-join-pick-zip');
  if (btnJoinPick && joinUploadInput) {
    btnJoinPick.onclick = function () { joinUploadInput.click(); };
  }
  if (joinUploadInput) {
    joinUploadInput.onchange = function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) { joinZipReady = false; if (joinUploadStatus) joinUploadStatus.textContent = ''; return; }
      if (joinUploadStatus) joinUploadStatus.textContent = 'جاري قراءة «' + f.name + '» ...';
      uploadComprehensiveZip(f, function (ok, count) {
        joinZipReady = !!ok;
        if (ok) {
          if (joinUploadStatus) joinUploadStatus.textContent = '✓ تم التعرف على الملف — ' + (count || 0) + ' لفل';
          toast('تم التعرف على الملف', 'success');
        } else {
          if (joinUploadStatus) joinUploadStatus.textContent = 'فشل قراءة الملف';
          toast('لم يتم التعرف على الملف', 'error');
        }
      });
    };
  }

  function setupLanLobby(isHost, code, ip) {
    state.playType = 'online';
    state.useLan = true;
    state.isHost = isHost;
    state.roomCode = code;
    state.lanIp = ip;
    state.player2Joined = !isHost;
    state.connections = [];
    state.connection = null;
    state.myNetId = isHost ? ('host_' + code) : ('p_' + Date.now().toString(36));
    state.netRoster = isHost ? [{
      id: state.myNetId,
      name: state.playerName || 'القائد',
      isHost: true,
      custom: (typeof playerCustom !== 'undefined' ? playerCustom[0] : null)
    }] : [];
    clearRemoteMeshes();
    stopLanPoll();

    document.getElementById('lobby-title').textContent = isHost ? '⚔️ لوبي القائد (LAN)' : '⚔️ لوبي المنضم (LAN)';
    document.getElementById('lobby-code-display').style.display = 'block';
    document.getElementById('lobby-code-display').textContent = 'الرمز: ' + code + ' | IP: ' + ip;
    document.getElementById('gamepad-hint').textContent = isHost
      ? 'LAN جاهز — انتظر اللاعبين (شغّل lan_host.py)'
      : 'جاري الانضمام عبر LAN...';

    var levelBox = document.querySelector('.level-select-box');
    if (!isHost) {
      if (levelBox) levelBox.style.display = 'none';
    } else {
      if (levelBox) levelBox.style.display = '';
      document.getElementById('btn-start-game').disabled = true;
      document.getElementById('btn-start-game').textContent = 'انتظر لاعبين...';
    }
    configureCustomUIForMode();
    renderNetLobbyList();
    showScreen('lobby');
    startLanPoll();

    if (!isHost) {
      setTimeout(function () {
        try { readCustomFromUI && readCustomFromUI(0); } catch (e) {}
        lanSend({
          type: 'join',
          clientId: state.myNetId,
          name: state.playerName || 'لاعب',
          custom: (typeof playerCustom !== 'undefined' ? playerCustom[0] : null)
        });
        toast('انضممت عبر السيرفر', 'success');
        document.getElementById('gamepad-hint').textContent = 'متصل عبر LAN — بانتظار القائد';
        document.getElementById('btn-start-game').disabled = true;
        document.getElementById('btn-start-game').textContent = 'في انتظار القائد...';
      }, 200);
    } else {
      toast('لوبي السيرفر جاهز — أونلاين عام أو LAN', 'success');
      try {
        fetch(lanBaseUrl() + '/roommeta', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ room: code, host: state.playerName || 'القائد', host_id: state.myNetId, players: 1, playing: false, visible: true })
        });
      lanSend({ type: 'hostbeat', isHost: true, id: state.myNetId, name: state.playerName || 'القائد', players: 1 });
      } catch (e) {}
    }
  }

  var btnDoCreate = document.getElementById('btn-do-create');
  if (btnDoCreate) btnDoCreate.onclick = function () {
    var code = (document.getElementById('create-code-input').value || '').trim().toLowerCase().replace(/\s+/g, '');
    var mode = state._createNetMode;
    if (!mode) { toast('اختر LAN أو كلاودفير أولاً', 'error'); return; }
    var ip = '';
    if (mode === 'lan') {
      ip = (document.getElementById('create-ip-input') && document.getElementById('create-ip-input').value || '127.0.0.1').trim();
    } else {
      ip = (document.getElementById('create-cloud-input') && document.getElementById('create-cloud-input').value || '').trim();
    }
    if (!code || code.length < 2) { toast('اكتب رمز صالح', 'error'); return; }
    if (!ip) { toast(mode === 'lan' ? 'اكتب IP المحلي' : 'الصق رابط الكلاودفير', 'error'); return; }
    if (!createZipReady) {
      toast('ارفع الملف الشامل أولاً', 'error');
      if (createUploadInput) createUploadInput.click();
      return;
    }
    toast(mode === 'lan' ? 'جاري التحقق من سيرفر LAN...' : 'جاري التحقق من الكلاودفير...', 'info');
    checkLanServer(ip, function (ok, info) {
      if (!ok) {
        if (mode === 'lan') {
          toast('السيرفر مش شغال على LAN — شغّل: python lan_host.py على جهازك', 'error');
        } else {
          toast('السيرفر مش واصل — تأكد من python lan_host.py + cloudflared tunnel', 'error');
        }
        return;
      }
      if (info && info.ips) state._detectedLanIps = info.ips;
      setupLanLobby(true, code, ip);
      toast(mode === 'lan' ? 'لوبي LAN جاهز — أعطِ أصحابك IP جهازك والرمز' : 'لوبي كلاودفير جاهز — أعطِ الرابط والرمز', 'success');
    });
  };


  // ===== Available rooms list (join) =====
  var selectedListedRoom = null;
  function setJoinTab(mode) {
    var byCode = document.getElementById('join-by-code');
    var byList = document.getElementById('join-by-list');
    var tabCode = document.getElementById('btn-join-tab-code');
    var tabList = document.getElementById('btn-join-tab-list');
    if (!byCode || !byList) return;
    if (mode === 'list') {
      byCode.classList.add('hidden');
      byList.classList.remove('hidden');
      if (tabCode) { tabCode.classList.remove('btn-primary'); tabCode.classList.add('btn-ghost'); }
      if (tabList) { tabList.classList.add('btn-primary'); tabList.classList.remove('btn-ghost'); }
      refreshRoomsList();
    } else {
      byList.classList.add('hidden');
      byCode.classList.remove('hidden');
      if (tabList) { tabList.classList.remove('btn-primary'); tabList.classList.add('btn-ghost'); }
      if (tabCode) { tabCode.classList.add('btn-primary'); tabCode.classList.remove('btn-ghost'); }
    }
  }
  function getJoinServerAddress() {
    if (state._joinNetMode === 'cloud') {
      return (document.getElementById('join-cloud-input') && document.getElementById('join-cloud-input').value || '').trim();
    }
    return (document.getElementById('join-ip-input') && document.getElementById('join-ip-input').value || '').trim();
  }

  function refreshRoomsList() {
    var list = document.getElementById('rooms-list');
    var empty = document.getElementById('rooms-list-empty');
    var ip = getJoinServerAddress() || '127.0.0.1';
    if (!list) return;
    list.innerHTML = '';
    if (empty) empty.textContent = 'جاري التحميل...';
    var base = normalizeLanHost(ip);
    fetch(base + '/rooms', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      list.innerHTML = '';
      var rooms = (j && j.rooms) || [];
      if (!rooms.length) {
        if (empty) empty.textContent = 'مفيش رومات ظاهرة — تأكد إن القائد أنشأ لوبي والسيرفر شغال';
        return;
      }
      if (empty) empty.textContent = '';
      rooms.forEach(function (rm) {
        var card = document.createElement('div');
        card.className = 'room-card';
        if (selectedListedRoom === rm.code) card.classList.add('selected');
        var status = rm.playing ? '● في اللعب' : '○ في اللوبي';
        card.innerHTML = '<div class="rc-code">' + rm.code + '</div>' +
          '<div class="rc-meta">' + (rm.host ? ('القائد: ' + rm.host + ' · ') : '') +
          'لاعبين: ' + (rm.players || '?') + ' · ' + status + '</div>';
        card.onclick = function () {
          selectedListedRoom = rm.code;
          var inp = document.getElementById('join-code-input');
          if (inp) inp.value = rm.code;
          list.querySelectorAll('.room-card').forEach(function (c) { c.classList.remove('selected'); });
          card.classList.add('selected');
          toast('تم اختيار الروم: ' + rm.code, 'info');
        };
        list.appendChild(card);
      });
    }).catch(function () {
      if (empty) empty.textContent = 'فشل جلب الرومات — تأكد من عنوان السيرفر';
    });
  }
  var btnJoinTabCode = document.getElementById('btn-join-tab-code');
  if (btnJoinTabCode) btnJoinTabCode.onclick = function () { setJoinTab('code'); };
  var btnJoinTabList = document.getElementById('btn-join-tab-list');
  if (btnJoinTabList) btnJoinTabList.onclick = function () { setJoinTab('list'); };
  var btnRefreshRooms = document.getElementById('btn-refresh-rooms');
  if (btnRefreshRooms) btnRefreshRooms.onclick = function () { refreshRoomsList(); };

  var btnDoJoin = document.getElementById('btn-do-join');
  if (btnDoJoin) btnDoJoin.onclick = function () {
    var code = (document.getElementById('join-code-input').value || '').trim().toLowerCase().replace(/\s+/g, '');
    var mode = state._joinNetMode;
    if (!mode) { toast('اختر LAN أو كلاودفير أولاً', 'error'); return; }
    var ip = getJoinServerAddress();
    if (!code || code.length < 2) { toast('اكتب رمز الروم أو اختر من القائمة', 'error'); return; }
    if (!ip) { toast(mode === 'lan' ? 'اكتب IP جهاز القائد على الشبكة' : 'الصق رابط الكلاودفير', 'error'); return; }
    if (!joinZipReady) {
      toast('ارفع الملف الشامل أولاً', 'error');
      if (joinUploadInput) joinUploadInput.click();
      return;
    }
    toast(mode === 'lan' ? 'جاري الاتصال بـ LAN...' : 'جاري الاتصال بالكلاودفير...', 'info');
    checkLanServer(ip, function (ok) {
      if (!ok) {
        if (mode === 'lan') {
          toast('مش واصل على LAN — تأكد إن القائد فاتح python lan_host.py وإنكم على نفس الشبكة', 'error');
        } else {
          toast('مش واصل — تأكد من رابط الكلاودفير وإن القائد فاتح Python + tunnel', 'error');
        }
        return;
      }
      setupLanLobby(false, code, ip);
    });
  };

  // Fullscreen button (any page)
  var btnFs = document.getElementById('btn-fullscreen');
  if (btnFs) {
    btnFs.onclick = function () {
      var doc = document;
      if (!doc.fullscreenElement && !doc.webkitFullscreenElement) {
        var el = doc.documentElement;
        var req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
        if (req) req.call(el);
      } else {
        var exit = doc.exitFullscreen || doc.webkitExitFullscreen || doc.msExitFullscreen;
        if (exit) exit.call(doc);
      }
    };
  }

  // Pause system — per-player in split screen
  var gpMenuFocus = 0; // index into focusable elements
  var gpMenuMode = 'pause'; // 'pause' | 'settings' | 'cam'

  function getPauseFocusables() {
    if (gpMenuMode === 'settings' || gpMenuMode === 'cam') {
      var list = [];
      var vol = document.getElementById('set-volume');
      var sens = document.getElementById('set-sens');
      var gps = document.getElementById('set-gp-sens');
      var camBtn = document.getElementById('btn-cam-settings');
      var back = document.getElementById('btn-settings-back');
      if (vol) list.push({ el: vol, type: 'range' });
      // Show only relevant sens for current pause owner
      if (state.pauseOwner === 0 && sens) list.push({ el: sens, type: 'range' });
      if (state.pauseOwner === 1 && gps) list.push({ el: gps, type: 'range' });
      if (gpMenuMode === 'cam' || (document.getElementById('cam-settings') && !document.getElementById('cam-settings').classList.contains('hidden'))) {
        var cd = document.getElementById('set-cam-dist');
        var ch = document.getElementById('set-cam-h');
        var cs = document.getElementById('set-cam-side');
        if (cd) list.push({ el: cd, type: 'range' });
        if (ch) list.push({ el: ch, type: 'range' });
        if (cs) list.push({ el: cs, type: 'range' });
      }
      if (camBtn) list.push({ el: camBtn, type: 'button' });
      if (back) list.push({ el: back, type: 'button' });
      return list;
    }
    return [
      { el: document.getElementById('btn-pause-resume'), type: 'button' },
      { el: document.getElementById('btn-pause-settings'), type: 'button' },
      { el: document.getElementById('btn-pause-exit'), type: 'button' }
    ].filter(function (x) { return x.el; });
  }

  function updateGpMenuFocus() {
    var items = getPauseFocusables();
    items.forEach(function (it, i) {
      if (!it.el) return;
      if (i === gpMenuFocus) {
        it.el.style.outline = '3px solid #00d4ff';
        it.el.style.outlineOffset = '3px';
        try { it.el.focus && it.el.focus(); } catch (e) {}
      } else {
        it.el.style.outline = '';
        it.el.style.outlineOffset = '';
      }
    });
  }

  function handleGamepadMenuNav(gp, delta) {
    if (!gp) return;
    var items = getPauseFocusables();
    if (!items.length) return;

    var navUp = (gp.dUp || gp.stickY < -0.55) && !prevGpMenuNav.up;
    var navDown = (gp.dDown || gp.stickY > 0.55) && !prevGpMenuNav.down;
    var navLeft = (gp.dLeft || gp.stickX < -0.55) && !prevGpMenuNav.left;
    var navRight = (gp.dRight || gp.stickX > 0.55) && !prevGpMenuNav.right;
    var conf = gp.confirm && !prevGpMenuNav.confirm;
    var back = gp.back && !prevGpMenuNav.back;

    prevGpMenuNav.up = gp.dUp || gp.stickY < -0.55;
    prevGpMenuNav.down = gp.dDown || gp.stickY > 0.55;
    prevGpMenuNav.left = gp.dLeft || gp.stickX < -0.55;
    prevGpMenuNav.right = gp.dRight || gp.stickX > 0.55;
    prevGpMenuNav.confirm = gp.confirm;
    prevGpMenuNav.back = gp.back;

    if (navUp) {
      gpMenuFocus = (gpMenuFocus - 1 + items.length) % items.length;
      updateGpMenuFocus();
    }
    if (navDown) {
      gpMenuFocus = (gpMenuFocus + 1) % items.length;
      updateGpMenuFocus();
    }

    var cur = items[gpMenuFocus];
    if (cur && cur.type === 'range') {
      if (navLeft || navRight) {
        var step = parseFloat(cur.el.step) || 1;
        var val = parseFloat(cur.el.value) || 0;
        val += (navRight ? step : -step);
        var min = parseFloat(cur.el.min), max = parseFloat(cur.el.max);
        if (!isNaN(min)) val = Math.max(min, val);
        if (!isNaN(max)) val = Math.min(max, val);
        cur.el.value = val;
        // trigger input handler
        cur.el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    if (conf && cur) {
      if (cur.type === 'button') cur.el.click();
    }
    if (back) {
      if (gpMenuMode === 'cam') {
        document.getElementById('cam-settings').classList.add('hidden');
        gpMenuMode = 'settings';
        gpMenuFocus = 0;
        updateGpMenuFocus();
      } else if (gpMenuMode === 'settings') {
        document.getElementById('settings-panel').classList.add('hidden');
        gpMenuMode = 'pause';
        gpMenuFocus = 0;
        updateGpMenuFocus();
      } else {
        closePause();
      }
    }
  }

  function loadSettingsToUI(playerIdx) {
    var p = players[playerIdx] || players[0];
    var s = p.settings;
    var vol = document.getElementById('set-volume');
    var sens = document.getElementById('set-sens');
    var gps = document.getElementById('set-gp-sens');
    var cd = document.getElementById('set-cam-dist');
    var ch = document.getElementById('set-cam-h');
    var cs = document.getElementById('set-cam-side');
    if (vol) vol.value = Math.round(state.volume * 100);
    if (sens) sens.value = s.sens;
    if (gps) gps.value = s.sens;
    if (cd) cd.value = s.camDist;
    if (ch) ch.value = s.camHeight;
    if (cs) cs.value = s.camSide;
    // Labels: hide irrelevant sensitivity for this player
    var sensRow = sens ? sens.closest('.setting-row') : null;
    var gpRow = gps ? gps.closest('.setting-row') : null;
    if (sensRow) sensRow.style.display = playerIdx === 0 ? '' : 'none';
    if (gpRow) gpRow.style.display = playerIdx === 1 ? '' : 'none';
  }

  function openPause(side) {
    if (state.mode !== 'play') return;
    state.paused = true;
    state.pauseSide = side || 'full';
    if (side === 'left') state.pauseOwner = 0;
    else if (side === 'right') state.pauseOwner = 1;
    else state.pauseOwner = 0;

    var pm = document.getElementById('pause-menu');
    var sp = document.getElementById('settings-panel');
    pm.classList.remove('hidden', 'half-left', 'half-right', 'full');
    if (sp) sp.classList.remove('half-left', 'half-right', 'full');

    if (state.playType === 'split' && side === 'left') {
      pm.classList.add('half-left');
      if (sp) sp.classList.add('half-left');
    } else if (state.playType === 'split' && side === 'right') {
      pm.classList.add('half-right');
      if (sp) sp.classList.add('half-right');
    } else {
      pm.classList.add('full');
      if (sp) sp.classList.add('full');
    }

    var title = document.getElementById('pause-title');
    if (title) {
      if (state.playType === 'split') {
        title.textContent = state.pauseOwner === 0 ? 'إيقاف — اللاعب 1' : 'إيقاف — اللاعب 2 (دراع)';
      } else {
        title.textContent = 'إيقاف مؤقت';
      }
    }

    loadSettingsToUI(state.pauseOwner);
    gpMenuMode = 'pause';
    gpMenuFocus = 0;
    updateGpMenuFocus();
  }
  function closePause() {
    state.paused = false;
    state.pauseOwner = null;
    document.getElementById('pause-menu').classList.add('hidden');
    document.getElementById('settings-panel').classList.add('hidden');
    var cam = document.getElementById('cam-settings');
    if (cam) cam.classList.add('hidden');
    // clear outlines
    getPauseFocusables().forEach(function (it) {
      if (it.el) { it.el.style.outline = ''; it.el.style.outlineOffset = ''; }
    });
    gpMenuMode = 'pause';
  }

  document.getElementById('btn-pause-resume').onclick = closePause;
  document.getElementById('btn-pause-exit').onclick = function () {
    closePause();
    if (state.playType === 'online') {
      broadcastToAll({ type: 'exit', id: state.myNetId });
      if (state.isHost) broadcastToAll({ type: 'exit', id: state.myNetId });
    }
    if (state.peer) try { state.peer.destroy(); } catch (e) {}
    state.connection = null; state.peer = null; state.connections = [];
    state.netRoster = []; state.myNetId = null;
    clearRemoteMeshes();
    stopAllScripts && stopAllScripts();
    showScreen('menu');
    showUI('main-menu');
  };
  document.getElementById('btn-pause-settings').onclick = function () {
    loadSettingsToUI(state.pauseOwner != null ? state.pauseOwner : 0);
    document.getElementById('settings-panel').classList.remove('hidden');
    gpMenuMode = 'settings';
    gpMenuFocus = 0;
    updateGpMenuFocus();
  };
  document.getElementById('btn-settings-back').onclick = function () {
    document.getElementById('settings-panel').classList.add('hidden');
    gpMenuMode = 'pause';
    gpMenuFocus = 0;
    updateGpMenuFocus();
  };
  document.getElementById('btn-cam-settings').onclick = function () {
    document.getElementById('cam-settings').classList.toggle('hidden');
    gpMenuMode = document.getElementById('cam-settings').classList.contains('hidden') ? 'settings' : 'cam';
    gpMenuFocus = 0;
    updateGpMenuFocus();
  };

  // Live settings — apply to the player who opened the menu only
  function bindSettings() {
    var vol = document.getElementById('set-volume');
    var sens = document.getElementById('set-sens');
    var gps = document.getElementById('set-gp-sens');
    var cd = document.getElementById('set-cam-dist');
    var ch = document.getElementById('set-cam-h');
    var cs = document.getElementById('set-cam-side');
    var gfx = document.getElementById('set-graphics');

    function targetPlayer() {
      return players[state.pauseOwner != null ? state.pauseOwner : 0];
    }

    if (vol) vol.oninput = function () { state.volume = vol.value / 100; };
    if (sens) sens.oninput = function () {
      var p = targetPlayer();
      p.settings.sens = parseFloat(sens.value);
    };
    if (gps) gps.oninput = function () {
      var p = targetPlayer();
      p.settings.sens = parseFloat(gps.value);
    };
    if (cd) cd.oninput = function () { targetPlayer().settings.camDist = parseFloat(cd.value); };
    if (ch) ch.oninput = function () { targetPlayer().settings.camHeight = parseFloat(ch.value); };
    if (cs) cs.oninput = function () { targetPlayer().settings.camSide = parseFloat(cs.value); };
    if (gfx) gfx.onchange = function () {
      applyGraphicsQuality(parseInt(gfx.value, 10) || 3);
      toast('تم تطبيق مستوى الجرافيكس ' + gfx.value, 'success');
    };

    var kb = document.getElementById('kb-controls');
    if (kb) kb.innerHTML = 'W/A/S/D حركة<br>Space قفز<br>F جري<br>Ctrl إخفاء الماوس<br>Esc قائمة';
    var gp = document.getElementById('gp-controls');
    if (gp) gp.innerHTML = 'Left Stick حركة<br>X قفز / تأكيد<br>Circle رجوع<br>Right Stick كاميرا<br>Options قائمة<br>D-Pad تنقل القائمة';
  }

  // ESC = player 1 (keyboard) pause
  window.addEventListener('keydown', function (e) {
    if (e.code === 'Escape' && state.mode === 'play') {
      e.preventDefault();
      e.stopPropagation();
      if (state.paused) {
        // Only close if this is P0's menu or full
        if (state.pauseOwner === 0 || state.playType !== 'split') closePause();
        return;
      }
      if (state.playType === 'split') openPause('left');
      else openPause('full');
    }
  }, true);



  // Click player2 card in split lobby to ready without gamepad
  var p2card = document.getElementById('player2-card');
  if (p2card) {
    p2card.style.cursor = 'pointer';
    p2card.addEventListener('click', function () {
      if (state.playType === 'split' && !state.player2Joined) {
        state.player2Joined = true;
        p2card.classList.add('ready');
        document.getElementById('player2-status').textContent = 'READY ✓';
        document.getElementById('player2-status').classList.add('online');
        document.getElementById('p2-avatar').textContent = '✅';
        document.getElementById('btn-start-game').disabled = false;
        document.getElementById('btn-start-game').textContent = 'START GAME';
        toast('اللاعب 2 جاهز', 'success');
      }
    });
  }

  function updateMenuNameDisplay() {
    var el = document.getElementById('menu-player-name');
    if (el) el.textContent = state.playerName ? ('مرحباً، ' + state.playerName) : '';
  }

  function showNameEntry(force) {
    var saved = '';
    try { saved = localStorage.getItem('storyModePlayerName') || ''; } catch (e) {}
    if (!force && saved.trim()) {
      state.playerName = saved.trim().slice(0, 16);
      updateMenuNameDisplay();
      showScreen('menu');
      showUI('main-menu');
      return;
    }
    hideAllScreens();
    var ne = document.getElementById('name-entry-screen');
    if (ne) ne.classList.remove('hidden');
    var inp = document.getElementById('player-name-input');
    if (inp) {
      inp.value = saved || state.playerName || '';
      setTimeout(function () { inp.focus(); }, 50);
    }
  }

  function savePlayerNameFromUI() {
    var inp = document.getElementById('player-name-input');
    var name = (inp && inp.value ? inp.value : '').trim().slice(0, 16);
    if (!name) {
      toast('اكتب اسمك أولاً', 'error');
      return;
    }
    state.playerName = name;
    try { localStorage.setItem('storyModePlayerName', name); } catch (e) {}
    updateMenuNameDisplay();
    var ne = document.getElementById('name-entry-screen');
    if (ne) ne.classList.add('hidden');
    showScreen('menu');
    showUI('main-menu');
    toast('تم حفظ الاسم: ' + name, 'success');
  }

  function finishLoading() {
    loadingScreen.classList.add('hidden');
    bindContextMenu();
    bindCustomUI();
    bindObjToolbar();
    bindSettings();
    var search = document.getElementById('build-search');
    if (search) {
      search.oninput = function () { populateSidebar(search.value); };
    }
    // Name entry
    var btnSaveName = document.getElementById('btn-save-player-name');
    if (btnSaveName) btnSaveName.onclick = savePlayerNameFromUI;
    var nameInp = document.getElementById('player-name-input');
    if (nameInp) {
      nameInp.onkeydown = function (e) {
        if (e.key === 'Enter') savePlayerNameFromUI();
      };
    }
    var btnChangeName = document.getElementById('btn-change-name');
    if (btnChangeName) btnChangeName.onclick = function () { showNameEntry(true); };

    // Update hideAllScreens list if needed - name entry is separate
    showNameEntry(false);
    // restore graphics preference
    try {
      var g = parseInt(localStorage.getItem('sm_graphics') || '3', 10);
      applyGraphicsQuality(g);
    } catch (e) { applyGraphicsQuality(3); }
    animate();
  }
  function init() { loadingText.textContent = 'جاهز'; setTimeout(finishLoading, 100); }
  setTimeout(function () { if (!loadingScreen.classList.contains('hidden')) finishLoading(); }, 2500);
  init();
})();
