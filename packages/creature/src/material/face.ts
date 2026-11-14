import * as THREE from 'three'

/**
 * ดวงตาและปากวาดด้วย shader บนแผ่นโค้งที่แนบผิวหัว (ดู build/face.ts)
 * พิกัด vUv: -1..1 ภายในกรอบของแผ่น (x ขวา, y บน)
 */
const VERTEX = /* glsl */ `
attribute vec2 aUv;
varying vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const EYE_FRAGMENT = /* glsl */ `
uniform vec3 uIris;
uniform float uOpen;   // 1 = ลืมเต็มที่, 0 = หลับ (เส้นโค้งคว่ำลง)
uniform float uSmile;  // 1 = ตายิ้มปิดเป็นโค้ง ^
uniform float uSlant;  // + โกรธ (หางตาชี้ขึ้น), - เศร้า
uniform float uSide;   // +1 ตาขวาของจอ, -1 ตาซ้าย
uniform vec2 uLook;
uniform float uSparkle;
uniform float uSlit;
varying vec2 vUv;

void main() {
  vec2 p = vUv;
  vec3 dark = vec3(0.045, 0.03, 0.075);
  float aa = 0.035;

  // ── ตาปิด: วาดเป็นเส้นโค้งเส้นเดียว ──
  float closedLine = 1.0 - smoothstep(0.0, 0.12, uOpen);
  float arc = max(uSmile, closedLine);
  if (arc > 0.5) {
    float curve = uSmile > 0.5 ? 0.22 - 0.5 * p.x * p.x : -0.12 + 0.3 * p.x * p.x;
    float line = 1.0 - smoothstep(0.1, 0.1 + aa * 2.0, abs(p.y - curve));
    line *= 1.0 - smoothstep(0.8, 0.9, abs(p.x));
    if (line < 0.05) discard;
    gl_FragColor = vec4(dark, line);
    #include <colorspace_fragment>
    return;
  }

  // ── ตาเปิด: วงรี ตัดด้วยเปลือกตาบน ──
  float d = length(p);
  float lid = mix(-0.35, 1.25, uOpen) - uSlant * uSide * p.x * 0.75;
  float inside = (1.0 - smoothstep(1.0 - aa, 1.0, d)) * (1.0 - smoothstep(lid - aa, lid, p.y));
  if (inside < 0.05) discard;

  // ขอบตาเข้ม หนาด้านบนเหมือนขนตา
  float ringStart = mix(0.9, 0.78, smoothstep(-0.3, 0.8, p.y));
  float ring = smoothstep(ringStart - aa, ringStart, d);
  ring = max(ring, smoothstep(lid - 0.2, lid - 0.1, p.y));

  // ม่านตาไล่สี: บนเข้ม ล่างสว่าง
  vec3 col = mix(uIris * 1.35, uIris * 0.3, smoothstep(-0.75, 0.55, p.y));
  col += uIris * 0.55 * (1.0 - smoothstep(0.0, 0.5, length(p - vec2(0.0, -0.62))));

  // รูม่านตา
  vec2 pc = p - uLook * vec2(0.16, 0.12) - vec2(0.0, 0.06);
  vec2 pr = mix(vec2(0.44, 0.56), vec2(0.16, 0.66), uSlit);
  float pupil = 1.0 - smoothstep(1.0 - aa * 3.0, 1.0, length(pc / pr));
  col = mix(col, dark, pupil * 0.92);
  col = mix(col, dark, ring);

  // ประกายตา
  float shine = 1.0 - smoothstep(0.24, 0.24 + aa, length(p - vec2(-0.3, 0.36)));
  shine = max(shine, 1.0 - smoothstep(0.11, 0.11 + aa, length(p - vec2(0.34, -0.3))));
  shine = max(shine, uSparkle * (1.0 - smoothstep(0.08, 0.08 + aa, length(p - vec2(0.4, 0.4)))));
  shine = max(shine, uSparkle * (1.0 - smoothstep(0.06, 0.06 + aa, length(p - vec2(-0.42, -0.2)))));
  col = mix(col, vec3(1.0), shine * (1.0 - smoothstep(lid - 0.25, lid - 0.12, p.y)));

  gl_FragColor = vec4(col, inside);
  #include <colorspace_fragment>
}
`

const MOUTH_FRAGMENT = /* glsl */ `
uniform int uShape;    // 0 = ω, 1 = ยิ้มอ้าปาก, 2 = o, 3 = คว่ำ, 4 = หยัก
uniform float uOpen;
varying vec2 vUv;

float stroke(float d, float w) {
  return 1.0 - smoothstep(w, w + 0.06, abs(d));
}

