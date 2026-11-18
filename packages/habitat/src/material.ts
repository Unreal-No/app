import * as THREE from 'three'

const VERTEX = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewPos;
varying float vHeight;
uniform float uSpan;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  vNormal = normalize(normalMatrix * normal);
  vHeight = uSpan > 0.0 ? clamp(position.y / uSpan + 0.5, 0.0, 1.0) : 0.5;
  gl_Position = projectionMatrix * mv;
}
`

/** แสงนุ่มแบบเดียวกับตัวสัตว์ (half-lambert + เงาอมม่วง + ขอบสว่าง) เพื่อให้ฉากกับสัตว์เข้าชุดกัน */
const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uTop;
uniform float uOpacity;
uniform float uGlass;
uniform float uGlow;
uniform vec3 uSceneTint;
varying vec3 vNormal;
varying vec3 vViewPos;
varying float vHeight;
void main() {
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  // กล้อง orthographic (ฉาก overlay) มองตรงตามแกน z — ใช้ตำแหน่งแทนไม่ได้เพราะวัตถุอยู่ห่างจากจุดกำเนิดมาก
  vec3 viewDir = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(-vViewPos);
  vec3 col = mix(uColor, uTop, vHeight);
  float wrap = dot(n, normalize(vec3(-0.3, 0.75, 0.6))) * 0.5 + 0.5;
  vec3 lit = mix(col * vec3(0.62, 0.62, 0.88), col, smoothstep(0.28, 0.82, wrap));
  float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 2.6);
  lit += vec3(0.85, 0.9, 1.0) * rim * 0.25;
  lit = mix(lit, col + rim * 0.5, uGlow);
  // แก้ว: กลางใส ขอบเห็นชัด
  float alpha = mix(uOpacity, clamp(uOpacity * 0.35 + rim * 0.9, 0.0, 1.0), uGlass);
  gl_FragColor = vec4(mix(lit, vec3(1.0), uGlass * rim * 0.6) * uSceneTint, alpha);
  #include <colorspace_fragment>
}
`

/** สีแสงของฉาก (ใช้ร่วมทุกวัสดุของฉาก) */
export const SCENE_TINT = { value: new THREE.Color(1, 1, 1) }
export function setSceneTint(r: number, g: number, b: number): void {
  SCENE_TINT.value.setRGB(r, g, b)
}

export interface SoftOptions {
  /** สีด้านบนของชิ้น (ไล่สีตามความสูง) */
  top?: string
  /** ความสูงของชิ้นสำหรับไล่สี */
  span?: number
  opacity?: number
  glass?: boolean
  glow?: number
  side?: THREE.Side
}

export function soft(color: string, opts: SoftOptions = {}): THREE.ShaderMaterial {
  const opacity = opts.opacity ?? 1
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: opacity < 1 || !!opts.glass,
    depthWrite: opacity >= 1 && !opts.glass,
    side: opts.side ?? THREE.FrontSide,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uTop: { value: new THREE.Color(opts.top ?? color) },
      uSpan: { value: opts.top ? (opts.span ?? 1) : 0 },
      uOpacity: { value: opacity },
      uGlass: { value: opts.glass ? 1 : 0 },
      uGlow: { value: opts.glow ?? 0 },
      uSceneTint: SCENE_TINT,
    },
  })
}
