/* ============================================================
   AETHER — 沉浸式三维世界
   ------------------------------------------------------------
   结构：
     1) 环境与工具函数
     2) 着色器（自定义 Aether 材质 + 粒子）
     3) 世界构建（七个章节场景 + 星尘 + 地面网格）
     4) 摄像机路径与滚动驱动
     5) 章节文字调度
     6) 交互（开场、点击脉冲、导航、表单）
     7) 渲染循环与性能守护
   ============================================================ */

import * as THREE from 'three';
import { EffectComposer }   from './vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass }       from './vendor/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass }  from './vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass }       from './vendor/jsm/postprocessing/OutputPass.js';
import { ANCHORS, AT as POSITIONS, CHAPTER_LABELS, WINDOWS, chapterProgress, chapterFade, activeChapter } from './world-layout.js';
import { createProductShowcase, animateProducts } from './world-products.js';
import { bindLeadForm } from './lead-form.js';

/* ---------- 1. 环境 ---------- */

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const MOBILE  = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 820;

const FOG_COLOR  = new THREE.Color(0x080c18);
const FOG_DENSITY = 0.0100;

/* 布局在 world-layout.js 统一维护；七个锚点的 p = i / 6。
   必须继续用 getPoint(p)，不能按弧长重参数化。 */
const AT = Object.fromEntries(Object.entries(POSITIONS).map(([key, xyz]) => [key, new THREE.Vector3(...xyz)]));

/* ---------- 工具 ---------- */

const clamp = (v,a,b) => Math.min(b, Math.max(a, v));
const smoothstep = (a,b,x) => { const t = clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); };
const easeOutExpo = x => (x >= 1 ? 1 : 1 - Math.pow(2, -10*x));

function fail(msg){
  const box = document.getElementById('errbox');
  box.hidden = false;
  box.textContent = '⚠ ' + msg;
  document.body.classList.add('loaded');
  const l = document.getElementById('loader');
  if (l) l.style.display = 'none';
}

window.addEventListener('error', e => {
  const msg = e.message || String(e.error || '');
  if (msg.indexOf('WebGL 不可用') > -1) return;   // 已由 fail() 提示过，不重复弹
  fail('运行错误：' + msg);
});
window.addEventListener('unhandledrejection', e => fail('资源加载失败：' + (e.reason && e.reason.message ? e.reason.message : e.reason)));

/* ---------- 2. 着色器 ---------- */

/* 3D 单纯形噪声（Ashima / Stefan Gustavson 实现，标准算法） */
const NOISE_GLSL = /* glsl */`
vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute( permute( permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

const AETHER_VERT = /* glsl */`
uniform float uTime;
uniform float uAmp;
uniform float uFreq;
uniform float uPulse;
varying vec3  vNormalW;
varying vec3  vViewW;
varying float vDisp;
varying float vFogDepth;

${NOISE_GLSL}

void main(){
  vec3 base = position;
  vec3 dir  = length(base) < 0.0001 ? normal : normalize(base);

  float n1 = snoise(dir * uFreq + vec3(0.0, 0.0, uTime * 0.28));
  float n2 = snoise(dir * (uFreq * 2.35) - vec3(uTime * 0.19, 0.0, 0.0));
  float disp = n1 * uAmp + n2 * uAmp * 0.42 + uPulse * 0.55;

  vec3 p = base + normal * disp;
  vDisp = disp;

  vec4 worldPos = modelMatrix * vec4(p, 1.0);
  vec4 mvPos    = viewMatrix * worldPos;

  vNormalW  = normalize(mat3(modelMatrix) * normal);
  vViewW    = normalize(cameraPosition - worldPos.xyz);
  vFogDepth = -mvPos.z;

  gl_Position = projectionMatrix * mvPos;
}
`;

const AETHER_FRAG = /* glsl */`
uniform vec3  uColorA;
uniform vec3  uColorB;
uniform vec3  uRimColor;
uniform vec3  uLightDir;
uniform vec3  uFogColor;
uniform float uFogDensity;
uniform float uRimPower;
uniform float uGlow;
uniform float uShade;
uniform float uOpacity;
varying vec3  vNormalW;
varying vec3  vViewW;
varying float vDisp;
varying float vFogDepth;