void main() {
  vec2 p = vUv;
  vec3 lineCol = vec3(0.3, 0.14, 0.2);
  vec3 col = lineCol;
  float a = 0.0;
  float ax = abs(p.x);

  if (uShape == 0 || uShape == 1) {
    // ω: โค้งสองลอนใต้จมูก
    float lobe = 0.38 - 0.3 * (1.0 - pow(ax / 0.34 - 1.0, 2.0));
    a = stroke(p.y - lobe, 0.055) * (1.0 - smoothstep(0.62, 0.7, ax));
    a = max(a, stroke(p.x, 0.045) * step(0.3, p.y) * (1.0 - step(0.75, p.y)));
  }
  if (uShape == 1) {
    // ปากอ้ายิ้ม: รูปตัว D คว่ำ + ลิ้น
    float h = 0.18 + 0.62 * uOpen;
    vec2 q = vec2(p.x / 0.44, (p.y - 0.1) / h);
    float inside = (1.0 - smoothstep(0.92, 1.0, length(q))) * (1.0 - smoothstep(0.08, 0.14, p.y));
    vec3 cavity = vec3(0.5, 0.1, 0.2);
    float tongue = 1.0 - smoothstep(0.3, 0.36, length((p - vec2(0.0, 0.1 - h * 0.92)) / vec2(1.0, 0.8)));
    cavity = mix(cavity, vec3(1.0, 0.5, 0.6), tongue);
    float edge = smoothstep(0.8, 0.95, length(q));
    col = mix(mix(cavity, lineCol, edge), col, a * (1.0 - inside));
    a = max(a, inside);
  }
  if (uShape == 2) {
    float r = length((p - vec2(0.0, 0.0)) / vec2(0.2, 0.2 + 0.2 * uOpen));
    a = 1.0 - smoothstep(0.92, 1.0, r);
    col = mix(vec3(0.5, 0.1, 0.2), lineCol, smoothstep(0.6, 0.9, r));
  }
  if (uShape == 3) {
    a = stroke(p.y - (0.2 - 0.6 * p.x * p.x) + 0.25, 0.06) * (1.0 - smoothstep(0.42, 0.5, ax));
  }
  if (uShape == 4) {
    a = stroke(p.y - 0.1 - 0.09 * sin(p.x * 9.0), 0.055) * (1.0 - smoothstep(0.55, 0.62, ax));
  }
  if (a < 0.05) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`

const BLUSH_FRAGMENT = /* glsl */ `
uniform float uStrength;
varying vec2 vUv;
void main() {
  float a = (1.0 - smoothstep(0.25, 1.0, length(vUv))) * uStrength;
  gl_FragColor = vec4(1.0, 0.5, 0.62, clamp(a, 0.0, 0.9));
  #include <colorspace_fragment>
}
`

export interface FaceMaterials {
  eyes: [THREE.ShaderMaterial, THREE.ShaderMaterial]
  mouth: THREE.ShaderMaterial
  /** แก้มแดงแบบพ่นฟุ้ง (uStrength ปรับตามอารมณ์) */
  blush: THREE.ShaderMaterial
  all: THREE.Material[]
}

/** ดึงใบหน้าเข้าหากล้องเล็กน้อยในเชิง depth: ขนรอบๆ จะไม่ขึ้นมาบังตา/ปาก */
const ON_TOP = { polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -80 }

export function createFaceMaterials(irisHex: string, eyeShape: string): FaceMaterials {
  const shared = {
    uIris: { value: new THREE.Color(irisHex) },
    uOpen: { value: 1 },
    uSmile: { value: 0 },
    uSlant: { value: 0 },
    uLook: { value: new THREE.Vector2() },
    uSparkle: { value: eyeShape === 'sparkle' ? 1 : 0 },
    uSlit: { value: eyeShape === 'slit' ? 1 : 0 },
  }
  const eye = (side: number) =>
    new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: EYE_FRAGMENT,
      alphaToCoverage: true,
      ...ON_TOP,
      uniforms: { ...shared, uSide: { value: side } },
    })
  const mouth = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: MOUTH_FRAGMENT,
    alphaToCoverage: true,
    ...ON_TOP,
    uniforms: { uShape: { value: 0 }, uOpen: { value: 0 } },
  })
  const blush = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: BLUSH_FRAGMENT,
    transparent: true,
    depthWrite: false,
    ...ON_TOP,
    uniforms: { uStrength: { value: 0.45 } },
  })
  const eyes: [THREE.ShaderMaterial, THREE.ShaderMaterial] = [eye(1), eye(-1)]
  return { eyes, mouth, blush, all: [...eyes, mouth, blush] }
}
