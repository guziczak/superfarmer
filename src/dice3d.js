/* ============================================================
   SUPERFARMER — scena 3D: kostki k12, taca, fizyka, rzut gestem
   Wymaga globali: THREE, CANNON, SYMBOLS.
   Global: DiceScene
   ============================================================ */
var DiceScene = (function () {
  'use strict';

  var PHI = (1 + Math.sqrt(5)) / 2;

  /* ---------- geometria dwunastościanu (h ścianki = 1) ---------- */
  function buildDodeca() {
    var vs = [];
    var s = [1, -1];
    var i, j, k;
    for (i = 0; i < 2; i++) for (j = 0; j < 2; j++) for (k = 0; k < 2; k++) vs.push([s[i], s[j], s[k]]);
    for (i = 0; i < 2; i++) for (j = 0; j < 2; j++) {
      vs.push([0, s[i] / PHI, s[j] * PHI]);
      vs.push([s[i] / PHI, s[j] * PHI, 0]);
      vs.push([s[i] * PHI, 0, s[j] / PHI]);
    }
    // normalne ścianek: kierunki wierzchołków ikozaedru DUALNEGO do tego
    // zestawu wierzchołków — wzór (0,±φ,±1)/(±φ,±1,0)/(±1,0,±φ);
    // (zamiana 1↔φ daje ikozaedr obrócony o 26.565° — NIE ścianki tej bryły!)
    var fnRaw = [];
    for (i = 0; i < 2; i++) for (j = 0; j < 2; j++) {
      fnRaw.push([0, s[i] * PHI, s[j]]);
      fnRaw.push([s[i] * PHI, s[j], 0]);
      fnRaw.push([s[i], 0, s[j] * PHI]);
    }
    var norm = function (v) {
      var l = Math.hypot(v[0], v[1], v[2]);
      return [v[0] / l, v[1] / l, v[2] / l];
    };
    var dot = function (a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; };
    var cross = function (a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; };

    var normals = fnRaw.map(norm);
    var faces = [];
    for (i = 0; i < 12; i++) {
      var n = normals[i];
      var scored = vs.map(function (v, idx) { return { idx: idx, d: dot(v, n) }; });
      scored.sort(function (a, b) { return b.d - a.d; });
      var five = scored.slice(0, 5).map(function (x) { return x.idx; });
      // sortowanie kątowe wokół normalnej (CCW patrząc z zewnątrz)
      var ref = norm([n[1] - n[2], n[2] - n[0], n[0] - n[1]]); // cokolwiek niewspółliniowego
      if (Math.abs(dot(ref, n)) > 0.9) ref = norm(cross(n, [1, 0.3, 0.2]));
      var t = norm(cross(n, ref)), b = cross(n, t);
      var c = [0, 0, 0];
      five.forEach(function (vi) { c[0] += vs[vi][0] / 5; c[1] += vs[vi][1] / 5; c[2] += vs[vi][2] / 5; });
      five.sort(function (va, vb) {
        var A = vs[va], B = vs[vb];
        var aa = Math.atan2(dot([A[0] - c[0], A[1] - c[1], A[2] - c[2]], b), dot([A[0] - c[0], A[1] - c[1], A[2] - c[2]], t));
        var bb = Math.atan2(dot([B[0] - c[0], B[1] - c[1], B[2] - c[2]], b), dot([B[0] - c[0], B[1] - c[1], B[2] - c[2]], t));
        return aa - bb;
      });
      // nawinięcie CCW patrząc z zewnątrz — cannon-es liczy wtedy normalne NA ZEWNĄTRZ
      var A = vs[five[0]], B = vs[five[1]], C = vs[five[2]];
      var w = cross([B[0] - A[0], B[1] - A[1], B[2] - A[2]], [C[0] - A[0], C[1] - A[1], C[2] - A[2]]);
      if (dot(w, n) < 0) five.reverse();
      faces.push(five);
    }
    // przeskaluj tak, aby odległość ścianki od środka = 1
    var h0 = dot(vs[faces[0][0]], normals[0]);
    var verts = vs.map(function (v) { return [v[0] / h0, v[1] / h0, v[2] / h0]; });
    // styczna ścianki: od środka (== normalna, bo h=1) do pierwszego wierzchołka
    var tangents = [], faceR = 0;
    for (i = 0; i < 12; i++) {
      var nn = normals[i], v0 = verts[faces[i][0]];
      var rel = [v0[0] - nn[0], v0[1] - nn[1], v0[2] - nn[2]];
      var d0 = dot(rel, nn);
      rel = [rel[0] - nn[0] * d0, rel[1] - nn[1] * d0, rel[2] - nn[2] * d0];
      faceR = Math.hypot(rel[0], rel[1], rel[2]);
      tangents.push(norm(rel));
    }
    return { verts: verts, faces: faces, normals: normals, tangents: tangents, faceR: faceR };
  }

  /* ---------- zaokrąglony mesh przez smooth-max (LogSumExp) ---------- */
  function buildRoundedGeometry(dod, K, detail) {
    var geo = new THREE.IcosahedronGeometry(1, detail || 14);
    var pos = geo.attributes.position;
    var nrm = new Float32Array(pos.count * 3);
    var N = dod.normals;
    var i, f;
    for (i = 0; i < pos.count; i++) {
      var ux = pos.getX(i), uy = pos.getY(i), uz = pos.getZ(i);
      var l = Math.hypot(ux, uy, uz); ux /= l; uy /= l; uz /= l;
      var d = new Array(12), maxd = -2;
      for (f = 0; f < 12; f++) {
        d[f] = ux * N[f][0] + uy * N[f][1] + uz * N[f][2];
        if (d[f] > maxd) maxd = d[f];
      }
      var t = 1 / maxd;
      for (var it = 0; it < 7; it++) {
        var m = -1e9;
        for (f = 0; f < 12; f++) { var a = K * (t * d[f] - 1); if (a > m) m = a; }
        var sum = 0, dsum = 0;
        for (f = 0; f < 12; f++) {
          var e = Math.exp(K * (t * d[f] - 1) - m);
          sum += e; dsum += e * d[f];
        }
        var g = (m + Math.log(sum)) / K;   // wartość LSE
        var gp = dsum / sum;               // pochodna po t
        t -= g / gp;
      }
      // normalna = ważona softmaxem suma normalnych ścianek
      var m2 = -1e9;
      for (f = 0; f < 12; f++) { var a2 = K * (t * d[f] - 1); if (a2 > m2) m2 = a2; }
      var wnx = 0, wny = 0, wnz = 0;
      for (f = 0; f < 12; f++) {
        var w = Math.exp(K * (t * d[f] - 1) - m2);
        wnx += w * N[f][0]; wny += w * N[f][1]; wnz += w * N[f][2];
      }
      var wl = Math.hypot(wnx, wny, wnz);
      pos.setXYZ(i, ux * t, uy * t, uz * t);
      nrm[i * 3] = wnx / wl; nrm[i * 3 + 1] = wny / wl; nrm[i * 3 + 2] = wnz / wl;
    }
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.attributes.position.needsUpdate = true;
    return geo;
  }

  /* ---------- materiał kostki z symbolami w shaderze ---------- */
  function makeDieMaterial(dod, atlasTex, symbols, baseColor) {
    var mat = new THREE.MeshPhysicalMaterial({
      color: baseColor,
      roughness: 0.42,
      metalness: 0.0,
      clearcoat: 0.2,
      clearcoatRoughness: 0.42,
      envMapIntensity: 0.5
    });
    var faceN = [], faceT = [], faceSym = [];
    for (var i = 0; i < 12; i++) {
      faceN.push(new THREE.Vector3().fromArray(dod.normals[i]));
      faceT.push(new THREE.Vector3().fromArray(dod.tangents[i]));
      var c = SYMBOLS.cellOf(symbols[i]);
      faceSym.push(c.index);
    }
    var symbolHalf = dod.faceR * 0.6; // pole symbolu na ściance
    mat.onBeforeCompile = function (shader) {
      shader.uniforms.uAtlas = { value: atlasTex };
      shader.uniforms.uFaceN = { value: faceN };
      shader.uniforms.uFaceT = { value: faceT };
      shader.uniforms.uFaceSym = { value: faceSym };
      shader.uniforms.uSymHalf = { value: symbolHalf };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 sfPos;\nvarying vec3 sfNor;')
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nsfNor = normal;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nsfPos = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 sfPos;\nvarying vec3 sfNor;\nuniform sampler2D uAtlas;\nuniform vec3 uFaceN[12];\nuniform vec3 uFaceT[12];\nuniform float uFaceSym[12];\nuniform float uSymHalf;')
        .replace('#include <map_fragment>', [
          'float sfA = 0.0;',
          '{',
          '  int best = 0; float bd = -2.0;',
          '  for (int i = 0; i < 12; i++) { float d = dot(sfNor, uFaceN[i]); if (d > bd) { bd = d; best = i; } }',
          '  vec3 fn = uFaceN[best]; vec3 ft = uFaceT[best]; vec3 fb = cross(fn, ft);',
          '  vec3 rel = sfPos - fn;',
          '  vec2 fuv = vec2(dot(rel, ft), dot(rel, fb)) / (2.0 * uSymHalf) + 0.5;',
          '  if (fuv.x > 0.01 && fuv.x < 0.99 && fuv.y > 0.01 && fuv.y < 0.99 && bd > 0.972) {',
          '    float sy = uFaceSym[best];',
          '    vec2 cell = vec2(mod(sy, 4.0), floor(sy / 4.0));',
          '    vec2 auv = (cell + vec2(fuv.x, 1.0 - fuv.y)) / vec2(4.0, 2.0);',
          '    vec4 tex = texture2D(uAtlas, auv);',
          '    diffuseColor.rgb = mix(diffuseColor.rgb, tex.rgb, tex.a * 0.97);',
          '    sfA = tex.a;',
          '  }',
          '}'
        ].join('\n'))
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, roughnessFactor * 0.92, sfA);');
    };
    mat.customProgramCacheKey = function () { return 'sfdie' + symbols.join(''); };
    return mat;
  }

  /* ---------- tekstury proceduralne stołu ---------- */
  function makeFeltTexture() {
    var cv = document.createElement('canvas');
    cv.width = cv.height = 1024;
    var c = cv.getContext('2d');
    c.fillStyle = '#2e5138'; c.fillRect(0, 0, 1024, 1024);
    var g = c.createRadialGradient(512, 460, 120, 512, 512, 740);
    g.addColorStop(0, 'rgba(86,140,98,0.30)');
    g.addColorStop(0.6, 'rgba(60,104,72,0.10)');
    g.addColorStop(1, 'rgba(16,34,22,0.55)');
    c.fillStyle = g; c.fillRect(0, 0, 1024, 1024);
    // włókna filcu
    for (var i = 0; i < 9000; i++) {
      var x = Math.random() * 1024, y = Math.random() * 1024;
      var a = Math.random() * Math.PI, l = 1.5 + Math.random() * 3.2;
      c.strokeStyle = Math.random() < 0.5 ? 'rgba(255,255,240,0.028)' : 'rgba(0,10,0,0.05)';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      c.stroke();
    }
    var t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  function makeWoodTexture() {
    var cv = document.createElement('canvas');
    cv.width = 1024; cv.height = 256;
    var c = cv.getContext('2d');
    c.fillStyle = '#7b5029'; c.fillRect(0, 0, 1024, 256);
    var i;
    for (i = 0; i < 46; i++) { // słoje
      var y = Math.random() * 256;
      var amp = 3 + Math.random() * 9;
      var tone = Math.random();
      c.strokeStyle = tone < 0.6 ? 'rgba(46,26,10,' + (0.10 + Math.random() * 0.16) + ')' : 'rgba(214,164,100,' + (0.08 + Math.random() * 0.10) + ')';
      c.lineWidth = 1 + Math.random() * 2.6;
      c.beginPath();
      for (var x = 0; x <= 1024; x += 16) {
        var yy = y + Math.sin(x / 90 + i * 1.7) * amp + Math.sin(x / 31 + i) * 2;
        if (x === 0) c.moveTo(x, yy); else c.lineTo(x, yy);
      }
      c.stroke();
    }
    for (i = 0; i < 4; i++) { // sęki
      var kx = 100 + Math.random() * 820, ky = 40 + Math.random() * 176;
      c.fillStyle = 'rgba(40,22,8,0.5)';
      c.beginPath(); c.ellipse(kx, ky, 5 + Math.random() * 6, 3 + Math.random() * 3, Math.random(), 0, 7); c.fill();
    }
    var t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  /* ---------- otoczenie studyjne do odbić (PMREM) ---------- */
  function makeEnvironment(renderer) {
    var scene = new THREE.Scene();
    var geo = new THREE.SphereGeometry(30, 16, 12);
    var bg = new THREE.MeshBasicMaterial({ side: THREE.BackSide });
    bg.color = new THREE.Color('#241a10');
    scene.add(new THREE.Mesh(geo, bg));
    function box(x, y, z, w, h, col, inten, ry) {
      var m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(inten) })
      );
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      if (ry) m.rotateY(ry);
      scene.add(m);
    }
    box(-7, 8, 5, 9, 6, '#fff2da', 5.2);    // ciepłe "okno" — główne
    box(6, 7, -4, 6, 4, '#ffd9a4', 2.6);    // softbox
    box(0, 4, -8, 7, 2, '#b7c8de', 1.4);    // chłodny pasek kontrastu
    box(0, -6, 0, 12, 12, '#3a2c1c', 0.7);  // odbicie stołu od dołu
    var pmrem = new THREE.PMREMGenerator(renderer);
    var env = pmrem.fromScene(scene, 0.035);
    pmrem.dispose();
    return env.texture;
  }

  /* ============================================================ */
  function DiceScene(opts) {
    var self = this;
    this.opts = opts;
    this.canvas = opts.canvas;
    this.onSettle = opts.onSettle || function () {};
    this.onImpact = opts.onImpact || function () {};
    this.onThrow = opts.onThrow || function () {};
    this.onHold = opts.onHold || function () {};
    this.interactive = false;
    this.state = 'idle'; // idle | held | flying | snapping
    this.insets = { top: 0, right: 0, bottom: 0, left: 0 };
    this._impactLast = 0;
    this._settleTimer = 0;
    this._cockedTries = 0;
    this.bias = [0, 0]; // obciążenie [kostka A, kostka B] w ułamkach U; + = ciężarek przy drapieżniku
    this.remote = false; // true = kostki odtwarzają transmisję rzutu z drugiego telefonu
    this._lastNet = null;
    this._tmpV = new THREE.Vector3();

    var W = this.canvas.clientWidth || window.innerWidth;
    var H = this.canvas.clientHeight || window.innerHeight;

    var renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor('#221910');
    this.renderer = renderer;

    var scene = new THREE.Scene();
    this.scene = scene;
    scene.environment = makeEnvironment(renderer);

    var camera = new THREE.PerspectiveCamera(44, W / H, 0.5, 80);
    var camDist = 15.5, camTilt = 22 * Math.PI / 180;
    camera.position.set(0, camDist * Math.cos(camTilt), camDist * Math.sin(camTilt));
    camera.lookAt(0, 0, 0);
    this.camera = camera;
    this._camBase = camera.position.clone();
    this._shake = 0;

    // światła
    var hemi = new THREE.HemisphereLight('#ffeccb', '#2c2013', 0.55);
    scene.add(hemi);
    var key = new THREE.DirectionalLight('#ffe6bd', 2.4);
    key.position.set(-6, 12, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = 7;
    key.shadow.bias = -0.0002;
    key.shadow.normalBias = 0.02;
    key.shadow.camera.far = 40;
    scene.add(key);
    this._key = key;
    var fill = new THREE.DirectionalLight('#9fb4cc', 0.35);
    fill.position.set(7, 6, -5);
    scene.add(fill);

    // fizyka
    var world = new CANNON.World({ gravity: new CANNON.Vec3(0, -34, 0) });
    world.allowSleep = true;
    world.defaultContactMaterial.friction = 0.25;
    world.defaultContactMaterial.restitution = 0.3;
    this.world = world;
    var diceMat = new CANNON.Material('dice');
    var floorMat = new CANNON.Material('floor');
    var wallMat = new CANNON.Material('wall');
    world.addContactMaterial(new CANNON.ContactMaterial(diceMat, floorMat, { friction: 0.3, restitution: 0.3 }));
    world.addContactMaterial(new CANNON.ContactMaterial(diceMat, wallMat, { friction: 0.06, restitution: 0.28 }));
    world.addContactMaterial(new CANNON.ContactMaterial(diceMat, diceMat, { friction: 0.22, restitution: 0.38 }));
    this._matDice = diceMat; this._matFloor = floorMat; this._matWall = wallMat;

    var floorBody = new CANNON.Body({ mass: 0, material: floorMat, shape: new CANNON.Plane() });
    floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    floorBody.userData = { kind: 'floor' };
    world.addBody(floorBody);

    // bryła k12
    var dod = buildDodeca();
    this.dod = dod;

    this._computeRect();
    var U = this.U = this._idealU();

    // stół: blat + filc + ramka
    var tableTex = makeWoodTexture();
    tableTex.repeat.set(3, 3);
    var table = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 90),
      new THREE.MeshStandardMaterial({ map: tableTex, roughness: 0.8, metalness: 0, envMapIntensity: 0.25, color: '#8a6a44' })
    );
    table.rotation.x = -Math.PI / 2;
    table.position.y = -0.06;
    table.receiveShadow = true;
    scene.add(table);

    var felt = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({ map: makeFeltTexture(), roughness: 0.96, metalness: 0, envMapIntensity: 0.18 })
    );
    felt.rotation.x = -Math.PI / 2;
    felt.receiveShadow = true;
    scene.add(felt);
    this.felt = felt;

    var woodTex = makeWoodTexture();
    woodTex.repeat.set(2.2, 0.35);
    this._rimMat = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.55, metalness: 0, envMapIntensity: 0.55, color: '#a87c4e' });
    this._lipMat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0, envMapIntensity: 0.7, color: '#c39a66' });
    this.rims = [];
    this.lips = [];
    for (var r = 0; r < 4; r++) {
      var rim = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this._rimMat);
      rim.castShadow = true;
      rim.receiveShadow = true;
      scene.add(rim);
      this.rims.push(rim);
      var lip = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this._lipMat);
      lip.receiveShadow = true;
      scene.add(lip);
      this.lips.push(lip);
    }
    this.wallBodies = [];
    for (var wb = 0; wb < 5; wb++) { // 4 ściany + sufit
      var body = new CANNON.Body({ mass: 0, material: wallMat });
      body.addShape(new CANNON.Box(new CANNON.Vec3(1, 1, 1)));
      body.userData = { kind: 'wall' };
      world.addBody(body);
      this.wallBodies.push(body);
    }

    // kostki
    var atlasTex = new THREE.CanvasTexture(opts.atlasCanvas);
    atlasTex.colorSpace = THREE.SRGBColorSpace;
    atlasTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    atlasTex.flipY = false;
    this._atlasTex = atlasTex;

    var geo = buildRoundedGeometry(dod, 13, 14);
    var makeHull = function (u) {
      return new CANNON.ConvexPolyhedron({
        vertices: dod.verts.map(function (v) { return new CANNON.Vec3(v[0] * u, v[1] * u, v[2] * u); }),
        faces: dod.faces.map(function (f) { return f.slice(); })
      });
    };
    this._makeHull = makeHull;

    this.dice = [];
    var defs = [
      { symbols: opts.symbolsA, color: '#f4ecd9' },
      { symbols: opts.symbolsB, color: '#f6e8c9' }
    ];
    for (var d = 0; d < 2; d++) {
      var mat = makeDieMaterial(dod, atlasTex, defs[d].symbols, defs[d].color);
      var mesh = new THREE.Mesh(geo, mat);
      mesh.scale.setScalar(U);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      var body = new CANNON.Body({ mass: 1.2, material: diceMat });
      body.linearDamping = 0.09;
      body.angularDamping = 0.14;
      body.allowSleep = true;
      body.sleepSpeedLimit = U * 0.28;
      body.sleepTimeLimit = 0.4;
      body.userData = { kind: 'die', index: d };
      world.addBody(body);
      // oś obciążenia: ścianka drapieżnika (wilk/lis) i przeciwległa
      var pf = defs[d].symbols.indexOf('wolf');
      if (pf < 0) pf = defs[d].symbols.indexOf('fox');
      var af = -1;
      for (var q2 = 0; q2 < 12; q2++) {
        var dq = dod.normals[q2][0] * dod.normals[pf][0] + dod.normals[q2][1] * dod.normals[pf][1] + dod.normals[q2][2] * dod.normals[pf][2];
        if (dq < -0.9999) af = q2;
      }
      var die = {
        mesh: mesh, body: body, symbols: defs[d].symbols, thrown: false, locked: false,
        predFace: pf, antiFace: af, shapeOff: new CANNON.Vec3(),
        plugs: [this._makePlug(pf), this._makePlug(af)]
      };
      mesh.add(die.plugs[0]);
      mesh.add(die.plugs[1]);
      this.dice.push(die);
      this._rebuildBody(d);
      this._bindImpact(body);
    }
    this._layoutTray();
    this._restDice(true);

    // wejście
    this._bindInput();

    // pętla
    this._clock = new THREE.Clock();
    this._acc = 0;
    this._running = true;
    var loop = function () {
      if (!self._running) return;
      requestAnimationFrame(loop);
      self._tick();
    };
    requestAnimationFrame(loop);

    this._bgTimer = 0;
    var syncBg = function () {
      if (document.visibilityState === 'hidden') {
        self._clock.getDelta(); // zrzuć zaległy czas — tło dolicza od teraz
        if (!self._bgTimer) self._bgTimer = setInterval(function () { self._tickHidden(); }, 250);
      } else {
        if (self._bgTimer) { clearInterval(self._bgTimer); self._bgTimer = 0; }
        self._clock.getDelta();
      }
    };
    document.addEventListener('visibilitychange', syncBg);
    syncBg();
  }

  var P = DiceScene.prototype;

  /* ---------- prostokąt tacy z frustum kamery ---------- */
  P._computeRect = function () {
    var W = this.canvas.clientWidth || window.innerWidth;
    var H = this.canvas.clientHeight || window.innerHeight;
    var cam = this.camera;
    cam.aspect = W / H;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    var ins = this.insets;
    var pt = function (px, py) {
      var ndc = new THREE.Vector2((px / W) * 2 - 1, -(py / H) * 2 + 1);
      var ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, cam);
      var t = -ray.ray.origin.y / ray.ray.direction.y;
      return ray.ray.origin.clone().addScaledVector(ray.ray.direction, t);
    };
    var pad = 6;
    var tl = pt(ins.left + pad, ins.top + pad);
    var tr = pt(W - ins.right - pad, ins.top + pad);
    var bl = pt(ins.left + pad, H - ins.bottom - pad);
    var br = pt(W - ins.right - pad, H - ins.bottom - pad);
    var x0 = Math.max(tl.x, bl.x), x1 = Math.min(tr.x, br.x);
    var z0 = Math.max(tl.z, tr.z), z1 = Math.min(bl.z, br.z);
    var sw;
    if (x1 < x0) { sw = x0; x0 = x1; x1 = sw; }
    if (z1 < z0) { sw = z0; z0 = z1; z1 = sw; }
    this.rect = { x0: x0, x1: x1, z0: z0, z1: z1, w: x1 - x0, h: z1 - z0, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 };
  };

  P._layoutTray = function () {
    var r = this.rect, U = this.U;
    var wallH = U * 2.6, wallT = U * 0.55;
    this.felt.scale.set(r.w + wallT * 2, r.h + wallT * 2, 1);
    this.felt.position.set(r.cx, 0, r.cz);
    var defs = [
      { x: r.cx, z: r.z0 - wallT / 2, sx: r.w + wallT * 2, sz: wallT },
      { x: r.cx, z: r.z1 + wallT / 2, sx: r.w + wallT * 2, sz: wallT },
      { x: r.x0 - wallT / 2, z: r.cz, sx: wallT, sz: r.h + wallT * 2 },
      { x: r.x1 + wallT / 2, z: r.cz, sx: wallT, sz: r.h + wallT * 2 }
    ];
    for (var i = 0; i < 4; i++) {
      var d = defs[i], rim = this.rims[i], body = this.wallBodies[i], lip = this.lips[i];
      // przednia (dolna na ekranie) listwa niższa, żeby nie zasłaniać i nie świecić
      var vh = (i === 1) ? wallH * 0.45 : wallH;
      rim.scale.set(d.sx, vh, d.sz);
      rim.position.set(d.x, vh / 2 - 0.02, d.z);
      lip.scale.set(d.sx + 0.02, wallT * 0.22, d.sz + 0.02);
      lip.position.set(d.x, vh - wallT * 0.1, d.z);
      body.shapes[0].halfExtents.set(d.sx / 2, wallH * 2, d.sz / 2);
      body.shapes[0].updateConvexPolyhedronRepresentation();
      body.shapes[0].updateBoundingSphereRadius();
      body.position.set(d.x, wallH, d.z);
      body.updateBoundingRadius();
      body.aabbNeedsUpdate = true;
    }
    // sufit
    var ceil = this.wallBodies[4];
    ceil.shapes[0].halfExtents.set(r.w, 0.5, r.h);
    ceil.shapes[0].updateConvexPolyhedronRepresentation();
    ceil.shapes[0].updateBoundingSphereRadius();
    ceil.position.set(r.cx, this.U * 11, r.cz);
    ceil.updateBoundingRadius();
    ceil.aabbNeedsUpdate = true;
    // kamera cieni obejmuje całą tacę
    if (this._key) {
      var sc = Math.max(r.w, r.h) * 0.8 + 2;
      var kc = this._key.shadow.camera;
      kc.left = -sc; kc.right = sc; kc.top = sc; kc.bottom = -sc;
      kc.updateProjectionMatrix();
    }
  };

  P._idealU = function () {
    return Math.max(0.5, Math.min(this.rect.w, this.rect.h) / 8.6);
  };

  /** Przebudowa rozmiaru kostek, gdy taca istotnie zmieniła proporcje. */
  /** Mosiężna kropka — jawny znacznik ciężarka na wskazanej ściance. */
  P._makePlug = function (face) {
    if (!this._brassMat) {
      this._brassMat = new THREE.MeshStandardMaterial({ color: '#c9a24b', metalness: 0.9, roughness: 0.35, envMapIntensity: 0.9 });
    }
    var n = this.dod.normals[face], t = this.dod.tangents[face];
    var r = this.dod.faceR * 0.66;
    var plug = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.018, 16), this._brassMat);
    plug.position.set(n[0] * 1.003 + t[0] * r, n[1] * 1.003 + t[1] * r, n[2] * 1.003 + t[2] * r);
    plug.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(n[0], n[1], n[2]));
    plug.visible = false;
    return plug;
  };

  /** (Prze)buduje bryłę fizyczną kostki `i` dla bieżącego U i obciążenia this.bias[i]:
      hull dodany z offsetem -e·U·n_drapieżnika, czyli środek masy wędruje KU tej ściance
      przy e > 0 (drapieżnik częściej na dole) i OD niej przy e < 0. */
  P._rebuildBody = function (i) {
    var d = this.dice[i], U = this.U;
    var e = this.bias[i] || 0;
    var n = this.dod.normals[d.predFace];
    d.shapeOff.set(-e * U * n[0], -e * U * n[1], -e * U * n[2]);
    while (d.body.shapes.length) d.body.removeShape(d.body.shapes[0]);
    d.body.addShape(this._makeHull(U), new CANNON.Vec3(d.shapeOff.x, d.shapeOff.y, d.shapeOff.z));
    d.body.updateMassProperties();
    d.body.updateBoundingRadius();
    d.body.sleepSpeedLimit = U * 0.28;
    d.plugs[0].visible = e > 0.004;
    d.plugs[1].visible = e < -0.004;
    var ps = 0.7 + 1.9 * Math.min(1, Math.abs(e)); // plomba rośnie z ciężarem
    d.plugs[0].scale.setScalar(ps);
    d.plugs[1].scale.setScalar(ps);
  };

  /** Obciążenie [eA, eB] w ułamkach U: ±1 = środek masy aż na płaszczyźnie ścianki.
      Stosować między rzutami. */
  P.setBias = function (arr) {
    var a = arr && arr.length === 2 ? arr : [0, 0];
    this.bias = [
      Math.max(-1, Math.min(1, +a[0] || 0)),
      Math.max(-1, Math.min(1, +a[1] || 0))
    ];
    for (var i = 0; i < 2; i++) {
      this._unlockDie(i);
      this._rebuildBody(i);
    }
    if (this.state === 'idle') this._restDice(false);
  };

  /* ---------- transmisja rzutu między telefonami ----------
     Rzut liczy fizyka na telefonie rzucającego; drugi telefon odtwarza wierny
     replay z klatek. Pozycje normalizowane do tacy (różne ekrany = różne tace). */
  P.getNetFrame = function () {
    var r = this.rect, out = [];
    for (var i = 0; i < 2; i++) {
      var m = this.dice[i].mesh, p = m.position, q = m.quaternion;
      out.push([
        +((p.x - r.cx) / (r.w / 2)).toFixed(4),
        +(p.y / this.U).toFixed(3),
        +((p.z - r.cz) / (r.h / 2)).toFixed(4),
        +q.x.toFixed(4), +q.y.toFixed(4), +q.z.toFixed(4), +q.w.toFixed(4)
      ]);
    }
    return out;
  };

  P.setRemoteDriven = function (on) {
    on = !!on;
    if (this.remote === on) return;
    this.remote = on;
    if (on) {
      this._lastNet = null;
      for (var i = 0; i < 2; i++) {
        var b = this.dice[i].body;
        this._unlockDie(i);
        b.velocity.setZero();
        b.angularVelocity.setZero();
        b.sleep();
      }
      this.state = 'idle';
    }
  };

  P.applyNetFrame = function (d) {
    if (!this.remote || !d || d.length !== 2) return;
    var r = this.rect;
    for (var i = 0; i < 2; i++) {
      var m = this.dice[i].mesh, f = d[i];
      m.position.set(r.cx + f[0] * (r.w / 2), f[1] * this.U, r.cz + f[2] * (r.h / 2));
      m.quaternion.set(f[3], f[4], f[5], f[6]).normalize();
    }
    this._lastNet = d;
  };

  /** Koniec transmisji: przenieś finalne transformy z meshy na ciała fizyczne. */
  P.endRemoteRoll = function () {
    var d = this._lastNet, r = this.rect;
    if (d) {
      for (var i = 0; i < 2; i++) {
        var die = this.dice[i], f = d[i], b = die.body;
        die.mesh.quaternion.set(f[3], f[4], f[5], f[6]).normalize();
        b.quaternion.set(die.mesh.quaternion.x, die.mesh.quaternion.y, die.mesh.quaternion.z, die.mesh.quaternion.w);
        var wo = this._tmpV.set(die.shapeOff.x, die.shapeOff.y, die.shapeOff.z).applyQuaternion(die.mesh.quaternion);
        b.position.set(
          r.cx + f[0] * (r.w / 2) - wo.x,
          f[1] * this.U - wo.y,
          r.cz + f[2] * (r.h / 2) - wo.z
        );
        b.velocity.setZero();
        b.angularVelocity.setZero();
        b.sleep();
      }
    }
    this.remote = false;
    this._lastNet = null;
  };

  /* ---------- podgląd 3D kostek w panelu zaawansowanym ----------
     Kostka PÓŁPRZEZROCZYSTA, a w środku mosiężna kula-ciężarek na PRAWDZIWEJ
     pozycji wzdłuż osi drapieżnik↔przeciwległa: 0 = środek bryły, ±100% = kula
     dotyka ścianki od wewnątrz. Oś leży poziomo, zgodnie z kierunkiem suwaka. */
  P.previewBias = function (cvA, cvB, biasArr) {
    if (!this._prev) {
      this._prev = [];
      for (var i = 0; i < 2; i++) {
        var cv = i === 0 ? cvA : cvB;
        var r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
        r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        r.setSize(96, 96, false);
        r.outputColorSpace = THREE.SRGBColorSpace;
        r.toneMapping = THREE.ACESFilmicToneMapping;
        var sc = new THREE.Scene();
        sc.environment = this.scene.environment; // mosiądz potrzebuje odbić
        sc.add(new THREE.HemisphereLight('#ffeccb', '#3a2c1c', 1.0));
        var dl = new THREE.DirectionalLight('#ffe6bd', 2.2);
        dl.position.set(-2, 3, 4);
        sc.add(dl);
        var cam = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
        cam.position.set(0, 0.7, 4.6);
        cam.lookAt(0, 0, 0);
        var die = this.dice[i];
        var shellMat = makeDieMaterial(this.dod, this._atlasTex, die.symbols, '#' + die.mesh.material.color.getHexString());
        shellMat.transparent = true;
        shellMat.opacity = 0.4;
        shellMat.depthWrite = false;
        var shell = new THREE.Mesh(die.mesh.geometry, shellMat);
        shell.renderOrder = 2; // skorupa MALOWANA PO kuli → kula widoczna „w środku”
        if (!this._brassMat) this._makePlug(die.predFace); // inicjalizacja materiału
        var ball = new THREE.Mesh(new THREE.SphereGeometry(0.155, 20, 14), this._brassMat);
        ball.renderOrder = 1;
        shell.add(ball);
        // oś drapieżnik↔przeciwległa poziomo: drapieżnik w prawo (jak suwak)
        var n = this.dod.normals[die.predFace];
        shell.quaternion.setFromUnitVectors(
          new THREE.Vector3(n[0], n[1], n[2]),
          new THREE.Vector3(0.93, 0.14, 0.34).normalize()
        );
        sc.add(shell);
        this._prev.push({ r: r, sc: sc, cam: cam, ball: ball, n: n });
      }
    }
    for (var j = 0; j < 2; j++) {
      var e = (biasArr && biasArr[j]) || 0;
      var pv = this._prev[j];
      pv.ball.visible = Math.abs(e) > 0.01;
      var t = e * (1 - 0.155); // przy ±100% kula styka się ze ścianką od wewnątrz
      pv.ball.position.set(pv.n[0] * t, pv.n[1] * t, pv.n[2] * t);
      pv.r.render(pv.sc, pv.cam);
    }
  };

  P._resizeDice = function () {
    var ideal = this._idealU();
    if (Math.abs(ideal - this.U) / this.U < 0.12) return;
    this.U = ideal;
    for (var i = 0; i < 2; i++) {
      this.dice[i].mesh.scale.setScalar(ideal);
      this._rebuildBody(i);
    }
    // po zmianie rozmiaru ustaw kostki na czysto (o ile nie są w locie)
    if (this.state === 'idle') this._restDice(false);
  };

  P.setInsets = function (ins) {
    this.insets = ins;
    this._computeRect();
    this._resizeDice();
    this._layoutTray();
    this._clampDice();
  };

  P.resize = function () {
    var W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    this.renderer.setSize(W, H, false);
    this._computeRect();
    this._resizeDice();
    this._layoutTray();
    this._clampDice();
  };

  P._clampDice = function () {
    var r = this.rect, U = this.U;
    for (var i = 0; i < 2; i++) {
      var b = this.dice[i].body;
      b.position.x = Math.min(Math.max(b.position.x, r.x0 + U), r.x1 - U);
      b.position.z = Math.min(Math.max(b.position.z, r.z0 + U), r.z1 - U);
      b.aabbNeedsUpdate = true;
    }
  };

  /* ---------- ustawienie spoczynkowe ---------- */
  P._restDice = function (initial) {
    var r = this.rect, U = this.U;
    for (var i = 0; i < 2; i++) {
      this._unlockDie(i);
      var b = this.dice[i].body;
      var f = Math.floor(Math.random() * 12);
      var n = this.dod.normals[f];
      var q = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(n[0], n[1], n[2]), new THREE.Vector3(0, -1, 0));
      var yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);
      yaw.multiply(q);
      b.quaternion.set(yaw.x, yaw.y, yaw.z, yaw.w);
      var so = this.dice[i].shapeOff;
      var oy = this._tmpV.set(so.x, so.y, so.z).applyQuaternion(yaw).y;
      b.position.set(r.cx + (i === 0 ? -1.35 : 1.35) * U, U - oy + 0.01, r.cz + r.h * 0.18 + (i === 0 ? 0.2 : -0.2) * U);
      b.velocity.setZero();
      b.angularVelocity.setZero();
      b.sleep();
    }
  };

  /* ---------- blokada ustabilizowanej kostki („ze stali”) ----------
     Kostka wyrzucona z palca, która znieruchomiała płasko na filcu, staje się
     ciałem statycznym do końca rzutu: nie da się jej ponownie złapać ani
     potrącić drugą kostką. Przekrzywiona NIE zastyga — czeka ją uczciwy przerzut. */
  P._lockDie = function (i) {
    var d = this.dice[i];
    if (d.locked) return;
    var b = d.body;
    b.velocity.setZero();
    b.angularVelocity.setZero();
    b.type = CANNON.Body.STATIC;
    b.mass = 0;
    b.updateMassProperties();
    d.locked = true;
  };

  P._unlockDie = function (i) {
    var d = this.dice[i];
    d.thrown = false;
    if (!d.locked) return;
    var b = d.body;
    b.type = CANNON.Body.DYNAMIC;
    b.mass = 1.2;
    b.updateMassProperties();
    d.locked = false;
  };

  P._lockSettledDice = function () {
    if (this.state !== 'flying' && this.state !== 'held') return;
    for (var i = 0; i < 2; i++) {
      var d = this.dice[i];
      if (!d.thrown || d.locked) continue;
      var b = d.body;
      if (b.sleepState !== CANNON.Body.SLEEPING) continue;
      // wysokość GEOMETRYCZNEGO środka bryły (origin ciała = środek masy, przy
      // obciążeniu przesunięty nawet o cały U) — leży na filcu, nie na drugiej kostce
      var gy = b.position.y + this._tmpV.set(d.shapeOff.x, d.shapeOff.y, d.shapeOff.z)
        .applyQuaternion(d.mesh.quaternion).y;
      if (gy > this.U * 1.35) continue;
      if (this._faceUp(d).dot < 0.99999) continue;  // przekrzywiona zostaje żywa
      this._lockDie(i);
    }
  };

  /* ---------- zderzenia → dźwięk ---------- */
  P._bindImpact = function (body) {
    var self = this;
    body.addEventListener('collide', function (e) {
      var now = performance.now();
      if (now - self._impactLast < 40) return;
      var v = Math.abs(e.contact.getImpactVelocityAlongNormal());
      if (v < self.U * 1.6) return;
      self._impactLast = now;
      var other = e.body.userData ? e.body.userData.kind : 'floor';
      var strength = Math.min(1, v / (self.U * 26));
      self.onImpact(other, strength);
    });
  };

  /* ---------- wejście: przeciągnij i rzuć (multi-touch: palec per kostka) ---------- */
  P._bindInput = function () {
    var self = this;
    var cv = this.canvas;
    cv.style.touchAction = 'none';
    this._holds = {}; // pointerId -> { dice:[idx..], target, history:[] }

    var toWorld = function (px, py, planeY) {
      var W = cv.clientWidth, H = cv.clientHeight;
      var ndc = new THREE.Vector2((px / W) * 2 - 1, -(py / H) * 2 + 1);
      var ray = new THREE.Raycaster();
      self.camera.updateMatrixWorld(true);
      ray.setFromCamera(ndc, self.camera);
      var t = (planeY - ray.ray.origin.y) / ray.ray.direction.y;
      return ray.ray.origin.clone().addScaledVector(ray.ray.direction, t);
    };

    var heldDice = function () {
      var s = {};
      for (var id in self._holds) self._holds[id].dice.forEach(function (i) { s[i] = id; });
      return s;
    };
    var nearestDie = function (w, cand) {
      var best = cand[0], bd = 1e9;
      for (var i = 0; i < cand.length; i++) {
        var p = self.dice[cand[i]].body.position;
        var d = (p.x - w.x) * (p.x - w.x) + (p.z - w.z) * (p.z - w.z);
        if (d < bd) { bd = d; best = cand[i]; }
      }
      return best;
    };

    cv.addEventListener('pointerdown', function (e) {
      if (!self.interactive || (self.state !== 'idle' && self.state !== 'held')) return;
      var w = toWorld(e.clientX, e.clientY, self.U * 2.1);
      var held = heldDice();
      var assign = [];
      if (Object.keys(self._holds).length === 0) {
        assign = [0, 1]; // pierwszy palec bierze obie
      } else {
        var free = [0, 1].filter(function (i) { return !(i in held) && !self.dice[i].thrown; });
        if (free.length > 0) {
          assign = [nearestDie(w, free)];
        } else {
          // drugi palec przejmuje bliższą kostkę od palca trzymającego dwie
          var two = null;
          for (var id in self._holds) if (self._holds[id].dice.length === 2) two = id;
          if (two === null) return;
          var steal = nearestDie(w, self._holds[two].dice);
          self._holds[two].dice = self._holds[two].dice.filter(function (i) { return i !== steal; });
          assign = [steal];
        }
      }
      var wasEmpty = Object.keys(self._holds).length === 0;
      self._holds[e.pointerId] = { dice: assign, target: w.clone(), history: [{ x: w.x, z: w.z, t: performance.now() }] };
      assign.forEach(function (i) { self.dice[i].body.wakeUp(); });
      self.state = 'held';
      try { cv.setPointerCapture(e.pointerId); } catch (err) {}
      if (wasEmpty) self.onHold(true);
      e.preventDefault();
    });

    cv.addEventListener('pointermove', function (e) {
      var hold = self._holds[e.pointerId];
      if (!hold || self.state !== 'held') return;
      var w = toWorld(e.clientX, e.clientY, self.U * 2.1);
      var t = performance.now();
      hold.history.push({ x: w.x, z: w.z, t: t });
      while (hold.history.length > 2 && t - hold.history[0].t > 130) hold.history.shift();
      var r = self.rect, m = self.U * 1.5;
      w.x = Math.min(Math.max(w.x, r.x0 + m), r.x1 - m);
      w.z = Math.min(Math.max(w.z, r.z0 + m), r.z1 - m);
      hold.target = w;
      e.preventDefault();
    });

    var finish = function (e) {
      var hold = self._holds[e.pointerId];
      if (!hold) return;
      delete self._holds[e.pointerId];
      if (self.state === 'held') self._flingDice(hold);
      if (Object.keys(self._holds).length === 0 && self.state === 'held') {
        self._startFlight();
        self.onHold(false);
      }
    };
    cv.addEventListener('pointerup', finish);
    cv.addEventListener('pointercancel', finish);
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  };

  P._holdVelocity = function (hold) {
    var h = hold.history;
    if (!h || h.length < 2) return new THREE.Vector3();
    var a = h[0], b = h[h.length - 1];
    var dt = Math.max(0.016, (b.t - a.t) / 1000);
    return new THREE.Vector3((b.x - a.x) / dt, 0, (b.z - a.z) / dt);
  };

  /** Wyrzuca kostki trzymane przez dany chwyt z prędkością gestu. */
  P._flingDice = function (hold) {
    var U = this.U;
    var v = this._holdVelocity(hold);
    var speed = v.length();
    var maxS = U * 34;
    if (speed > maxS) { v.multiplyScalar(maxS / speed); speed = maxS; }
    if (speed < U * 5) {
      // zbyt delikatnie — dorzuć wyrzut, żeby rzut zawsze był uczciwy
      var a = Math.random() * Math.PI * 2;
      v.add(new THREE.Vector3(Math.cos(a) * U * 7, 0, Math.sin(a) * U * 7));
    }
    for (var k = 0; k < hold.dice.length; k++) {
      this.dice[hold.dice[k]].thrown = true;
      var b = this.dice[hold.dice[k]].body;
      b.wakeUp();
      b.velocity.set(v.x * 1.05, U * (4.5 + Math.random() * 2.5) + speed * 0.10, v.z * 1.05);
      var s = 6 + Math.min(20, speed / U * 0.7);
      b.angularVelocity.set(
        (Math.random() - 0.5) * s * 2,
        (Math.random() - 0.5) * s,
        (Math.random() - 0.5) * s * 2
      );
    }
  };

  P.throwAuto = function () {
    var U = this.U, r = this.rect;
    for (var i = 0; i < 2; i++) {
      this._unlockDie(i);
      this.dice[i].thrown = true;
      var b = this.dice[i].body;
      b.wakeUp();
      b.position.y = Math.max(b.position.y, U * 2.2);
      // każda kostka celuje w inny punkt — nie klinują się na środku
      var tx = r.cx + (i === 0 ? -1 : 1) * r.w * 0.14 + (Math.random() - 0.5) * U * 2;
      var tz = r.cz + (Math.random() - 0.5) * r.h * 0.3;
      var dx = tx - b.position.x, dz = tz - b.position.z;
      var l = Math.hypot(dx, dz) || 1;
      var sp = U * (9 + Math.random() * 5);
      b.velocity.set(dx / l * sp, U * (4.5 + Math.random() * 2), dz / l * sp);
      var s = 14 + Math.random() * 9;
      b.angularVelocity.set((Math.random() - 0.5) * s * 2, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s * 2);
    }
    this._startFlight();
  };

  P._startFlight = function () {
    this.state = 'flying';
    this._settleTimer = 0;
    this._flightTime = 0;
    this._cockedTries = 0;
    this.onThrow();
  };

  /* ---------- odczyt ścianki na górze ---------- */
  P._faceUp = function (die) {
    var best = -1, bd = -2;
    var q = die.body.quaternion;
    for (var f = 0; f < 12; f++) {
      var n = this.dod.normals[f];
      var wv = q.vmult(new CANNON.Vec3(n[0], n[1], n[2]));
      if (wv.y > bd) { bd = wv.y; best = f; }
    }
    return { face: best, dot: bd, symbol: die.symbols[best] };
  };

  /* ---------- główna pętla ---------- */
  P._tick = function () {
    var dt = Math.min(0.05, this._clock.getDelta());
    this._acc += dt;
    var step = 1 / 120;
    var guard = 0;
    while (this._acc >= step && guard < 10) {
      this._physStep(step);
      this._acc -= step;
      guard++;
    }
    if (guard >= 10) this._acc = 0;

    this._lockSettledDice();

    // watchdog: kostka poza tacą lub pod stołem → ratunkowy powrót
    var r = this.rect, U = this.U;
    for (var w = 0; w < 2; w++) {
      if (this.remote || this.dice[w].locked) continue;
      var wb = this.dice[w].body;
      if (wb.position.y < -U * 2 || wb.position.y > U * 30 ||
          wb.position.x < r.x0 - U * 4 || wb.position.x > r.x1 + U * 4 ||
          wb.position.z < r.z0 - U * 4 || wb.position.z > r.z1 + U * 4) {
        wb.position.set(
          r.cx + (w === 0 ? -1.4 : 1.4) * U,
          U * 3,
          r.cz
        );
        wb.velocity.set(0, -U * 2, 0);
        wb.angularVelocity.set(Math.random() * 4, Math.random() * 4, Math.random() * 4);
        wb.wakeUp();
      }
    }

    this._syncMeshes();

    // drganie kamery
    if (this._shake > 0.002) {
      this._shake *= Math.pow(0.0015, dt);
      var s = this._shake * this.U;
      this.camera.position.set(
        this._camBase.x + (Math.random() - 0.5) * s,
        this._camBase.y + (Math.random() - 0.5) * s * 0.6,
        this._camBase.z + (Math.random() - 0.5) * s
      );
    } else if (this._shake !== 0) {
      this._shake = 0;
      this.camera.position.copy(this._camBase);
    }

    this._checkSettle(dt);
    this.renderer.render(this.scene, this.camera);
  };

  P._syncMeshes = function () {
    if (this.remote) return; // mesh sterowany transmisją z drugiego telefonu
    for (var i = 0; i < 2; i++) {
      var d = this.dice[i];
      d.mesh.quaternion.copy(d.body.quaternion);
      d.mesh.position.copy(d.body.position);
      var so = d.shapeOff;
      if (so.x !== 0 || so.y !== 0 || so.z !== 0) {
        d.mesh.position.add(this._tmpV.set(so.x, so.y, so.z).applyQuaternion(d.mesh.quaternion));
      }
    }
  };

  /** Karta w tle: rAF stoi, więc lot kostek dolicza timer — te same kroki 1/120,
      tylko inny zegar. Bez tego rzut zamiera, a w grze sieciowej przeciwnik czeka. */
  P._tickHidden = function () {
    if (this.state !== 'flying') return;
    var dt = Math.min(2.5, this._clock.getDelta());
    this._acc += dt;
    var step = 1 / 120, guard = 0;
    while (this._acc >= step && guard < 300) {
      this._physStep(step);
      this._acc -= step;
      guard++;
    }
    if (guard >= 300) this._acc = 0;
    this._syncMeshes();
    this._checkSettle(dt);
  };

  P._physStep = function (step) {
    if (this.state === 'held') {
      var U = this.U;
      for (var pid in this._holds) {
        var hold = this._holds[pid];
        for (var hi = 0; hi < hold.dice.length; hi++) {
          var b = this.dice[hold.dice[hi]].body;
          b.wakeUp();
          // dwie kostki na jednym palcu — rozsunięte, jedna — pod palcem
          var off = hold.dice.length === 2 ? (hi === 0 ? -1.6 : 1.6) * U : 0;
          var tx = hold.target.x + off, tz = hold.target.z;
          var ty = U * 2.1;
          var k = 130, c = 11;
          b.force.x += (tx - b.position.x) * k * b.mass - b.velocity.x * c * b.mass;
          b.force.y += (ty - b.position.y) * k * b.mass - b.velocity.y * c * b.mass;
          b.force.z += (tz - b.position.z) * k * b.mass - b.velocity.z * c * b.mass;
          b.angularVelocity.scale(0.94, b.angularVelocity);
        }
      }
    }
    // tłumik dogasania: powolne turlanie i grzechot przy ścianach ma szybko usnąć,
    // ale żywy rzut zostaje nietknięty
    if (this.state === 'flying') {
      for (var di = 0; di < 2; di++) {
        var db = this.dice[di].body;
        if (db.sleepState !== CANNON.Body.SLEEPING && db.velocity.length() < this.U * 2.4) {
          db.velocity.scale(0.965, db.velocity);
          db.angularVelocity.scale(0.955, db.angularVelocity);
        }
      }
    }
    this.world.step(step);
  };

  P._checkSettle = function (dt) {
    if (this.state !== 'flying') return;
    var calm = true;
    var U = this.U;
    this._flightTime += dt;
    var overtime = this._flightTime > 6.5; // bezpiecznik: nigdy nie wisimy w nieskończoność
    for (var i = 0; i < 2; i++) {
      var b = this.dice[i].body;
      if (b.sleepState !== CANNON.Body.SLEEPING) {
        if (b.velocity.length() > U * 0.55 || b.angularVelocity.length() > 0.6) { calm = false; break; }
      }
    }
    if (!calm && !overtime) { this._settleTimer = 0; return; }
    this._settleTimer += dt;
    if (this._settleTimer < 0.4 && !overtime) return;

    // kostka wolnostojąca osiada <0.05° od poziomu sama z siebie;
    // każdy większy przechył = kostka o coś oparta => uczciwy przerzut
    var results = [], leaning = false;
    for (var j = 0; j < 2; j++) {
      var r = this._faceUp(this.dice[j]);
      results.push(r);
      if (r.dot < 0.99999) leaning = true;
    }
    if (leaning && this._cockedTries < 5 && !overtime) {
      this._cockedTries++;
      this._settleTimer = 0;
      this._flightTime = 0; // bezpiecznik liczy czas od OSTATNIEGO przerzutu; całość ogranicza licznik prób
      for (var m = 0; m < 2; m++) {
        var bb = this.dice[m].body;
        if (results[m].dot < 0.99999) {
          bb.wakeUp();
          // przerzut w najbardziej wolne miejsce: kandydaci = ku środkowi, od drugiej
          // kostki i po stycznych; wygrywa kierunek z największym prześwitem od
          // przeszkód (druga kostka — może być zastygnięta „ze stali” — oraz ściany)
          var ob = this.dice[1 - m].body;
          var r0 = this.rect;
          var px = bb.position.x, pz = bb.position.z;
          var cands = [];
          var cdx = r0.cx - px, cdz = r0.cz - pz;
          var cl = Math.hypot(cdx, cdz);
          if (cl > 1e-6) cands.push([cdx / cl, cdz / cl]);
          var ax = px - ob.position.x, az = pz - ob.position.z;
          var ad = Math.hypot(ax, az);
          if (ad > 1e-6) {
            cands.push([ax / ad, az / ad]);
            cands.push([-az / ad, ax / ad]);
            cands.push([az / ad, -ax / ad]);
          }
          if (!cands.length) cands.push([1, 0]);
          var dirx = cands[0][0], dirz = cands[0][1], bestScore = -1e9;
          for (var ci = 0; ci < cands.length; ci++) {
            var tx = px + cands[ci][0] * U * 2, tz = pz + cands[ci][1] * U * 2;
            var dOther = Math.hypot(tx - ob.position.x, tz - ob.position.z);
            var dWall = Math.min(tx - r0.x0, r0.x1 - tx, tz - r0.z0, r0.z1 - tz);
            var score = Math.min(dOther, dWall);
            if (score > bestScore) { bestScore = score; dirx = cands[ci][0]; dirz = cands[ci][1]; }
          }
          bb.position.y += U * 0.5;
          bb.position.x = Math.min(Math.max(px + dirx * U * 0.6, r0.x0 + U), r0.x1 - U);
          bb.position.z = Math.min(Math.max(pz + dirz * U * 0.6, r0.z0 + U), r0.z1 - U);
          bb.velocity.set(dirx * U * 2.4, U * 2.2, dirz * U * 2.4);
          bb.angularVelocity.set((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 2.5, (Math.random() - 0.5) * 5);
        }
      }
      return;
    }
    // ŻADNEGO obracania kostek po rzucie — leżą tak, jak upadły.
    // Bryła jest poprawnym dwunastościanem foremnym (każda para ścianek
    // równoległa), więc spoczynek na płask daje górną ściankę poziomą sam z siebie.
    this.state = 'idle';
    for (var un = 0; un < 2; un++) this._unlockDie(un);
    this.onSettle([results[0].symbol, results[1].symbol]);
  };

  /* ---------- API ---------- */
  P.setInteractive = function (on) {
    this.interactive = !!on;
    if (!on && this.state === 'held') {
      for (var pid in this._holds) this._flingDice(this._holds[pid]);
      this._holds = {};
      this._startFlight();
      this.onHold(false);
    }
  };

  P.isBusy = function () { return this.state === 'flying' || this.state === 'held'; };

  P.shake = function (power) {
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    this._shake = Math.max(this._shake, power || 0.6);
  };

  P.getDieScreenPos = function (i) {
    var v = new THREE.Vector3().copy(this.dice[i].mesh.position);
    v.project(this.camera);
    var W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    return { x: (v.x + 1) / 2 * W, y: (-v.y + 1) / 2 * H };
  };

  P.getFacesUp = function () {
    return [this._faceUp(this.dice[0]).symbol, this._faceUp(this.dice[1]).symbol];
  };

  return DiceScene;
})();
