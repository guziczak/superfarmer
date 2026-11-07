/* ============================================================
   SUPERFARMER — scena 3D: kostki k12, taca, fizyka, rzut gestem
   Wymaga globali: THREE, CANNON, SYMBOLS.
   Global: DiceScene
   ============================================================ */
var DiceScene = (function () {
  'use strict';

  var PHI = (1 + Math.sqrt(5)) / 2;
  var DIE_STYLES = [
    { body: '#f4ecd9', edge: '#e1d5b8' },
    { body: '#f6e8c9', edge: '#e4d2aa' }
  ];

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

  /** Wierzchołki bryły z płaszczyzn n_i·x = hs[i] (przecięcia trójek płaszczyzn jak
      w oryginale — kierunki normalnych zostają, „szlif” przesuwa tylko płaszczyzny). */
  function deformVerts(dod, hs) {
    var vFaces = dod.verts.map(function () { return []; });
    dod.faces.forEach(function (f, fi) { f.forEach(function (vi) { vFaces[vi].push(fi); }); });
    function det3(r1, r2, r3) {
      return r1[0] * (r2[1] * r3[2] - r2[2] * r3[1])
           - r1[1] * (r2[0] * r3[2] - r2[2] * r3[0])
           + r1[2] * (r2[0] * r3[1] - r2[1] * r3[0]);
    }
    return dod.verts.map(function (v, vi) {
      var a = vFaces[vi][0], b = vFaces[vi][1], c = vFaces[vi][2];
      var n1 = dod.normals[a], n2 = dod.normals[b], n3 = dod.normals[c];
      var d = det3(n1, n2, n3);
      return [
        det3([hs[a], n1[1], n1[2]], [hs[b], n2[1], n2[2]], [hs[c], n3[1], n3[2]]) / d,
        det3([n1[0], hs[a], n1[2]], [n2[0], hs[b], n2[2]], [n3[0], hs[c], n3[2]]) / d,
        det3([n1[0], n1[1], hs[a]], [n2[0], n2[1], hs[b]], [n3[0], n3[1], hs[c]]) / d
      ];
    });
  }

  /* ---------- zaokrąglony mesh przez smooth-max (LogSumExp) ---------- */
  function buildRoundedGeometry(dod, K, detail, hs) {
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
        d[f] = (ux * N[f][0] + uy * N[f][1] + uz * N[f][2]) / (hs ? hs[f] : 1);
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
        // Gradient LSE uwzględnia również skalę płaszczyzny przy szlifie.
        var invH = 1 / (hs ? hs[f] : 1);
        wnx += w * N[f][0] * invH; wny += w * N[f][1] * invH; wnz += w * N[f][2] * invH;
      }
      var wl = Math.hypot(wnx, wny, wnz);
      pos.setXYZ(i, ux * t, uy * t, uz * t);
      nrm[i * 3] = wnx / wl; nrm[i * 3 + 1] = wny / wl; nrm[i * 3 + 2] = wnz / wl;
    }
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.attributes.position.needsUpdate = true;
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    var outline = [];
    // Próbki tej samej gładkiej powierzchni służą sylwetce w trybie Canvas.
    for (i = 0; i < pos.count; i += 15) outline.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
    geo.userData.sfRounded = { K: K, heights: hs ? hs.slice() : dod.normals.map(function () { return 1; }),
      hull: hs ? deformVerts(dod, hs) : dod.verts, outline: outline };
    return geo;
  }

  /* ---------- materiał kostki z symbolami w shaderze ---------- */
  function makeDieMaterial(dod, atlasTex, symbols, style) {
    var mat = new THREE.MeshPhysicalMaterial({
      color: style.body,
      roughness: 0.40,
      metalness: 0.0,
      clearcoat: 0.18,
      clearcoatRoughness: 0.42,
      envMapIntensity: 0.5
    });
    mat.userData.sfStyle = style;
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
          '  vec3 sn = normalize(sfNor);',
          '  for (int i = 0; i < 12; i++) { float d = dot(sn, uFaceN[i]); if (d > bd) { bd = d; best = i; } }',
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
    mat.customProgramCacheKey = function () { return 'sf-resin-v3-' + symbols.join(''); };
    return mat;
  }

  /* ---------- naturalne materiały: filc i olejowane drewno ---------- */
  // Osobne, deterministyczne ziarno dekoracji: odświeżenie grafiki nie zużywa
  // losowań używanych przez rzuty i nie zmienia usłojenia po resize.
  function materialRandom(seed) {
    return function () {
      seed = Math.imul(seed, 1664525) + 1013904223 | 0;
      return (seed >>> 0) / 4294967296;
    };
  }

  function drawFeltArtwork(c, w, h) {
    var side = Math.min(w, h), random = materialRandom(81571);
    var gradient = c.createRadialGradient(w * 0.44, h * 0.37, side * 0.08, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
    gradient.addColorStop(0, '#35573d'); gradient.addColorStop(0.7, '#2c4e35'); gradient.addColorStop(1, '#213d2a');
    c.fillStyle = gradient; c.fillRect(0, 0, w, h);
    // Filc ma nieregularne krótkie włókna, a nie graficzną kratkę lub emblemat.
    var scale = Math.max(0.6, Math.max(w, h) / 1024);
    for (var i = 0; i < 11000; i++) {
      var x = random() * w, y = random() * h;
      var angle = random() * Math.PI, length = (1.2 + random() * 2.6) * scale;
      c.strokeStyle = random() < 0.53 ? 'rgba(224,228,191,0.035)' : 'rgba(6,23,10,0.065)';
      c.lineWidth = 0.65 * scale;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length); c.stroke();
    }
  }

  function makeFeltTexture(aspect) {
    var cv = document.createElement('canvas');
    aspect = aspect || 1;
    cv.width = Math.round(aspect >= 1 ? 1024 : Math.max(256, 1024 * aspect));
    cv.height = Math.round(aspect >= 1 ? Math.max(256, 1024 / aspect) : 1024);
    drawFeltArtwork(cv.getContext('2d'), cv.width, cv.height);
    var t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  function drawWoodArtwork(c, w, h) {
    var random = materialRandom(14639), scale = h / 512;
    c.fillStyle = '#755039'; c.fillRect(0, 0, w, h);
    var tint = c.createLinearGradient(0, 0, w * 0.15, h);
    tint.addColorStop(0, 'rgba(235,185,119,0.16)'); tint.addColorStop(0.45, 'rgba(45,24,15,0.08)'); tint.addColorStop(1, 'rgba(214,156,94,0.1)');
    c.fillStyle = tint; c.fillRect(0, 0, w, h);
    // Długie włókna z łagodnym falowaniem, bez dużych czarnych „sęków”.
    for (var i = 0; i < 390; i++) {
      var y = random() * h, amplitude = (0.5 + random() * 3.4) * scale;
      var phase = random() * Math.PI * 2, frequency = 1 + random() * 1.4;
      c.strokeStyle = i % 4 ? 'rgba(43,24,15,' + (0.035 + random() * 0.09) + ')' : 'rgba(228,184,128,' + (0.03 + random() * 0.07) + ')';
      c.lineWidth = (0.35 + random() * 1.2) * Math.max(0.7, scale);
      c.beginPath();
      for (var j = 0; j <= 64; j++) {
        var x = j * w / 64;
        var yy = y + Math.sin(j / 64 * Math.PI * 2 * frequency + phase) * amplitude + Math.sin(j / 64 * Math.PI * 8 + phase) * scale * 0.4;
        if (!j) c.moveTo(x, yy); else c.lineTo(x, yy);
      }
      c.stroke();
    }
  }

  function makeWoodTexture() {
    var cv = document.createElement('canvas'); cv.width = 1024; cv.height = 512;
    drawWoodArtwork(cv.getContext('2d'), cv.width, cv.height);
    var t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }

  function roundedShape(w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    var s = new THREE.Shape(), x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); s.closePath();
    return s;
  }

  function trayRing(w, h, corner, band, depth, bevel) {
    var shape = roundedShape(w + band * 2, h + band * 2, corner + band);
    shape.holes.push(new THREE.Path(roundedShape(w, h, corner).getPoints(10).reverse()));
    var geometry = new THREE.ExtrudeGeometry(shape, {
      depth: depth, steps: 1, curveSegments: 10, bevelEnabled: bevel > 0,
      bevelSegments: 3, bevelSize: bevel, bevelThickness: bevel
    });
    // Słoje biegną wzdłuż każdej listwy; narożniki czytają się jak łączenie drewna.
    var positions = geometry.attributes.position, uv = geometry.attributes.uv;
    for (var i = 0; i < positions.count; i++) {
      var x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
      var vertical = Math.abs(x) / (w / 2) > Math.abs(y) / (h / 2);
      var along = vertical ? y : x, across = vertical ? Math.abs(x) - w / 2 : Math.abs(y) - h / 2;
      uv.setXY(i, along * 0.13, across * 0.7 + z * 0.45);
    }
    return geometry;
  }

  function feltGeometry(w, h, corner) {
    var geo = new THREE.ShapeGeometry(roundedShape(w, h, corner), 10);
    var pos = geo.attributes.position, uv = geo.attributes.uv;
    for (var i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
    return geo;
  }

  /* ---------- otoczenie studyjne do odbić (PMREM) ---------- */
  function makeEnvironment(renderer) {
    var scene = new THREE.Scene();
    var geo = new THREE.SphereGeometry(30, 16, 12);
    var bg = new THREE.MeshBasicMaterial({ side: THREE.BackSide });
    bg.color = new THREE.Color('#30261c');
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
    box(-7, 8, 5, 10, 7, '#fff3de', 4.2);   // światło dużego okna
    box(6, 7, -4, 6, 4, '#f6e7cf', 2.0);   // ciepłe odbicie pomieszczenia
    box(0, 4, -8, 7, 2, '#bbcce0', 1.3);   // delikatny chłodny refleks
    box(0, -6, 0, 12, 12, '#483423', 0.7); // drewno odbite pod kostką
    var pmrem = new THREE.PMREMGenerator(renderer);
    var env = pmrem.fromScene(scene, 0.035);
    pmrem.dispose();
    return env.texture;
  }

  /* ---------- zgodny widok Canvas 2D: te same bryły i wynik fizyki ---------- */
  function context2DFor(canvas) {
    var ctx = null;
    try { ctx = canvas.getContext('2d'); } catch (err) {}
    // Nieudana inicjalizacja WebGL mogła już zająć kontekst canvasa.
    if (!ctx && canvas.parentNode) {
      var replacement = canvas.cloneNode(false);
      canvas.parentNode.replaceChild(replacement, canvas);
      canvas = replacement;
      ctx = canvas.getContext('2d');
    }
    if (!ctx) throw new Error('Przeglądarka nie udostępnia grafiki Canvas 2D.');
    return { canvas: canvas, ctx: ctx };
  }

  function roundedRect2D(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function makeCanvasRenderer(owner) {
    var surface = context2DFor(owner.canvas);
    owner.canvas = surface.canvas;
    owner.compatibilityMode = true;
    var ratio = 1, width = 1, height = 1;
    return {
      domElement: surface.canvas,
      shadowMap: {},
      capabilities: { getMaxAnisotropy: function () { return 1; } },
      setPixelRatio: function (value) { ratio = value || 1; },
      setSize: function (w, h) {
        width = Math.max(1, w); height = Math.max(1, h);
        surface.canvas.width = Math.round(width * ratio);
        surface.canvas.height = Math.round(height * ratio);
        owner._canvasBackground = null;
      },
      setClearColor: function () {},
      render: function () { owner._drawCompatibility(surface.ctx, width, height, ratio); },
      dispose: function () {}
    };
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
    this.onRollError = opts.onRollError || function () {};
    this.compatibilityMode = false;
    this._needsRender = true;
    this.interactive = false;
    this.state = 'idle'; // idle | held | flying | snapping
    this.insets = { top: 0, right: 0, bottom: 0, left: 0 };
    this._impactLast = 0;
    this._settleTimer = 0;
    this._cockedTries = 0;
    this.mode = 'w';    // 'w' = ciężarek (środek masy), 's' = szlif (deformacja bryły)
    this.bias = [0, 0]; // obciążenie [kostka A, kostka B] w ułamkach U; + = ciężarek przy drapieżniku
    this.shape = [0, 0]; // szlif [A, B] w -1..1; + = przeciwległa ścianka mniejsza (drapieżnik rzadziej)
    this.remote = false; // true = kostki odtwarzają transmisję rzutu z drugiego telefonu
    this._lastNet = null;
    this._tmpV = new THREE.Vector3();

    var W = this.canvas.clientWidth || window.innerWidth;
    var H = this.canvas.clientHeight || window.innerHeight;

    var renderer;
    try {
      if (opts.forceCanvas) throw new Error('Canvas 2D requested');
      renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'default' });
    } catch (err) {
      renderer = makeCanvasRenderer(this);
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.04;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor('#302116');
    this.renderer = renderer;

    var scene = new THREE.Scene();
    this.scene = scene;
    if (!this.compatibilityMode) scene.environment = makeEnvironment(renderer);

    var camera = new THREE.PerspectiveCamera(44, W / H, 0.5, 80);
    var camDist = 15.5, camTilt = 22 * Math.PI / 180;
    camera.position.set(0, camDist * Math.cos(camTilt), camDist * Math.sin(camTilt));
    camera.lookAt(0, 0, 0);
    this.camera = camera;
    this._camBase = camera.position.clone();
    this._shake = 0;

    // światła
    var hemi = new THREE.HemisphereLight('#fff1d9', '#36281c', 0.62);
    scene.add(hemi);
    var key = new THREE.DirectionalLight('#fff0d9', 2.15);
    key.position.set(-6, 12, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = 7;
    key.shadow.bias = -0.0002;
    key.shadow.normalBias = 0.014;
    key.shadow.camera.far = 40;
    scene.add(key);
    this._key = key;
    var fill = new THREE.DirectionalLight('#b7c9dc', 0.35);
    fill.position.set(7, 6, -5);
    scene.add(fill);

    // fizyka
    var world = new CANNON.World({ gravity: new CANNON.Vec3(0, -34, 0) });
    world.allowSleep = true;
    // Dokładniejszy kontakt z podłożem wygasza mikrodrgania małych kostek
    // na telefonie, aby spełniły niezmienione kryteria fizycznego spoczynku.
    world.solver.iterations = 20;
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

    // Olejowany drewniany blat i drewniana rama o miękkiej, fizycznej krawędzi.
    var tableTex = makeWoodTexture(); tableTex.repeat.set(6, 6);
    var table = new THREE.Mesh(new THREE.PlaneGeometry(90, 90),
      new THREE.MeshStandardMaterial({ map: tableTex, bumpMap: tableTex, bumpScale: 0.012, roughness: 0.76, metalness: 0, envMapIntensity: 0.25 }));
    table.rotation.x = -Math.PI / 2; table.receiveShadow = true;
    scene.add(table); this.table = table;

    var felt = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({ roughness: 0.98, metalness: 0, envMapIntensity: 0.14 }));
    felt.rotation.x = -Math.PI / 2; felt.receiveShadow = true;
    scene.add(felt); this.felt = felt;

    var rimTex = makeWoodTexture();
    this._rimMat = new THREE.MeshPhysicalMaterial({ map: rimTex, bumpMap: rimTex, bumpScale: 0.009, roughness: 0.48, clearcoat: 0.16, clearcoatRoughness: 0.5, metalness: 0, envMapIntensity: 0.42 });
    this._lipMat = new THREE.MeshStandardMaterial({ map: rimTex, roughness: 0.5, metalness: 0, envMapIntensity: 0.38, color: '#c8a77e' });
    this._rimMesh = new THREE.Mesh(new THREE.BufferGeometry(), this._rimMat);
    this._lipMesh = new THREE.Mesh(new THREE.BufferGeometry(), this._lipMat);
    this._rimMesh.rotation.x = this._lipMesh.rotation.x = -Math.PI / 2;
    this._rimMesh.castShadow = true; this._rimMesh.receiveShadow = true; this._lipMesh.receiveShadow = true;
    scene.add(this._rimMesh); scene.add(this._lipMesh);
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
    this._baseGeo = geo;
    var makeHull = function (u) {
      return new CANNON.ConvexPolyhedron({
        vertices: dod.verts.map(function (v) { return new CANNON.Vec3(v[0] * u, v[1] * u, v[2] * u); }),
        faces: dod.faces.map(function (f) { return f.slice(); })
      });
    };
    this._makeHull = makeHull;

    this.dice = [];
    var defs = [
      { symbols: opts.symbolsA, style: DIE_STYLES[0] },
      { symbols: opts.symbolsB, style: DIE_STYLES[1] }
    ];
    for (var d = 0; d < 2; d++) {
      var mat = makeDieMaterial(dod, atlasTex, defs[d].symbols, defs[d].style);
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
        hs: null, maxH: 1, shapeGeo: null,
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

    // Renderujemy tylko ruch lub unieważniony widok; spoczynek nie budzi GPU.
    this._clock = new THREE.Clock();
    this._clock.start();
    this._acc = 0;
    this._running = true;
    this._raf = 0;
    this._bgTimer = 0;
    document.addEventListener('visibilitychange', function () {
      self._clock.getDelta();
      self._syncActivity();
      if (document.visibilityState !== 'hidden') self._invalidate();
    });
    this._invalidate();
  }

  var P = DiceScene.prototype;


  P._syncActivity = function () {
    var hidden = document.visibilityState === 'hidden';
    if (hidden && this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
    var needsBackground = hidden && !this.remote && this.state === 'flying';
    if (needsBackground && !this._bgTimer) {
      var self = this;
      this._bgTimer = setInterval(function () { self._tickHidden(); }, 250);
    } else if (!needsBackground && this._bgTimer) {
      clearInterval(this._bgTimer); this._bgTimer = 0;
    }
  };

  P._invalidate = function () {
    this._needsRender = true;
    if (!this._running) return;
    this._syncActivity();
    if (document.visibilityState === 'hidden' || this._raf) return;
    var self = this;
    this._raf = requestAnimationFrame(function () {
      self._raf = 0;
      self._tick();
      if ((!self.remote && self.isBusy()) || self._shake > 0.002) self._invalidate();
    });
  };


  P._drawCompatibility = function (ctx, width, height, ratio) {
    if (!this.camera || !this.dice) return;
    var ins = this.insets, self = this;
    var left = Math.min(width - 30, Math.max(16, ins.left + 16));
    var top = Math.min(height - 30, Math.max(16, ins.top + 16));
    var tw = Math.max(24, width - left - Math.max(16, ins.right + 16));
    var th = Math.max(24, height - top - Math.max(16, ins.bottom + 16));
    var key = [width, height, left, top, tw, th, ratio].join(':');
    var bg = this._canvasBackground;
    if (!bg || bg.key !== key) {
      var cv = document.createElement('canvas');
      cv.width = Math.round(width * ratio); cv.height = Math.round(height * ratio);
      var c = cv.getContext('2d'); c.setTransform(ratio, 0, 0, ratio, 0, 0);
      drawWoodArtwork(c, width, height);
      c.save();
      c.shadowColor = 'rgba(24,12,5,0.45)'; c.shadowBlur = 12; c.shadowOffsetY = 4;
      roundedRect2D(c, left - 12, top - 12, tw + 24, th + 24, 16);
      c.fillStyle = '#4a2c1a'; c.fill(); c.restore();
      c.save(); roundedRect2D(c, left - 10, top - 10, tw + 20, th + 20, 14); c.clip();
      drawWoodArtwork(c, width, height); c.restore();
      roundedRect2D(c, left - 9, top - 9, tw + 18, th + 18, 13);
      c.lineWidth = 1.3; c.strokeStyle = 'rgba(218,174,116,0.5)'; c.stroke();
      c.save(); roundedRect2D(c, left, top, tw, th, 8); c.clip();
      c.translate(left, top); drawFeltArtwork(c, tw, th); c.restore();
      roundedRect2D(c, left, top, tw, th, 8);
      c.strokeStyle = 'rgba(16,23,11,0.62)'; c.lineWidth = 2.5; c.stroke();
      this._canvasBackground = bg = { key: key, canvas: cv };
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, width * ratio, height * ratio);
    ctx.drawImage(bg.canvas, 0, 0); ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.camera.updateMatrixWorld(true);
    function project(v) {
      var p = v.clone().project(self.camera);
      return { x: (p.x + 1) * width / 2, y: (1 - p.y) * height / 2 };
    }
    function polygon(points, center, scale) {
      ctx.beginPath();
      points.forEach(function (p, i) {
        var x = center.x + (p.x - center.x) * scale, y = center.y + (p.y - center.y) * scale;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.closePath();
    }
    function shade(hex, light) {
      var value = parseInt(hex.slice(1), 16);
      return 'rgb(' + [value >> 16, value >> 8 & 255, value & 255].map(function (v) { return Math.min(255, Math.round(v * light)); }).join(',') + ')';
    }
    function silhouette(points) {
      points.sort(function (a, b) { return a.x - b.x || a.y - b.y; });
      function turn(a, b, c) { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }
      var lower = [], upper = [];
      points.forEach(function (p) {
        while (lower.length > 1 && turn(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
        lower.push(p);
      });
      for (var i = points.length - 1; i >= 0; i--) {
        var p = points[i];
        while (upper.length > 1 && turn(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
        upper.push(p);
      }
      lower.pop(); upper.pop(); return lower.concat(upper);
    }
    var light = new THREE.Vector3(-0.43, 0.85, 0.28).normalize();
    var ordered = this.dice.map(function (d, i) {
      return { d: d, i: i, depth: d.mesh.position.clone().applyMatrix4(self.camera.matrixWorldInverse).z };
    });
    ordered.sort(function (a, b) { return a.depth - b.depth; });
    ordered.forEach(function (entry) {
      var d = entry.d, style = DIE_STYLES[entry.i], pos = d.mesh.position, q = d.mesh.quaternion;
      var data = d.mesh.geometry.userData.sfRounded, U = d.mesh.scale.x;
      if (!data) return;
      function world(v) { return new THREE.Vector3().fromArray(v).multiplyScalar(U).applyQuaternion(q).add(pos); }
      var center = project(pos), right = project(pos.clone().add(new THREE.Vector3(U, 0, 0)));
      var size = Math.abs(right.x - center.x);
      var ground = project(new THREE.Vector3(pos.x, 0, pos.z));
      var lift = Math.max(0, pos.y / U - 1);
      ctx.save(); ctx.shadowColor = 'rgba(11,19,8,0.25)'; ctx.shadowBlur = 4 + lift * 3;
      ctx.fillStyle = 'rgba(11,19,8,' + Math.max(0.07, 0.28 - lift * 0.02) + ')';
      ctx.beginPath(); ctx.ellipse(ground.x + size * (0.35 + lift * 0.13), ground.y + size * 0.1, size * (1.2 + lift * 0.03), size * 0.73, -0.18, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      var outline = silhouette(data.outline.map(function (v) { return project(world(v)); }));
      ctx.save(); polygon(outline, center, 1); ctx.clip();
      var resin = ctx.createLinearGradient(center.x - size, center.y - size, center.x + size * 0.85, center.y + size * 1.15);
      resin.addColorStop(0, shade(style.body, 1.07)); resin.addColorStop(0.45, style.body); resin.addColorStop(1, shade(style.body, 0.72));
      ctx.fillStyle = resin; ctx.fillRect(center.x - size * 2, center.y - size * 2, size * 4, size * 4);
      var faces = [];
      self.dod.faces.forEach(function (face, fi) {
        var localN = self.dod.normals[fi], normal = new THREE.Vector3().fromArray(localN).applyQuaternion(q);
        var localCenter = [localN[0] * data.heights[fi], localN[1] * data.heights[fi], localN[2] * data.heights[fi]];
        var fc = world(localCenter), view = self.camera.position.clone().sub(fc);
        if (normal.dot(view) <= 0) return;
        var outer = face.map(function (vi) { return project(world(data.hull[vi])); });
        faces.push({ fi: fi, center: project(fc), world: fc, normal: normal, outer: outer,
          shade: 0.76 + 0.24 * Math.max(0, normal.dot(light)), depth: fc.clone().applyMatrix4(self.camera.matrixWorldInverse).z });
      });
      faces.sort(function (a, b) { return a.depth - b.depth; });
      faces.forEach(function (face) {
        ctx.save();
        var softness = ctx.createRadialGradient(face.center.x, face.center.y, size * 0.06, face.center.x, face.center.y, size * 0.95);
        softness.addColorStop(0, 'rgba(69,49,24,' + ((1 - face.shade) * 0.38) + ')'); softness.addColorStop(1, 'rgba(69,49,24,0)');
        ctx.fillStyle = softness; ctx.fillRect(face.center.x - size, face.center.y - size, size * 2, size * 2);
        // Rzut stycznych tej samej płaszczyzny co w shaderze. Znaki obracają się
        // razem z bryłą, również w transmisji; żadnego zgadywania ścianki w górze.
        polygon(face.outer, face.center, 0.86); ctx.clip();
        var tangent = new THREE.Vector3().fromArray(self.dod.tangents[face.fi]).applyQuaternion(q);
        var bitangent = new THREE.Vector3().crossVectors(face.normal, tangent);
        var half = self.dod.faceR * 0.6 * U;
        var px = project(face.world.clone().addScaledVector(tangent, half));
        var py = project(face.world.clone().addScaledVector(bitangent, half));
        var ax = px.x - face.center.x, ay = px.y - face.center.y;
        var bx = face.center.x - py.x, by = face.center.y - py.y;
        if (Math.abs(ax * by - ay * bx) > 0.6) {
          ctx.transform(ax, ay, bx, by, face.center.x, face.center.y);
          ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.97;
          var atlas = self.opts.atlasCanvas, symbol = d.symbols[face.fi];
          if (atlas) {
            var cell = SYMBOLS.cellOf(symbol), cw = atlas.width / 4, ch = atlas.height / 2;
            ctx.drawImage(atlas, cell.col * cw, cell.row * ch, cw, ch, -1, -1, 2, 2);
          } else SYMBOLS.drawAnimal(ctx, symbol, -0.72, -0.72, 1.44);
        }
        ctx.restore();
      });
      d.plugs.forEach(function (plug, pi) {
        if (!plug.visible) return;
        var fi = pi ? d.antiFace : d.predFace;
        if (!faces.some(function (f) { return f.fi === fi; })) return;
        var point = project(plug.position.clone().multiplyScalar(U).applyQuaternion(q).add(pos));
        ctx.beginPath(); ctx.arc(point.x, point.y, Math.max(1.4, size * 0.048), 0, Math.PI * 2);
        ctx.fillStyle = '#a47b31'; ctx.fill(); ctx.strokeStyle = '#f4df96'; ctx.lineWidth = 0.7; ctx.stroke();
      });
      ctx.restore();
    });
  };

  P._previewBias2D = function (cvA, cvB, tuning) {
    var values = tuning && tuning.length === 2 ? tuning : (tuning && tuning.v) || [0, 0];
    var mode = tuning && tuning.m === 's' ? 's' : 'w';
    var ratio = Math.min(2, window.devicePixelRatio || 1);
    for (var i = 0; i < 2; i++) {
      var surface = context2DFor(i ? cvB : cvA), cv = surface.canvas, c = surface.ctx;
      cv.width = cv.height = Math.round(96 * ratio);
      c.setTransform(ratio, 0, 0, ratio, 0, 0);
      c.clearRect(0, 0, 96, 96);
      var value = Math.max(-1, Math.min(1, +values[i] || 0));
      var stretch = mode === 's' ? 1 + value * 0.13 : 1;
      c.save(); c.translate(48, 45); c.scale(stretch, 1);
      roundedRect2D(c, -34, -32, 68, 68, 18);
      c.fillStyle = DIE_STYLES[i].body; c.fill();
      c.strokeStyle = DIE_STYLES[i].edge; c.lineWidth = 1.5; c.stroke();
      c.restore();
      SYMBOLS.drawAnimal(c, this.dice[i].symbols[this.dice[i].predFace], 32, 16, 32);
      c.beginPath(); c.moveTo(25, 62); c.lineTo(71, 62); c.strokeStyle = 'rgba(85,71,40,0.24)'; c.lineWidth = 1; c.stroke();
      if (mode === 'w') {
        c.beginPath(); c.arc(48 + value * 22, 62, 6, 0, Math.PI * 2);
        c.fillStyle = '#b08939'; c.fill(); c.strokeStyle = '#f4df96'; c.stroke();
      } else {
        c.strokeStyle = '#b08939'; c.lineWidth = 3;
        c.beginPath(); c.moveTo(18 - value * 4, 28); c.lineTo(18 - value * 4, 65); c.stroke();
      }
    }
  };

  /* ---------- prostokąt tacy z frustum kamery ---------- */
  P._computeRect = function () {
    var W = this.canvas.clientWidth || window.innerWidth;
    var H = this.canvas.clientHeight || window.innerHeight;
    var cam = this.camera;
    cam.aspect = W / H;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    var ins = this.insets;
    var pt = function (px, py, planeY) {
      var ndc = new THREE.Vector2((px / W) * 2 - 1, -(py / H) * 2 + 1);
      var ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, cam);
      var t = (planeY - ray.ray.origin.y) / ray.ray.direction.y;
      return ray.ray.origin.clone().addScaledVector(ray.ray.direction, t);
    };
    var pad = 6;
    var atHeight = function (height) {
      var tl = pt(ins.left + pad, ins.top + pad, height);
      var tr = pt(W - ins.right - pad, ins.top + pad, height);
      var bl = pt(ins.left + pad, H - ins.bottom - pad, height);
      var br = pt(W - ins.right - pad, H - ins.bottom - pad, height);
      return { x0: Math.max(tl.x, bl.x), x1: Math.min(tr.x, br.x), z0: Math.max(tl.z, tr.z), z1: Math.min(bl.z, br.z) };
    };
    var rectOf = function (b) {
      var x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1);
      var z0 = Math.min(b.z0, b.z1), z1 = Math.max(b.z0, b.z1);
      return { x0: x0, x1: x1, z0: z0, z1: z1, w: x1 - x0, h: z1 - z0, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 };
    };
    this.rect = rectOf(atHeight(0));
    // Mieści się CAŁA rama, nie tylko filc: perspektywa powiększa jej górę,
    // a dolna faza wyznacza bliski brzeg. Rozmiar kostek zależy od tacy,
    // dlatego dopasowanie stabilizujemy kilkoma krótkimi iteracjami.
    for (var pass = 0; pass < 6; pass++) {
      // _resizeDice zachowuje U przy różnicy <12%; 1/0.88 <1.14 chroni
      // także taki zachowany rozmiar bez zmiany dotychczasowej histerezy.
      var fitU = this._idealU() * 1.14;
      var high = atHeight(fitU * 0.79), low = atHeight(-fitU * 0.06), band = fitU * 0.56;
      this.rect = rectOf({
        x0: Math.max(high.x0, low.x0) + band, x1: Math.min(high.x1, low.x1) - band,
        z0: Math.max(high.z0, low.z0) + band, z1: Math.min(high.z1, low.z1) - band
      });
    }
  };

  P._layoutTray = function () {
    var r = this.rect, U = this.U;
    var wallH = U * 2.6, wallT = U * 0.55;
    var layoutKey = [r.w, r.h, U].join(':');
    if (this._trayGeometryKey !== layoutKey) {
      var corner = Math.min(U * 0.28, r.w * 0.12, r.h * 0.12);
      this.felt.geometry.dispose(); this.felt.geometry = feltGeometry(r.w, r.h, corner);
      if (this.felt.material.map) this.felt.material.map.dispose();
      this.felt.material.map = makeFeltTexture(r.w / r.h);
      this.felt.material.bumpMap = this.felt.material.map;
      this.felt.material.bumpScale = U * 0.012;
      this.felt.material.needsUpdate = true;
      this._rimMesh.geometry.dispose(); this._lipMesh.geometry.dispose();
      this._rimMesh.geometry = trayRing(r.w, r.h, corner, U * 0.5, U * 0.72, U * 0.055);
      this._lipMesh.geometry = trayRing(r.w + U * 0.83, r.h + U * 0.83, corner + U * 0.415, U * 0.035, U * 0.008, 0);
      this._trayGeometryKey = layoutKey;
    }
    this.felt.position.set(r.cx, 0.001, r.cz);
    this._rimMesh.position.set(r.cx, 0, r.cz);
    this._lipMesh.position.set(r.cx, U * 0.778, r.cz);
    this.table.position.y = -U * 0.12;
    // Granice kolizji pozostają dokładnie takie jak w dotychczasowej fizyce.
    var defs = [
      { x: r.cx, z: r.z0 - wallT / 2, sx: r.w + wallT * 2, sz: wallT },
      { x: r.cx, z: r.z1 + wallT / 2, sx: r.w + wallT * 2, sz: wallT },
      { x: r.x0 - wallT / 2, z: r.cz, sx: wallT, sz: r.h + wallT * 2 },
      { x: r.x1 + wallT / 2, z: r.cz, sx: wallT, sz: r.h + wallT * 2 }
    ];
    for (var i = 0; i < 4; i++) {
      var d = defs[i], body = this.wallBodies[i];
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

  /** Mapowanie suwaka szlifu na dystans płaszczyzny ścianki PRZECIWLEGŁEJ:
      s>0 → mniejsza (h→1.6, drapieżnik rzadziej), s<0 → większa/wcięta (h→0.75, częściej). */
  function hFromS(s) { return s > 0 ? 1 + 0.6 * s : 1 + 0.25 * s; }

  /** (Prze)buduje bryłę fizyczną i mesh kostki `i` wg trybu:
      'w' — hull z offsetem środka masy (-e·U·n_drapieżnika);
      's' — bryła zdeformowana (płaszczyzna ścianki przeciwległej na dystansie hFromS). */
  P._rebuildBody = function (i) {
    var d = this.dice[i], U = this.U;
    var e = this.mode === 'w' ? (this.bias[i] || 0) : 0;
    var s = this.mode === 's' ? (this.shape[i] || 0) : 0;
    var n = this.dod.normals[d.predFace];
    d.shapeOff.set(-e * U * n[0], -e * U * n[1], -e * U * n[2]);
    var hull;
    if (s !== 0) {
      var hs = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
      hs[d.antiFace] = hFromS(s);
      d.hs = hs;
      d.maxH = Math.max(1, hs[d.antiFace]);
      var dv = deformVerts(this.dod, hs);
      hull = new CANNON.ConvexPolyhedron({
        vertices: dv.map(function (v) { return new CANNON.Vec3(v[0] * U, v[1] * U, v[2] * U); }),
        faces: this.dod.faces.map(function (f) { return f.slice(); })
      });
      if (d.shapeGeo) d.shapeGeo.dispose();
      d.shapeGeo = buildRoundedGeometry(this.dod, 13, 14, hs);
      d.mesh.geometry = d.shapeGeo;
    } else {
      d.hs = null;
      d.maxH = 1;
      hull = this._makeHull(U);
      if (d.mesh.geometry !== this._baseGeo) d.mesh.geometry = this._baseGeo;
      if (d.shapeGeo) { d.shapeGeo.dispose(); d.shapeGeo = null; }
    }
    while (d.body.shapes.length) d.body.removeShape(d.body.shapes[0]);
    d.body.addShape(hull, new CANNON.Vec3(d.shapeOff.x, d.shapeOff.y, d.shapeOff.z));
    d.body.updateMassProperties();
    d.body.updateBoundingRadius();
    d.body.sleepSpeedLimit = U * 0.28;
    d.plugs[0].visible = e > 0.004;
    d.plugs[1].visible = e < -0.004;
    var ps = 0.7 + 1.9 * Math.min(1, Math.abs(e)); // plomba rośnie z ciężarem
    d.plugs[0].scale.setScalar(ps);
    d.plugs[1].scale.setScalar(ps);
  };

  /** Strojenie kostek: {m:'w'|'s', v:[a,b]} w -1..1 (legacy: sama tablica = ciężarek).
      Stosować między rzutami. */
  P.setTuning = function (t) {
    var m = 'w', v = [0, 0];
    if (t && t.length === 2) { v = t; }
    else if (t && (t.m === 'w' || t.m === 's') && t.v && t.v.length === 2) { m = t.m; v = t.v; }
    var cl = function (x) { return Math.max(-1, Math.min(1, +x || 0)); };
    this.mode = m;
    this.bias = m === 'w' ? [cl(v[0]), cl(v[1])] : [0, 0];
    this.shape = m === 's' ? [cl(v[0]), cl(v[1])] : [0, 0];
    for (var i = 0; i < 2; i++) {
      this._unlockDie(i);
      this._rebuildBody(i);
    }
    if (this.state === 'idle') this._restDice(false);
    this._syncMeshes();
    this._invalidate();
  };
  P.setBias = P.setTuning; // alias zgodności

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
    if (on) { this._hasResult = false; this._flushInsets(); this._layoutPinned = true; }
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
    this._flushInsets();
    this._invalidate();
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
    this._invalidate();
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
    this._hasResult = true;
    this._lastNet = null;
    for (var j = 0; j < 2; j++) this._lockDie(j);
    this._syncMeshes();
    this._flushInsets();
    this._invalidate();
  };

  /* ---------- podgląd 3D kostek w panelu zaawansowanym ----------
     Kostka PÓŁPRZEZROCZYSTA, a w środku mosiężna kula-ciężarek na PRAWDZIWEJ
     pozycji wzdłuż osi drapieżnik↔przeciwległa: 0 = środek bryły, ±100% = kula
     dotyka ścianki od wewnątrz. Oś leży poziomo, zgodnie z kierunkiem suwaka. */
  P.previewBias = function (cvA, cvB, biasArr) {
    if (this.compatibilityMode) { this._previewBias2D(cvA, cvB, biasArr); return; }
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
        var shellMat = makeDieMaterial(this.dod, this._atlasTex, die.symbols, die.mesh.material.userData.sfStyle);
        shellMat.transparent = true;
        shellMat.opacity = 0.4;
        shellMat.depthWrite = false;
        var shell = new THREE.Mesh(this._baseGeo, shellMat);
        shell.renderOrder = 2; // skorupa MALOWANA PO kuli → kula widoczna „w środku”
        if (!this._brassMat) this._makePlug(die.predFace); // inicjalizacja materiału
        var ball = new THREE.Mesh(new THREE.SphereGeometry(0.155, 20, 14), this._brassMat);
        ball.renderOrder = 1;
        shell.add(ball);
        var n = this.dod.normals[die.predFace];
        sc.add(shell);
        var pv0 = {
          r: r, sc: sc, cam: cam, ball: ball, shell: shell, n: n,
          tq: new THREE.Quaternion(), tp: new THREE.Vector3(), ts: 0,
          sVal: 0, sGeo: null
        };
        pv0.tq.setFromUnitVectors(
          new THREE.Vector3(n[0], n[1], n[2]),
          new THREE.Vector3(0.66, 0.2, 0.72).normalize()
        );
        shell.quaternion.copy(pv0.tq);
        ball.scale.setScalar(0.0001);
        ball.visible = false;
        this._prev.push(pv0);
      }
    }
    var m = 'w', vv = [0, 0];
    if (biasArr && biasArr.length === 2) vv = biasArr;
    else if (biasArr && biasArr.v) { m = biasArr.m === 's' ? 's' : 'w'; vv = biasArr.v; }
    for (var j = 0; j < 2; j++) {
      var e = +vv[j] || 0;
      var pv = this._prev[j];
      if (m === 's') {
        // SZLIF: kula znika, skorupa realnie zdeformowana, szlifowana ścianka frontem z lewej
        pv.ts = 0;
        if (pv.sVal !== e) {
          pv.sVal = e;
          if (pv.sGeo) { pv.sGeo.dispose(); pv.sGeo = null; }
          if (e !== 0) {
            var hs = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
            hs[this.dice[j].antiFace] = hFromS(e);
            pv.sGeo = buildRoundedGeometry(this.dod, 13, 10, hs);
            pv.shell.geometry = pv.sGeo;
          } else {
            pv.shell.geometry = this._baseGeo;
          }
        }
        pv.tq.setFromUnitVectors(
          new THREE.Vector3(-pv.n[0], -pv.n[1], -pv.n[2]),
          new THREE.Vector3(-0.6, 0.2, 0.78).normalize()
        );
      } else {
        // CIĘŻAREK: bryła foremna + kula na prawdziwej pozycji
        if (pv.sVal !== 0) {
          pv.sVal = 0;
          if (pv.sGeo) { pv.sGeo.dispose(); pv.sGeo = null; }
          pv.shell.geometry = this._baseGeo;
        }
        var t = e * (1 - 0.155); // przy ±100% kula styka się ze ścianką od wewnątrz
        pv.tp.set(pv.n[0] * t, pv.n[1] * t, pv.n[2] * t);
        pv.ts = Math.abs(e) > 0.01 ? 1 : 0;
        var neg = e < -0.01;
        var from = neg
          ? new THREE.Vector3(-pv.n[0], -pv.n[1], -pv.n[2])
          : new THREE.Vector3(pv.n[0], pv.n[1], pv.n[2]);
        var to = new THREE.Vector3(neg ? -0.66 : 0.66, 0.2, 0.72).normalize();
        pv.tq.setFromUnitVectors(from, to);
      }
    }
    if (!this._prevRaf) this._prevTick();
  };

  /** Płynne dojście podglądu do celu (slerp obrotu, lerp kuli); rAF tylko w ruchu. */
  P._prevTick = function () {
    var busy = false;
    for (var j = 0; j < 2; j++) {
      var pv = this._prev[j];
      pv.shell.quaternion.slerp(pv.tq, 0.16);
      if (pv.shell.quaternion.angleTo(pv.tq) > 0.004) busy = true;
      else pv.shell.quaternion.copy(pv.tq);
      pv.ball.position.lerp(pv.tp, 0.2);
      if (pv.ball.position.distanceTo(pv.tp) > 0.004) busy = true;
      else pv.ball.position.copy(pv.tp);
      var s = pv.ball.scale.x + (pv.ts - pv.ball.scale.x) * 0.22;
      if (Math.abs(s - pv.ts) > 0.01) busy = true;
      else s = pv.ts;
      pv.ball.scale.setScalar(Math.max(0.0001, s));
      pv.ball.visible = s > 0.02;
      pv.r.render(pv.sc, pv.cam);
    }
    if (busy) {
      var self = this;
      this._prevRaf = requestAnimationFrame(function () { self._prevTick(); });
    } else {
      this._prevRaf = 0;
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
    var next = {};
    ['top', 'right', 'bottom', 'left'].forEach(function (side) {
      var value = +(ins && ins[side]); next[side] = Number.isFinite(value) ? Math.max(0, value) : 0;
    });
    this._measuredInsets = next;
    // Rezerwujemy największy HUD z bieżącego rozmiaru okna. Zwijanie docka
    // nie powiększa tacy przy każdej fazie; zatwierdzone kostki pozostają w miejscu.
    if (this._layoutPinned) {
      next = Object.assign({}, next);
      ['top', 'right', 'bottom', 'left'].forEach(function (side) {
        next[side] = Math.max(next[side], this.insets[side], this._pendingInsets ? this._pendingInsets[side] : 0);
      }, this);
    }
    // Większy HUD czeka do początku NOWEGO rzutu. W locie ani po odczycie
    // wyniku nie przesuwamy ścian, hullów, ani transformów z drugiego telefonu.
    if (this.isBusy() || this.remote || this._hasResult) { this._pendingInsets = next; return; }
    this._pendingInsets = null;
    if (['top', 'right', 'bottom', 'left'].every(function (side) { return next[side] === this.insets[side]; }, this)) return;
    this.insets = next;
    this._computeRect();
    this._resizeDice();
    this._layoutTray();
    this._clampDice();
    this._syncMeshes();
    this._invalidate();
  };

  P._flushInsets = function () {
    if (this._pendingInsets && !this.isBusy() && !this.remote && !this._hasResult) {
      var measured = this._measuredInsets;
      this.setInsets(this._pendingInsets);
      this._measuredInsets = measured;
    }
  };

  P.resize = function () {
    if (this._measuredInsets) this.insets = Object.assign({}, this._measuredInsets);
    this._pendingInsets = null;
    var W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    this.renderer.setSize(W, H, false);
    this._computeRect();
    this._resizeDice();
    this._layoutTray();
    this._clampDice();
    this._syncMeshes();
    this._invalidate();
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
      var die = this.dice[i], keepLocked = die.locked;
      this._unlockDie(i);
      var b = die.body, f = 0;
      if (initial) {
        f = Math.floor(Math.random() * 12);
        var n = this.dod.normals[f];
        var q = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(n[0], n[1], n[2]), new THREE.Vector3(0, -1, 0));
        var yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);
        yaw.multiply(q);
        b.quaternion.set(yaw.x, yaw.y, yaw.z, yaw.w);
      } else {
        // Obrót ekranu i zmiana układu nie losują nowej ścianki zakończonego rzutu.
        var lowest = 2;
        for (var fi = 0; fi < 12; fi++) {
          var ny = this._tmpV.fromArray(this.dod.normals[fi]).applyQuaternion(b.quaternion).y;
          if (ny < lowest) { lowest = ny; f = fi; }
        }
      }
      var so = die.shapeOff;
      var oy = this._tmpV.set(so.x, so.y, so.z).applyQuaternion(b.quaternion).y;
      var hf = die.hs ? die.hs[f] : 1;
      b.position.set(r.cx + (i === 0 ? -1.35 : 1.35) * U, U * hf - oy + 0.01, r.cz + r.h * 0.18 + (i === 0 ? 0.2 : -0.2) * U);
      b.velocity.setZero(); b.angularVelocity.setZero();
      b.aabbNeedsUpdate = true;
      b.sleep();
      if (keepLocked) this._lockDie(i);
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
        .applyQuaternion(b.quaternion).y;
      if (gy > this.U * (d.maxH + 0.35)) continue;
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
      // A readable/zoomed layout can place the same 3D canvas below the herd
      // panels. Convert viewport pointer coordinates to the canvas itself.
      var bounds = cv.getBoundingClientRect();
      px = (px - bounds.left) * W / (bounds.width || W);
      py = (py - bounds.top) * H / (bounds.height || H);
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
      if (self.state === 'idle') {
        self._hasResult = false; self._flushInsets(); self._layoutPinned = true;
        self._unlockDie(0); self._unlockDie(1);
        if (self._clock) self._clock.getDelta();
        self._hasResult = false;
      }
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
      self._invalidate();
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
    if (!this.isBusy() && !this.remote) { this._hasResult = false; this._flushInsets(); }
    this._layoutPinned = true;
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
    this._layoutPinned = true;
    this.state = 'flying';
    this._settleTimer = 0;
    this._flightTime = 0;
    this._cockedTries = 0;
    this._cockedTimer = 0;
    this._hasResult = false;
    if (this._clock) this._clock.getDelta();
    this._invalidate();
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
    var active = !this.remote && this.isBusy();
    this._acc = active ? this._acc + dt : 0;
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
      if (!active || this.remote || this.dice[w].locked) continue;
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
    this._needsRender = false;
    this._syncActivity();
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
    if (this.state !== 'flying' || this.remote) { this._syncActivity(); return; }
    var dt = Math.min(2.5, this._clock.getDelta());
    this._acc += dt;
    var step = 1 / 120, guard = 0;
    while (this._acc >= step && guard < 300) {
      this._physStep(step);
      this._acc -= step;
      guard++;
    }
    if (guard >= 300) this._acc = 0;
    this._lockSettledDice();
    this._syncMeshes();
    this._checkSettle(dt);
    this._syncActivity();
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

  /** Wyłącznie fizyczny spoczynek na ścianie, nigdy upływ czasu, uprawnia do wyniku. */
  P._isDieStable = function (die) {
    var b = die.body;
    if (!isFinite(b.position.x + b.position.y + b.position.z + b.quaternion.x + b.quaternion.y + b.quaternion.z + b.quaternion.w)) return false;
    if (b.velocity.length() > this.U * 0.02 || b.angularVelocity.length() > 0.02) return false;
    if (!die.locked && b.sleepState !== CANNON.Body.SLEEPING) return false;
    var f = this._faceUp(die);
    if (f.face < 0 || f.dot < 0.99999) return false;
    var gy = b.position.y + this._tmpV.set(die.shapeOff.x, die.shapeOff.y, die.shapeOff.z).applyQuaternion(b.quaternion).y;
    return gy > -this.U * 0.05 && gy <= this.U * (die.maxH + 0.35);
  };

  /** Fizyczny przerzut zakleszczonej kostki. Zostawiamy jej obrót, nie wybieramy symbolu. */
  P._rescueDie = function (index) {
    var die = this.dice[index], b = die.body, other = this.dice[1 - index].body;
    var U = this.U, r = this.rect, margin = U * 1.5;
    var candidates = [
      [r.cx - r.w * 0.26, r.cz - r.h * 0.24], [r.cx + r.w * 0.26, r.cz + r.h * 0.24],
      [r.cx - r.w * 0.26, r.cz + r.h * 0.24], [r.cx + r.w * 0.26, r.cz - r.h * 0.24]
    ];
    var chosen = candidates[0], best = -Infinity;
    for (var n = 0; n < candidates.length; n++) {
      var c = candidates[(n + this._cockedTries) % candidates.length];
      var x = Math.max(r.x0 + margin, Math.min(r.x1 - margin, c[0]));
      var z = Math.max(r.z0 + margin, Math.min(r.z1 - margin, c[1]));
      var distance = Math.hypot(x - other.position.x, z - other.position.z);
      var score = isFinite(distance) ? distance : 1;
      if (score > best) { best = score; chosen = [x, z]; }
    }
    this._unlockDie(index);
    die.thrown = true;
    if (!isFinite(b.quaternion.x + b.quaternion.y + b.quaternion.z + b.quaternion.w)) b.quaternion.set(0, 0, 0, 1);
    b.quaternion.normalize();
    b.position.set(chosen[0], U * (die.maxH + 2.2), chosen[1]);
    var angle = Math.random() * Math.PI * 2;
    b.velocity.set(Math.cos(angle) * U * 1.5, U * 2.6, Math.sin(angle) * U * 1.5);
    b.angularVelocity.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 12);
    b.force.setZero(); b.torque.setZero();
    b.aabbNeedsUpdate = true;
    b.wakeUp();
  };

  P._checkSettle = function (dt) {
    if (this.state !== 'flying' || this.remote) return;
    this._flightTime += dt;
    var stable = this.dice.map(this._isDieStable.bind(this));
    if (stable[0] && stable[1]) {
      this._settleTimer += dt;
      if (this._settleTimer < 0.12) return;
      // Wynik i finalny kadr są jedną migawką. Statyczne ciała zostają zamrożone
      // aż do NOWEGO rzutu, więc druga kostka ani kolejne klatki nie zmienią wyniku.
      for (var i = 0; i < 2; i++) this._lockDie(i);
      this.state = 'idle';
      this._hasResult = true;
      this._syncMeshes();
      var results = [this._faceUp(this.dice[0]).symbol, this._faceUp(this.dice[1]).symbol];
      this._invalidate();
      this.onSettle(results);
      this._flushInsets();
      return;
    }
    this._settleTimer = 0;
    var badRest = false;
    for (var j = 0; j < 2; j++) {
      if (!stable[j] && this.dice[j].body.sleepState === CANNON.Body.SLEEPING) badRest = true;
    }
    this._cockedTimer = badRest ? (this._cockedTimer || 0) + dt : 0;
    if (this._flightTime <= 6.5 && this._cockedTimer < 0.45) return;
    // Pięć ograniczonych prób ratunkowych. Awaria oznacza ponowny rzut gracza,
    // nigdy zatwierdzenie przypadkowej ścianki w locie ani nieskończone oczekiwanie.
    if (this._cockedTries >= 5) {
      for (var k = 0; k < 2; k++) { this.dice[k].body.sleep(); this._lockDie(k); }
      this.state = 'idle';
      this._hasResult = false;
      this._syncMeshes();
      this._invalidate();
      this.onRollError('Kostka utknęła. Rzuć ponownie — ten rzut nie został policzony.');
      this._flushInsets();
      return;
    }
    this._cockedTries++;
    this._flightTime = 0;
    this._cockedTimer = 0;
    for (var m = 0; m < 2; m++) if (!stable[m]) this._rescueDie(m);
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
    this._invalidate();
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
