import * as THREE from 'three'
import type { Phenotype } from '@mochimon/core'

const PATTERN_ID: Record<string, number> = {
  plain: 0,
  spots: 1,
  stripes: 2,
  scales: 3,
  patch: 4,
  gradient: 5,
}
const SPECIAL_ID: Record<string, number> = { none: 0, glow: 1, crystal: 2, rainbow: 3 }

const VERTEX = /* glsl */ `
attribute vec3 aPat;
attribute float aBelly;
uniform float uOutline;
varying vec3 vNormal;
varying vec3 vPat;
varying float vBelly;
varying vec3 vViewPos;

void main() {
  vec3 p = position + normal * uOutline;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vViewPos = mv.xyz;
  vNormal = normalize(normalMatrix * normal);
  vPat = aPat;
  vBelly = aBelly;
  gl_Position = projectionMatrix * mv;
}
`

const FRAGMENT = /* glsl */ `
uniform vec3 uBase;
uniform vec3 uBellyColor;
uniform vec3 uPatternColor;
uniform int uPattern;
uniform float uPatFreq;
uniform float uPatContrast;
uniform float uHeight;
uniform int uSpecial;
uniform float uTime;
uniform float uOpacity;
varying vec3 vNormal;
varying vec3 vPat;
varying float vBelly;
varying vec3 vViewPos;

float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash31(i), hash31(i + vec3(1, 0, 0)), f.x),
        mix(hash31(i + vec3(0, 1, 0)), hash31(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash31(i + vec3(0, 0, 1)), hash31(i + vec3(1, 0, 1)), f.x),
        mix(hash31(i + vec3(0, 1, 1)), hash31(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float worley(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float d = 1.0;
  for (int x = -1; x <= 1; x++)
  for (int y = -1; y <= 1; y++)
  for (int z = -1; z <= 1; z++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = hash33(i + g);
    d = min(d, length(g + o - f));
  }
  return d;
}

float patternMask(vec3 p) {
  if (uPattern == 1) {
    return 1.0 - smoothstep(0.26, 0.31, worley(p * uPatFreq));
  }
  if (uPattern == 2) {
    float wave = sin(p.z * uPatFreq * 3.2 + p.y * 1.5 + vnoise(p * 3.0) * 2.4);
    return smoothstep(0.25, 0.4, wave);
  }
  if (uPattern == 3) {
    vec3 q = p * uPatFreq * 1.6;
    q.x += 0.5 * floor(q.y);
    q.z += 0.5 * floor(q.y);
    float d = length(fract(q) - 0.5);
    return smoothstep(0.34, 0.5, d) * 0.85;
  }
  if (uPattern == 4) {
    return smoothstep(0.5, 0.54, vnoise(p * uPatFreq * 0.55 + 7.3));
  }
  if (uPattern == 5) {
    return 1.0 - smoothstep(0.2, 0.75, p.y / max(uHeight, 0.001));
  }
  return 0.0;
}

void main() {
  vec3 n = normalize(vNormal);
  if (uSpecial == 2) {
    // ผิวคริสตัล: ใช้ normal ของหน้าโพลิกอนจริง ให้เห็นเป็นเหลี่ยม
    n = normalize(cross(dFdx(vViewPos), dFdy(vViewPos)));
  }
  if (!gl_FrontFacing) n = -n;
  vec3 viewDir = normalize(-vViewPos);

  vec3 col = mix(uBase, uPatternColor, patternMask(vPat) * uPatContrast);
  col = mix(col, uBellyColor, vBelly);

  if (uSpecial == 3) {
    vec3 rainbow = 0.5 + 0.5 * cos(6.2831 * (vPat.y * 0.9 + vPat.z * 0.4 + uTime * 0.12 + vec3(0.0, 0.33, 0.67)));
    col = mix(col, mix(rainbow, vec3(1.0), 0.35), 0.6 * (1.0 - vBelly));
  }

  // cel shading 3 ระดับ + เงาโทนเย็น
  vec3 lightDir = normalize(vec3(-0.35, 0.8, 0.55));
  float ndl = dot(n, lightDir);
  float band = smoothstep(-0.02, 0.05, ndl) * 0.72 + smoothstep(0.5, 0.58, ndl) * 0.28;
  vec3 shadow = col * vec3(0.66, 0.62, 0.8);
  vec3 lit = mix(shadow, col, band);

  // ขอบสว่าง + จุดสะท้อนแบบของเล่นไวนิล
  float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
  lit += rim * 0.18 * smoothstep(-0.2, 0.4, ndl);
  vec3 halfV = normalize(lightDir + viewDir);
  float spec = smoothstep(0.965, 0.98, dot(n, halfV));
  lit = mix(lit, vec3(1.0), spec * (uSpecial == 2 ? 0.7 : 0.22));

  if (uSpecial == 1) {
    float pulse = 0.5 + 0.5 * sin(uTime * 2.2);
    lit += uPatternColor * (0.18 + 0.14 * pulse) + rim * (0.35 + 0.25 * pulse);
  }

  gl_FragColor = vec4(lit, uOpacity);
  #include <colorspace_fragment>
}
`