void main(){
  vec3  N = normalize(vNormalW);
  vec3  V = normalize(vViewW);
  /* 必须用 abs()：加色外壳是 BackSide 渲染，背面法线朝外，dot(N,V) 恒为负。
     用 clamp(...,0,1) 会把它压成 0，导致 fres 永远是 1 —— 整层壳满亮度发白。 */
  float fres = pow(1.0 - abs(dot(N, V)), uRimPower);

  float lam = clamp(dot(N, normalize(uLightDir)) * 0.5 + 0.5, 0.0, 1.0);
  vec3  base = mix(uColorA, uColorB, clamp(vDisp * 1.6 + 0.5, 0.0, 1.0));

  vec3 col = base * (uShade * 0.25 + lam * uShade) + uRimColor * fres * uGlow;

  float fogF = clamp(1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth), 0.0, 1.0);

  #ifdef ADDITIVE
    col *= (1.0 - fogF);
    gl_FragColor = vec4(col * uOpacity, 1.0);
  #else
    col = mix(col, uFogColor, fogF);
    gl_FragColor = vec4(col, uOpacity);
  #endif
}
`;

const POINTS_VERT = /* glsl */`
uniform float uTime;
uniform float uSize;
uniform float uPixel;
uniform float uSpread;
uniform float uFogDensity;
attribute float aScale;
attribute float aPhase;
varying float vAlpha;
void main(){
  vec3 p = position;
  p.y += sin(uTime * 0.30 + aPhase) * uSpread;
  p.x += cos(uTime * 0.21 + aPhase * 1.7) * uSpread * 0.8;
  p.z += sin(uTime * 0.17 + aPhase * 0.9) * uSpread * 0.5;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float depth = -mv.z;
  gl_PointSize = uSize * aScale * uPixel * (1.0 / max(depth, 0.001));

  float nearF = smoothstep(0.0, 12.0, depth);
  float farF  = 1.0 - clamp(1.0 - exp(-uFogDensity * uFogDensity * depth * depth), 0.0, 1.0);
  vAlpha = nearF * farF * 0.95;
}
`;

const POINTS_FRAG = /* glsl */`
uniform vec3 uColor;
varying float vAlpha;
void main(){
  float d = length(gl_PointCoord - vec2(0.5));
  float a = smoothstep(0.5, 0.06, d);
  float core = smoothstep(0.22, 0.0, d);
  gl_FragColor = vec4(uColor * (0.7 + core * 1.4), a * a * vAlpha);
}
`;

/* ---------- 材质工厂 ---------- */

const MATERIALS = [];   // 统一更新 uTime / uPulse

function aetherMaterial({
  colorA, colorB, rim,
  amp = 0.05, freq = 1.8, rimPower = 2.4, glow = 1.5, shade = 0.6,
  additive = false, opacity = 1, wireframe = false, side = null, pulseScale = 1
} = {}){
  const m = new THREE.ShaderMaterial({
    defines: additive ? { ADDITIVE: '' } : {},
    uniforms: {
      uTime:       { value: 0 },
      uAmp:        { value: amp },
      uFreq:       { value: freq },
      uPulse:      { value: 0 },
      uColorA:     { value: new THREE.Color(colorA) },
      uColorB:     { value: new THREE.Color(colorB) },
      uRimColor:   { value: new THREE.Color(rim) },
      uLightDir:   { value: new THREE.Vector3(0.55, 0.85, 0.42).normalize() },
      uFogColor:   { value: FOG_COLOR.clone() },
      uFogDensity: { value: FOG_DENSITY },
      uRimPower:   { value: rimPower },
      uGlow:       { value: glow },
      uShade:      { value: shade },
      uOpacity:    { value: opacity }
    },
    vertexShader: AETHER_VERT,
    fragmentShader: AETHER_FRAG,
    transparent: additive,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: !additive,
    side: side || (additive ? THREE.BackSide : THREE.FrontSide),
    wireframe
  });
  MATERIALS.push(m);
  m.userData.pulseScale = pulseScale;
  return m;
}

function makeGlowTexture(){
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
  grd.addColorStop(0.00, 'rgba(255,255,255,1)');
  grd.addColorStop(0.14, 'rgba(210,235,255,0.72)');
  grd.addColorStop(0.42, 'rgba(120,170,255,0.22)');
  grd.addColorStop(1.00, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeBgTexture(){
  const c = document.createElement('canvas');
  c.width = 4; c.height = 512;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0.00, '#12203c');
  grd.addColorStop(0.34, '#0b1326');
  grd.addColorStop(0.68, '#060910');
  grd.addColorStop(1.00, '#030408');
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---------- 3. 场景 ---------- */

const canvas = document.getElementById('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas, antialias: !MOBILE, powerPreference: 'high-performance',
    alpha: false, stencil: false
  });
} catch (e) {
  fail('这台设备的浏览器不支持 WebGL，无法显示三维世界。');
}

/* 没有 WebGL 就不继续执行后面所有构建代码。
   注意：下面不再用 if(...){} 包裹 —— 那样会把世界对象困在块级作用域里，
   模块顶层的渲染循环 tick() 就取不到它们。 */
if (!renderer) throw new Error('WebGL 不可用，已停止三维世界初始化');

let scene, camera, composer, bloomPass, glowTex;

let dpr = Math.min(window.devicePixelRatio || 1, MOBILE ? 1.5 : 1.75);
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.82;

  scene = new THREE.Scene();
  scene.background = makeBgTexture();
  scene.fog = new THREE.FogExp2(FOG_COLOR.getHex(), FOG_DENSITY);

  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 480);
  camera.position.set(ANCHORS[0].cam[0], ANCHORS[0].cam[1], ANCHORS[0].cam[2]);

  glowTex = makeGlowTexture();

  /* ---- 星尘 ---- */
  function buildStars(count, spread, size, color, radiusZ){
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const scl = new Float32Array(count);
    const pha = new Float32Array(count);
    for (let i = 0; i < count; i++){
      pos[i*3+0] = (Math.random() - 0.5) * spread;
      pos[i*3+1] = (Math.random() - 0.5) * spread * 0.62;
      pos[i*3+2] = (Math.random() - 0.5) * radiusZ;
      scl[i] = 0.35 + Math.random() * 1.5;
      pha[i] = Math.random() * Math.PI * 2;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aScale',   new THREE.BufferAttribute(scl, 1));
    geo.setAttribute('aPhase',   new THREE.BufferAttribute(pha, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:       { value: 0 },
        uSize:       { value: size },
        uPixel:      { value: dpr * window.innerHeight / 900 },
        uSpread:     { value: 2.2 },
        uFogDensity: { value: FOG_DENSITY * 0.55 },
        uColor:      { value: new THREE.Color(color) }
      },
      vertexShader: POINTS_VERT,
      fragmentShader: POINTS_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    MATERIALS.push(mat);
    return new THREE.Points(geo, mat);
  }

  const stars = buildStars(MOBILE ? 1500 : 4200, 400, 66, 0xb8d6ff, 320);
  stars.frustumCulled = false;
  scene.add(stars);

  const dust = buildStars(MOBILE ? 420 : 1100, 165, 38, 0xe4f0ff, 130);
  dust.position.set(28, 2, -44);
  dust.frustumCulled = false;
  scene.add(dust);

  /* ---- 地面网格（给"世界"一个地平线参照） ---- */
  const grid = new THREE.GridHelper(520, 86, 0x24406e, 0x122240);
  grid.position.set(28, -22, -34);
  grid.material.transparent = true;
  grid.material.opacity = 0.34;
  grid.material.depthWrite = false;
  scene.add(grid);

  /* ---- 光晕贴片工具 ---- */
  function addGlow(parent, size, color, opacity){
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex,
      color: new THREE.Color(color),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity
    }));
    s.scale.set(size, size, 1);
    parent.add(s);
    return s;
  }

  /* ---- 章节 1：核心 ---- */
  const gCore = new THREE.Group();
  gCore.position.copy(AT.core);
  scene.add(gCore);

  const coreSolid = new THREE.Mesh(
    new THREE.IcosahedronGeometry(3.4, 5),
    aetherMaterial({ colorA: 0x070f22, colorB: 0x1b4a9c, rim: 0x5fb8e8,
                     amp: 0.16, freq: 1.5, rimPower: 2.4, glow: 1.45, shade: 0.62 })
  );
  gCore.add(coreSolid);

  const coreInner = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.55, 3),
    aetherMaterial({ colorA: 0x1f5fb8, colorB: 0x7fc4f0, rim: 0xbfe6ff,
                     amp: 0.10, freq: 2.8, rimPower: 1.5, glow: 1.45, shade: 0.40,
                     additive: true, opacity: 0.52 })
  );
  gCore.add(coreInner);

  const coreHalo = new THREE.Mesh(
    new THREE.IcosahedronGeometry(5.0, 4),
    aetherMaterial({ colorA: 0x0d2a5e, colorB: 0x2f6bd8, rim: 0x4f9dff,
                     amp: 0.05, freq: 1.1, rimPower: 3.6, glow: 1.05, shade: 0.05,
                     additive: true, opacity: 0.24 })
  );
  gCore.add(coreHalo);

  const coreWire = new THREE.Mesh(
    new THREE.IcosahedronGeometry(5.6, 1),
    aetherMaterial({ colorA: 0x1b4a9c, colorB: 0x3f8fd8, rim: 0x4f9dff,
                     amp: 0, freq: 1, rimPower: 2, glow: 0.68, shade: 0.10,
                     additive: true, opacity: 0.22, wireframe: true, side: THREE.DoubleSide })
  );
  gCore.add(coreWire);

  addGlow(gCore, 14, 0x3f8fd8, 0.30);

  /* ---- 章节 2：碎晶 ---- */
  const gShards = new THREE.Group();
  gShards.position.copy(AT.shards);
  scene.add(gShards);

  const shardMat = aetherMaterial({ colorA: 0x101640, colorB: 0x4fa8d8, rim: 0x9fe4ff,
                                    amp: 0.14, freq: 3.0, rimPower: 2.1, glow: 1.50, shade: 0.62 });
  const shardGeos = [
    new THREE.OctahedronGeometry(0.95, 2),
    new THREE.TetrahedronGeometry(1.15, 2),
    new THREE.OctahedronGeometry(0.62, 2)
  ];
  const shards = [];
  for (let i = 0; i < 14; i++){
    const m = new THREE.Mesh(shardGeos[i % 3], shardMat);
    const a = (i / 14) * Math.PI * 2;
    const r = 2.1 + Math.random() * 2.3;
    m.position.set(
      Math.cos(a) * r,
      (Math.random() - 0.5) * 4.4,
      Math.sin(a) * r
    );
    const sc = 0.55 + Math.random() * 0.95;
    m.scale.setScalar(sc);
    m.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
    m.userData.spin = new THREE.Vector3(
      (Math.random()-0.5) * 0.28, (Math.random()-0.5) * 0.42, (Math.random()-0.5) * 0.22
    );
    m.userData.org = m.position.clone();
    shards.push(m);
    gShards.add(m);
  }
  addGlow(gShards, 9, 0x4fa8d8, 0.26);

  /* ---- 章节 3：流动 ---- */
  const gKnot = new THREE.Group();
  gKnot.position.copy(AT.knot);
  scene.add(gKnot);

  const knotMat = aetherMaterial({ colorA: 0x260d45, colorB: 0x8f5fd8, rim: 0xd8a8f5,
                                   amp: 0.30, freq: 2.2, rimPower: 2.2, glow: 1.45, shade: 0.62 });
  const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(2.9, 0.82, 260, 36, 2, 3), knotMat);
  gKnot.add(knot);

  const knotWire = new THREE.Mesh(
    new THREE.TorusKnotGeometry(2.9, 0.82, 150, 16, 2, 3),
    aetherMaterial({ colorA: 0x7a5fd8, colorB: 0xc9a8f5, rim: 0xd8b8ff,
                     amp: 0.06, freq: 1.6, rimPower: 2, glow: 0.72, shade: 0.10,
                     additive: true, opacity: 0.18, wireframe: true, side: THREE.DoubleSide })
  );
  knotWire.scale.setScalar(1.12);
  gKnot.add(knotWire);

  addGlow(gKnot, 10, 0x8f5fd8, 0.28);

  /* ---- 章节 4：轨道 ---- */
  const gOrbit = new THREE.Group();
  gOrbit.position.copy(AT.orbit);
  gOrbit.rotation.z = 0.24;
  scene.add(gOrbit);

  const ringMat = aetherMaterial({ colorA: 0x2e0a2a, colorB: 0xd15f9f, rim: 0xf0a8cc,
                                   amp: 0.05, freq: 2.0, rimPower: 2.8, glow: 1.60, shade: 0.48 });
  const rings = [];
  for (let i = 0; i < 4; i++){
    const r = new THREE.Mesh(new THREE.TorusGeometry(3.5 + i * 0.42, 0.035, 6, 190), ringMat);
    r.rotation.set(
      (Math.random() - 0.5) * 0.9,
      (Math.random() - 0.5) * 0.9,
      i * 0.45
    );
    r.userData.spin = 0.10 + i * 0.045;
    rings.push(r);
    gOrbit.add(r);
  }

  const satMat = aetherMaterial({ colorA: 0x3a1030, colorB: 0xd98fbf, rim: 0xf0c0dd,
                                  amp: 0.10, freq: 3.0, rimPower: 2.0, glow: 1.50, shade: 0.62 });
  const sats = [];
  for (let i = 0; i < 6; i++){
    const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.30, 2), satMat);
    s.userData.phase = (i / 6) * Math.PI * 2;
    s.userData.rad = 3.9 + Math.random() * 1.6;
    sats.push(s);
    gOrbit.add(s);
  }
  addGlow(gOrbit, 10, 0xd15f9f, 0.25);

  /* ---- 章节 5：群集 ---- */
  const gSwarm = new THREE.Group();
  gSwarm.position.copy(AT.swarm);
  scene.add(gSwarm);

  const swarmMat = aetherMaterial({ colorA: 0x171142, colorB: 0x6f5fd8, rim: 0xa89cf0,
                                    amp: 0.0, freq: 1.0, rimPower: 2.4, glow: 1.28, shade: 0.56,
                                    pulseScale: 0 });   // 方块靠 scale 做波，不吃脉冲位移
  const swarmGeo = new THREE.BoxGeometry(0.30, 0.30, 0.30);
  const swarm = [];
  const N = MOBILE ? 8 : 11;
  for (let ix = 0; ix < N; ix++){
    for (let iz = 0; iz < N; iz++){
      const m = new THREE.Mesh(swarmGeo, swarmMat);
      const x = (ix - (N-1)/2) * 1.02;
      const z = (iz - (N-1)/2) * 1.02;
      m.position.set(x, 0, z);
      m.userData.phase = (ix + iz) * 0.42;
      swarm.push(m);
      gSwarm.add(m);
    }
  }
  addGlow(gSwarm, 9, 0x6f5fd8, 0.24);

  /* ---- 章节 6：产品展示，模型均由基础几何体构成 ---- */
  const productBody = aetherMaterial({ colorA: 0x09172a, colorB: 0x294f7a, rim: 0x7ad1ff,
                                       amp: 0, glow: 1.0, shade: 0.6, pulseScale: 0 });
  const productTrim = aetherMaterial({ colorA: 0x171935, colorB: 0x5f6591, rim: 0xa78bfa,
                                       amp: 0, glow: 0.75, shade: 0.55, pulseScale: 0 });
  const productDetail = aetherMaterial({ colorA: 0x16324a, colorB: 0x7ad1ff, rim: 0x9fe4ff,
                                         amp: 0, glow: 0.7, shade: 0.4, pulseScale: 0 });
  const { group: gProducts, items: products } = createProductShowcase({ body: productBody, trim: productTrim, detail: productDetail });
  gProducts.position.copy(AT.products);
  gProducts.position.x += MOBILE ? 0 : 4.2;
  gProducts.scale.setScalar(MOBILE ? 0.48 : 1);
  gProducts.position.y += MOBILE ? 3.2 : 0;
  if (MOBILE) products.forEach((product, i) => { product.position.x = (i - 1) * 1.8; });
  scene.add(gProducts);
  addGlow(gProducts, 10, 0x4fa8d8, 0.16);

  /* ---- 章节 7：门户 ---- */
  const gPortal = new THREE.Group();
  gPortal.position.copy(AT.portal);
  scene.add(gPortal);

  const portalRing = new THREE.Mesh(
    new THREE.TorusGeometry(6, 0.30, 20, 168),
    aetherMaterial({ colorA: 0x073040, colorB: 0x4fa8d8, rim: 0x9fe4ff,
                     amp: 0.06, freq: 2.4, rimPower: 1.9, glow: 1.85, shade: 0.52,
                     additive: true, opacity: 0.85, side: THREE.FrontSide })
  );
  gPortal.add(portalRing);

  const portalRing2 = new THREE.Mesh(
    new THREE.TorusGeometry(6.9, 0.06, 8, 168),
    aetherMaterial({ colorA: 0x4fa8d8, colorB: 0x8f5fd8, rim: 0xd8e8ff,
                     amp: 0.02, freq: 1.5, rimPower: 2, glow: 1.40, shade: 0.20,
                     additive: true, opacity: 0.48, side: THREE.FrontSide })
  );
  gPortal.add(portalRing2);

  const portalDisc = new THREE.Mesh(
    new THREE.CircleGeometry(5.7, 72),
    new THREE.ShaderMaterial({
      uniforms: {
        uColorA: { value: new THREE.Color(0x082a52) },
        uColorB: { value: new THREE.Color(0x4fa8d8) },
        uTime:   { value: 0 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
      `,
      fragmentShader: `
        uniform vec3 uColorA; uniform vec3 uColorB; uniform float uTime;
        varying vec2 vUv;
        void main(){
          float r = length(vUv - vec2(0.5)) * 2.0;
          float edge = smoothstep(0.55, 1.0, r);
          float swirl = 0.5 + 0.5 * sin(r * 22.0 - uTime * 1.6 + atan(vUv.y-0.5, vUv.x-0.5) * 3.0);
          vec3 col = mix(uColorA, uColorB, edge * (0.5 + swirl * 0.6));
          float a = (0.05 + edge * 0.30) * (1.0 - smoothstep(0.95, 1.0, r));
          gl_FragColor = vec4(col * (0.22 + swirl * 0.48), a);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  );
  MATERIALS.push(portalDisc.material);
  gPortal.add(portalDisc);

  addGlow(gPortal, 18, 0x4fa8d8, 0.30);

  /* 门户星环 */
  (function portalDust(){
    const count = MOBILE ? 120 : 260;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const scl = new Float32Array(count);
    const pha = new Float32Array(count);
    for (let i = 0; i < count; i++){
      const a = Math.random() * Math.PI * 2;
      const r = 6.2 + Math.random() * 4.4;
      pos[i*3+0] = Math.cos(a) * r;
      pos[i*3+1] = Math.sin(a) * r;
      pos[i*3+2] = (Math.random() - 0.5) * 3.2;
      scl[i] = 0.4 + Math.random() * 1.1;
      pha[i] = Math.random() * Math.PI * 2;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aScale', new THREE.BufferAttribute(scl, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(pha, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: 40 },
        uPixel: { value: dpr * window.innerHeight / 900 },
        uSpread: { value: 0.5 },
        uFogDensity: { value: FOG_DENSITY * 0.4 },
        uColor: { value: new THREE.Color(0xcfeaff) }
      },
      vertexShader: POINTS_VERT,
      fragmentShader: POINTS_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    MATERIALS.push(mat);
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    gPortal.add(pts);
  })();

  /* ---- 后期处理 ---- */
  try {
    composer = new EffectComposer(renderer);
    composer.setPixelRatio(dpr);
    composer.setSize(window.innerWidth, window.innerHeight);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      MOBILE ? 0.34 : 0.46,   // strength：只让高光溢出，不要糊成一片
      0.58,                    // radius
      0.46                     // threshold：低于这个亮度不参与辉光
    );
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
  } catch (e){
    composer = null;   // 降级为直接渲染，世界照常显示
  }

/* ---------- 4. 摄像机路径与滚动 ---------- */

const camPosCurve = new THREE.CatmullRomCurve3(
  ANCHORS.map(a => new THREE.Vector3(...a.cam)), false, 'centripetal', 0.5
);
const camTgtCurve = new THREE.CatmullRomCurve3(
  ANCHORS.map(a => new THREE.Vector3(...a.tgt)), false, 'centripetal', 0.5
);

let targetP = 0, smoothP = 0;
let mx = 0, my = 0, smx = 0, smy = 0;
let pulse = 0, kick = 0;
let introT = REDUCED ? 1 : 0;
let introStart = 0;

function readScroll(){
  const max = document.documentElement.scrollHeight - window.innerHeight;
  targetP = max > 0 ? clamp(window.scrollY / max, 0, 1) : 0;
}
window.addEventListener('scroll', readScroll, { passive: true });

window.addEventListener('pointermove', e => {
  mx = (e.clientX / window.innerWidth) * 2 - 1;
  my = (e.clientY / window.innerHeight) * 2 - 1;
}, { passive: true });

/* ---------- 5. 章节文字 ---------- */

const chEls = Array.from(document.querySelectorAll('.ch'));

const dotsWrap = document.getElementById('dots');
const dotEls = CHAPTER_LABELS.map((label, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.label = label;
  b.setAttribute('aria-label', '跳转到第 ' + (i+1) + ' 段：' + label);
  b.addEventListener('click', () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: chapterProgress(i) * max, behavior: REDUCED ? 'auto' : 'smooth' });
  });
  dotsWrap.appendChild(b);
  return b;
});

function updateChapters(p){
  const activeIndex = activeChapter(p);
  for (let i = 0; i < chEls.length; i++){
    const el = chEls[i];
    /* 兜底：若 HTML 里加了章节但忘了同步 WINDOWS，按均分推算，避免直接崩掉 */
    const center = chapterProgress(i, chEls.length);
    const win = WINDOWS[i] || [center - 0.125, center + 0.125];
    const [a, b] = win;
    const t = (p - a) / (b - a);

    const { rise, fall } = chapterFade(t);
    let op = (i === 0) ? (1 - smoothstep(0.55, 1.0, t)) : rise * fall;

    el.style.opacity = op.toFixed(3);
    el.style.transform = 'translateY(' + ((1 - rise) * (i === 0 ? 0 : 30)).toFixed(1) + 'px)';

    const act = op > 0.55;
    el.querySelectorAll('.cta-actions').forEach(x => {
      x.style.pointerEvents = act ? 'auto' : 'none';
      x.inert = !act;
    });

    if (dotEls[i]){
      const on = i === activeIndex;
      if (on !== dotEls[i].classList.contains('on')) {
        dotEls[i].classList.toggle('on', on);
        if (on) dotEls[i].setAttribute('aria-current', 'step');
        else dotEls[i].removeAttribute('aria-current');
      }
    }
  }
}

/* ---------- 6. 交互 ---------- */

/* 开场：摄像机从远处飞入 + 视场角收束 */
function startIntro(){
  introStart = performance.now();
  introT = REDUCED ? 1 : 0;
  document.body.classList.add('loaded');
  readScroll();
}

/* 点击 / 触摸触发一次能量脉冲 */
if (renderer){
  canvas.addEventListener('pointerdown', () => {
    pulse = Math.min(1, pulse + 0.85);
    kick = 0.9;
  });
}

document.getElementById('replayBtn').addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: REDUCED ? 'auto' : 'smooth' });
  setTimeout(startIntro, REDUCED ? 0 : 420);
});

document.querySelectorAll('[data-jump]').forEach(btn => {
  btn.addEventListener('click', () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: chapterProgress(Number(btn.dataset.jump)) * max, behavior: REDUCED ? 'auto' : 'smooth' });
  });
});

/* 留资表单：portal 稳定 key；成功/重复必须由后端确认，失败保留邮箱并可重试。 */
bindLeadForm({
  form: document.getElementById('ctaForm'),
  button: document.getElementById('ctaBtn'),
  emailInput: document.getElementById('ctaEmail'),
  note: document.getElementById('ctaNote'),
  trap: document.getElementById('ctaTrap'),
  getProgress: () => smoothP
});

/* 光标光晕 */
(function cursor(){
  const el = document.getElementById('cursor');
  if (!el || MOBILE || REDUCED) { if (el) el.style.display = 'none'; return; }
  let x = window.innerWidth / 2, y = window.innerHeight / 2, tx = x, ty = y;
  window.addEventListener('pointermove', e => { tx = e.clientX; ty = e.clientY; }, { passive: true });
  (function loop(){
    x += (tx - x) * 0.12;
    y += (ty - y) * 0.12;
    el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
    requestAnimationFrame(loop);
  })();
})();

/* ---------- 7. 尺寸与性能 ---------- */

function onResize(){
  if (!renderer) return;
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  if (composer){ composer.setSize(w, h); }
  if (bloomPass && bloomPass.setSize) bloomPass.setSize(w, h);
  MATERIALS.forEach(m => {
    if (m.uniforms && m.uniforms.uPixel) m.uniforms.uPixel.value = renderer.getPixelRatio() * h / 900;
  });
  readScroll();
}
window.addEventListener('resize', onResize);

/* 帧率监测：连续掉帧时自动降档 */
const perf = { acc: 0, n: 0, checked: 0, throttled: false };
function perfGuard(dt){
  if (perf.throttled) return;
  perf.acc += dt; perf.n++;
  if (perf.n >= 90){
    const avg = perf.acc / perf.n;
    if (avg > 27 && renderer){
      renderer.setPixelRatio(1);
      if (composer) composer.setPixelRatio(1);
      perf.throttled = true;
      const fps = document.getElementById('fps');
      if (fps) fps.textContent = '已自动降档 · 优先保证流畅';
    }
    perf.acc = 0; perf.n = 0;
  }
}

/* ---------- 渲染循环 ---------- */

const clock = new THREE.Clock();
const introOffset = new THREE.Vector3(0, 9, 72);
const tmpPos = new THREE.Vector3();
const tmpTgt = new THREE.Vector3();
const tmpOff = new THREE.Vector3();
let fpsAcc = 0, fpsN = 0;

function tick(){
  if (!renderer) return;

  const dt = Math.min(clock.getDelta(), 0.06);
  const now = performance.now();
  const time = clock.elapsedTime;

  /* 开场推进 */
  if (introT < 1){
    const t = REDUCED ? 1 : clamp((now - introStart) / 2200, 0, 1);
    introT = easeOutExpo(t);
  }

  /* 滚动平滑 */
  smoothP += (targetP - smoothP) * (REDUCED ? 1 : 0.085);
  smx += (mx - smx) * 0.055;
  smy += (my - smy) * 0.055;

  const p = smoothP;

  /* 摄像机沿锚点曲线飞行；p = i/6 时正好落在第 i 个锚点 */
  camPosCurve.getPoint(p, tmpPos);
  camTgtCurve.getPoint(p, tmpTgt);

  /* 开场位移衰减 */
  const k = 1 - introT;
  tmpPos.addScaledVector(introOffset, k);

  /* 点击脉冲带来的轻微后撤 */
  pulse *= 0.94;
  kick *= 0.93;
  if (kick > 0.001){
    tmpPos.x += Math.sin(now * 0.02) * kick * 0.5;
    tmpPos.y += Math.cos(now * 0.017) * kick * 0.35;
  }

  /* 鼠标视差 */
  tmpPos.x += smx * 1.1;
  tmpPos.y += -smy * 0.75;
  tmpTgt.x += smx * 1.9;
  tmpTgt.y += -smy * 1.3;

  camera.position.copy(tmpPos);
  camera.fov = 55 + (1 - introT) * 34;
  camera.updateProjectionMatrix();
  camera.lookAt(tmpTgt);
  camera.rotation.z += -smx * 0.022 + Math.sin(now * 0.00013) * 0.012;

  /* 场景动态 */
  MATERIALS.forEach(m => {
    if (!m.uniforms) return;
    if (m.uniforms.uTime)  m.uniforms.uTime.value  = time;
    if (m.uniforms.uPulse) {
      const ps = m.userData && m.userData.pulseScale !== undefined ? m.userData.pulseScale : 1;
      m.uniforms.uPulse.value = pulse * introT * ps;
    }
  });

  /* 核心 */
  gCore.rotation.y = time * 0.11;
  gCore.rotation.x = Math.sin(time * 0.16) * 0.09;
  coreInner.rotation.y = -time * 0.42;
  coreInner.rotation.z =  time * 0.26;
  coreHalo.rotation.y  =  time * 0.07;
  coreWire.rotation.y  = -time * 0.05;
  coreWire.rotation.x  =  time * 0.03;

  /* 碎晶 */
  gShards.rotation.y = time * 0.05;
  for (const s of shards){
    s.rotation.x += s.userData.spin.x * dt;
    s.rotation.y += s.userData.spin.y * dt;
    s.rotation.z += s.userData.spin.z * dt;
    const o = s.userData.org;
    s.position.set(
      o.x,
      o.y + Math.sin(time * 0.6 + o.x * 0.7) * 0.45,
      o.z + Math.cos(time * 0.45 + o.z * 0.6) * 0.45
    );
  }

  /* 流动 */
  knot.rotation.z = time * 0.10;
  knot.rotation.x = Math.sin(time * 0.14) * 0.22;
  knotWire.rotation.copy(knot.rotation);
  knotWire.rotation.y = time * 0.16;
  gKnot.rotation.y = time * 0.06;

  /* 轨道 */
  for (const r of rings) r.rotation.z += r.userData.spin * dt;
  for (const s of sats){
    const a = time * 0.42 + s.userData.phase;
    s.position.set(
      Math.cos(a) * s.userData.rad,
      Math.sin(a * 0.62) * 1.5,
      Math.sin(a) * s.userData.rad
    );
    s.rotation.y = -a * 1.6;
    s.rotation.x = a * 0.8;
  }
  gOrbit.rotation.y = -time * 0.045;

  /* 群集：每个方块独立的正弦相位 */
  for (const m of swarm){
    const s = Math.sin(time * 1.05 + m.userData.phase);
    m.position.y = s * 1.45;
    m.scale.y = 1 + (s * 0.5 + 0.5) * 3.4;
    m.rotation.y = time * 0.25 + m.userData.phase * 0.4;
  }
  gSwarm.rotation.y = time * 0.07;

  /* 产品：三个独立的旋转与漂浮模型，减少动态效果时保持静止 */
  animateProducts(products, REDUCED ? 0 : time);

  /* 门户 */
  portalRing.rotation.z  = time * 0.24;
  portalRing2.rotation.z = -time * 0.16;
  portalDisc.rotation.z  = time * 0.05;
  gPortal.rotation.y     = Math.sin(time * 0.1) * 0.10;

  /* 星尘缓慢漂移 */
  stars.rotation.y = time * 0.004;
  dust.rotation.y  = -time * 0.008;
  grid.position.z = -34 + ((p * 30) % 6);

  /* 章节文字 */
  updateChapters(p);

  /* 顶栏进度 */
  const bar = document.getElementById('progressBar');
  if (bar) bar.style.width = (p * 100).toFixed(2) + '%';

  /* 脉冲时提升辉光强度 */
  if (bloomPass) bloomPass.strength = (MOBILE ? 0.34 : 0.46) + pulse * 0.55 + introT * 0.04;

  /* 渲染 */
  if (composer) composer.render();
  else renderer.render(scene, camera);

  /* 帧率显示 */
  fpsAcc += dt; fpsN++;
  if (fpsAcc >= 0.5){
    const fpsEl = document.getElementById('fps');
    if (fpsEl && !perf.throttled) fpsEl.textContent = Math.round(fpsN / fpsAcc) + ' FPS';
    fpsAcc = 0; fpsN = 0;
  }
  perfGuard(dt);
}

if (renderer){
  /* 加载进度：本原型全部程序化生成，这里按"首帧就绪 + 最短体验时长"推进 */
  let lp = 0;
  const bar = document.getElementById('ld-bar');
  const pct = document.getElementById('ld-pct');
  const t0 = performance.now();
  (function boot(){
    const el = performance.now() - t0;
    lp = Math.min(100, (el / 1500) * 100);
    if (bar) bar.style.width = lp.toFixed(1) + '%';
    if (pct) pct.textContent = Math.round(lp);
    if (lp >= 100){
      /* 先渲染一帧，避免开场瞬间的空白 */
      renderer.render(scene, camera);
      setTimeout(startIntro, 140);
    } else {
      requestAnimationFrame(boot);
    }
  })();

  renderer.setAnimationLoop(tick);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden){ /* 暂停时丢弃累积时间，回来不跳帧 */
      clock.getDelta();
    }
  });
}