const OUTLINE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
void main() {
  gl_FragColor = vec4(uColor, 1.0);
  #include <colorspace_fragment>
}
`

export interface CreatureMaterials {
  /** ผิวลำตัว (มีลวดลาย + สีท้อง) */
  body: THREE.ShaderMaterial
  /** เขา/กีบ/จะงอย/เยื่อปีก: สี accent ไม่มีลาย */
  accent: THREE.ShaderMaterial
  /** ชิ้นส่วนแบน 2 หน้า (ปีก/ครีบ) */
  membrane: THREE.ShaderMaterial
  /** ปีกภูตโปร่งแสง */
  sheer: THREE.ShaderMaterial
  outline: THREE.ShaderMaterial
  eyeDark: THREE.MeshBasicMaterial
  eyeIris: THREE.MeshBasicMaterial
  eyeShine: THREE.MeshBasicMaterial
  nose: THREE.MeshBasicMaterial
  blush: THREE.MeshBasicMaterial
  /** ความหนาเส้นขอบ (หน่วยของโมเดล) */
  outlineWidth: number
  all: THREE.Material[]
  setTime(t: number): void
}

export function createCreatureMaterials(p: Phenotype, height: number): CreatureMaterials {
  const color = (hex: string) => new THREE.Color(hex)
  const special = SPECIAL_ID[p.parts.special.shape] ?? 0
  const time = { value: 0 }
  const outlineWidth = 0.014

  const make = (
    base: THREE.Color,
    opts: { pattern: boolean; side?: THREE.Side; opacity?: number },
  ): THREE.ShaderMaterial =>
    new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: opts.side ?? THREE.FrontSide,
      transparent: (opts.opacity ?? 1) < 1,
      depthWrite: (opts.opacity ?? 1) >= 1,
      uniforms: {
        uBase: { value: base },
        uBellyColor: { value: color(p.colors.belly.hex) },
        uPatternColor: { value: color(p.colors.pattern.hex) },
        uPattern: { value: opts.pattern ? (PATTERN_ID[p.parts.pattern.shape] ?? 0) : 0 },
        uPatFreq: { value: THREE.MathUtils.lerp(7.5, 3.2, p.nums['pattern.scale'] ?? 0.5) },
        uPatContrast: {
          value: THREE.MathUtils.lerp(0.55, 1, p.nums['pattern.contrast'] ?? 0.5),
        },
        uHeight: { value: height },
        uSpecial: { value: special },
        uTime: time,
        uOutline: { value: 0 },
        uOpacity: { value: opts.opacity ?? 1 },
      },
    })

  const baseColor = color(p.colors.base.hex)
  const accentColor = color(p.colors.accent.hex)
  const body = make(baseColor, { pattern: true })
  const accent = make(accentColor, { pattern: false })
  const membrane = make(accentColor, { pattern: false, side: THREE.DoubleSide })
  const sheer = make(accentColor.clone().lerp(new THREE.Color('#ffffff'), 0.4), {
    pattern: false,
    side: THREE.DoubleSide,
    opacity: 0.62,
  })

  // เส้นขอบ: สีหลักที่เข้มลงและอมม่วง (นุ่มกว่าเส้นดำ)
  const outlineColor = baseColor.clone().multiply(new THREE.Color(0.36, 0.3, 0.42))
  const outline = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: OUTLINE_FRAGMENT,
    side: THREE.BackSide,
    uniforms: { uColor: { value: outlineColor }, uOutline: { value: outlineWidth } },
  })

  const eyeDark = new THREE.MeshBasicMaterial({ color: '#2a2233' })
  const eyeIris = new THREE.MeshBasicMaterial({ color: p.colors.eye.hex })
  const eyeShine = new THREE.MeshBasicMaterial({ color: '#ffffff' })
  const nose = new THREE.MeshBasicMaterial({ color: '#7a4a5a' })
  const blush = new THREE.MeshBasicMaterial({
    color: '#ff8fa8',
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  })

  const all = [body, accent, membrane, sheer, outline, eyeDark, eyeIris, eyeShine, nose, blush]
  return {
    body,
    accent,
    membrane,
    sheer,
    outline,
    eyeDark,
    eyeIris,
    eyeShine,
    nose,
    blush,
    outlineWidth,
    all,
    setTime: (t) => {
      time.value = t
    },
  }
}
