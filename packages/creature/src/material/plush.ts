import * as THREE from 'three'
import type { Phenotype } from '@mochimon/core'
import { NOISE, PATTERN, SYMBOLS } from './glsl'

const PATTERN_ID: Record<string, number> = {
  plain: 0,
  spots: 1,
  stripes: 2,
  scales: 3,
  patch: 4,
  gradient: 5,
}
const SPECIAL_ID: Record<string, number> = { none: 0, glow: 1, crystal: 2, rainbow: 3 }
const SYMBOL_ID: Record<string, number> = { none: 0, heart: 1, star: 2, moon: 3 }

/**
 * Vertex attributes ที่อบไว้ตอนสร้างตัว (ดู build/creature.ts)
 * - aPat   ตำแหน่งในท่าพักของตัวสัตว์ → ลวดลายไม่ไหลตอนขยับ
 * - aPaint x=สีท้อง/หน้า  y=ลายแต้ม  z=ระยะโคน→ปลาย (0..1)  w=ความสว่างจากซอกมุม (AO)
 * - aFur   ความยาวขน ณ จุดนั้น (0 = ไม่มีขน)
 */
const VERTEX = /* glsl */ `
attribute vec3 aPat;
attribute vec4 aPaint;
attribute float aFur;
uniform float uFurLen;
uniform float uShells;
varying vec3 vNormal;
varying vec3 vPat;
varying vec4 vPaint;
varying vec3 vViewPos;
varying float vShell;
varying float vFur;

void main() {
  vec3 p = position;
  vShell = 0.0;
  vFur = aFur;
  float droop = 0.0;
#ifdef SHELL
  // ขนแบบ shell: วาดผิวซ้ำหลายชั้น ดันออกตาม normal ทีละนิด
  float h = (float(gl_InstanceID) + 1.0) / uShells;
  vShell = h;
  float len = uFurLen * aFur;
  p += normal * len * h;
  droop = len * 0.28 * h * h;
#endif
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  // ปลายขนย้อยลงตามแรงโน้มถ่วงเล็กน้อย
  mv.xyz += (viewMatrix * vec4(0.0, -1.0, 0.0, 0.0)).xyz * droop * length(modelMatrix[1].xyz);
  vViewPos = mv.xyz;
  vNormal = normalize(normalMatrix * normal);
  vPat = aPat;
  vPaint = aPaint;
  gl_Position = projectionMatrix * mv;
}
`

const FRAGMENT = /* glsl */ `
uniform vec3 uBase;
uniform vec3 uBellyColor;
uniform vec3 uMarkColor;
uniform vec3 uMarkColor2;
uniform float uMarkFade;
uniform vec3 uPatternColor;
uniform vec3 uTipColor;
uniform vec3 uSymbolColor;
uniform int uSymbol;
uniform vec3 uSymbolPos;
uniform float uSymbolSize;
uniform int uSpecial;
uniform float uTime;
uniform float uGlow;
uniform float uUsePaint;
uniform float uFurDensity;
uniform float uOpacity;
uniform float uSheer;
varying vec3 vNormal;
varying vec3 vPat;
varying vec4 vPaint;
varying vec3 vViewPos;
varying float vShell;
varying float vFur;
${NOISE}
${PATTERN}
${SYMBOLS}

void main() {
  float alpha = uOpacity;
#ifdef SHELL
  // เส้นขน: แบ่งพื้นที่เป็นช่องเล็กๆ แต่ละช่องมีขน 1 กระจุก ยาวไม่เท่ากัน เรียวลงที่ปลาย
  if (vFur < 0.02) discard;
  // ขนเป็นปุย: ใช้ noise ต่อเนื่อง 2 ความถี่ → กระจุกขนรูปทรงธรรมชาติ ไม่เป็นเม็ดกลม
  // ชั้นล่างทึบเกือบเต็ม ชั้นบนเหลือเฉพาะยอดกระจุก → ขอบตัวฟูนุ่ม
  vec3 fp = vPat * uFurDensity;
  float nz = vnoise(fp) * 0.62 + vnoise(fp * 2.3 + 11.0) * 0.38;
  float edge = vShell * 0.92;
  float cover = smoothstep(edge - 0.1, edge + 0.1, nz * 1.12);
  // ตัดแบบ dither (ไม่เขียนค่าโปร่งใสครึ่งๆ ลงจอ): ขอบขนนุ่มโดยที่ทุกพิกเซลยังทึบเต็ม
  // — ค่า alpha ระหว่าง 0..1 บนหน้าต่างโปร่งใสจะกลายเป็นเส้นสว่างเกินจริง
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (cover < 0.25 + 0.5 * dither) discard;
#endif

  vec3 n = normalize(vNormal);
  if (uSpecial == 2) n = normalize(cross(dFdx(vViewPos), dFdy(vViewPos)));
  if (!gl_FrontFacing) n = -n;
  vec3 viewDir = normalize(-vViewPos);

  // ── สี: พื้น → ลวดลาย → ลายแต้ม → ปลาย → ท้อง/หน้า ──
  vec3 col = mix(uBase, uPatternColor, patternMask(vPat) * uPatContrast * uUsePaint);
  // ลายแต้มไล่สีไปทางสีเรืองแสงที่ปลายหู/ปลายหาง (เฉพาะตัวที่มียีนส์เรืองแสง)
  vec3 markCol = mix(uMarkColor, uMarkColor2, vPaint.z * uMarkFade);
  col = mix(col, markCol, vPaint.y * uUsePaint);
  col = mix(col, uTipColor, vPaint.z * (1.0 - uUsePaint));
  col = mix(col, uBellyColor, vPaint.x * uUsePaint);

  if (uSymbol > 0 && uUsePaint > 0.5) {
    // สัญลักษณ์ที่สะโพก: ฉายลงระนาบด้านข้าง (z, y) ทั้งซ้ายและขวา
    vec2 sp = (vPat.zy - uSymbolPos.zy) / uSymbolSize;
    float d = uSymbol == 1 ? sdHeart(sp) : uSymbol == 2 ? sdStar(sp) : sdMoon(sp);
    float side = smoothstep(0.3, 0.7, abs(vPat.x) / max(abs(uSymbolPos.x), 0.001));
    col = mix(col, uSymbolColor, (1.0 - smoothstep(-0.06, 0.06, d)) * side);
  }
  if (uSpecial == 3) {
    vec3 rainbow = 0.5 + 0.5 * cos(6.2831 * (vPat.y * 0.9 + vPat.z * 0.4 + uTime * 0.12 + vec3(0.0, 0.33, 0.67)));
    col = mix(col, mix(rainbow, vec3(1.0), 0.4), 0.6 * (1.0 - vPaint.x));
  }

  // ── แสงนุ่มแบบตุ๊กตา: half-lambert + เงาอมม่วง + ขอบสว่าง ──
  vec3 lightDir = normalize(vec3(-0.3, 0.75, 0.6));
  float wrap = dot(n, lightDir) * 0.5 + 0.5;
  float ramp = smoothstep(0.28, 0.82, wrap);
  // เงาอมม่วง-ฟ้า: สีขาวก็ยังเห็นรูปทรง
  vec3 shade = col * vec3(0.62, 0.62, 0.88);
  vec3 lit = mix(shade, col, ramp);
  // ซอกมุม/ใต้คาง (AO ที่อบไว้) + แสงจากฟ้า-พื้น
  lit *= mix(vec3(0.6, 0.58, 0.8), vec3(1.0), vPaint.w);
  lit *= mix(0.86, 1.0, n.y * 0.5 + 0.5);
  float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 2.6);
  lit += vec3(0.82, 0.88, 1.0) * rim * 0.3 * smoothstep(0.1, 0.7, wrap);
  float spec = smoothstep(0.965, 0.985, dot(n, normalize(lightDir + viewDir)));
  lit = mix(lit, vec3(1.0), spec * (uSpecial == 2 ? 0.7 : 0.0));

#ifdef SHELL
  // โคนขนมืด ปลายขนสว่าง
  // ชั้นขนสีเดียวกับผิว: ด้านในดูเรียบนุ่ม ความฟูไปปรากฏที่ขอบตัว
  lit *= mix(0.99, 1.02, vShell);
#endif

  // ── ชิ้นส่วนเรืองแสง (เขา/ปีก): สว่างจากข้างใน ขอบเรือง ──
  float glowPulse = 0.85 + 0.15 * sin(uTime * 1.8 + vPat.y * 6.0);
  vec3 glowCol = mix(col, vec3(1.0), 0.35 + 0.35 * vPaint.z) + rim * 0.5;
  lit = mix(lit, glowCol * glowPulse, uGlow);
  if (uSpecial == 1) {
    float pulse = 0.5 + 0.5 * sin(uTime * 2.2);
    lit += uPatternColor * (0.16 + 0.12 * pulse) + rim * (0.3 + 0.2 * pulse);
  }

  // กำมะหยี่: ความสว่างไหวเบาๆ ความถี่ต่ำ ให้ผิวดูเป็นขนนุ่ม ไม่แบนเรียบ
  lit *= 0.965 + 0.07 * vnoise(vPat * 7.0 + 3.1) * uUsePaint;
  // ชิ้นโปร่งเรืองแสง: กลางชิ้นโปร่ง ขอบทึบ
  alpha *= mix(1.0, 0.55 + 0.45 * rim, uSheer);
  gl_FragColor = vec4(lit, alpha);
  #include <colorspace_fragment>
}
`

export interface PlushOptions {
  /** ความสูงของตัว (ใช้กับลายไล่สี) */
  height: number
  /** จำนวนชั้นขน (0 = ปิดขน) */
  shells: number
  /** ตำแหน่ง/ขนาดของสัญลักษณ์บนตัว ในพิกัดท่าพัก */
  symbolPos: THREE.Vector3
  symbolSize: number
}

export interface PlushMaterials {
  /** ผิวลำตัว: สีพื้น + ลาย + ลายแต้ม + ท้อง */
  skin: THREE.ShaderMaterial
  /** ชั้นขน (undefined ถ้าปิดขนหรือสายพันธุ์ผิวเรียบ) */
  shell?: THREE.ShaderMaterial
  /** เขา/กีบ/จะงอย: สี accent (เรืองแสงตามยีนส์ glow.level) */
  accent: THREE.ShaderMaterial
  /** ปีก/ครีบ: 2 หน้า */
  membrane: THREE.ShaderMaterial
  /** ในหู / อุ้งเท้า */
  inner: THREE.ShaderMaterial
  nose: THREE.MeshBasicMaterial
  furLength: number
  shells: number
  all: THREE.Material[]
  setTime(t: number): void
  /** ปรับความถี่ของกระจุกขนตามขนาดบนจอ (px ต่อ 1 หน่วยโมเดล) ให้กระจุกกว้างราว 6–7px */
  setPixelScale(pxPerUnit: number): void
}

export function createPlushMaterials(p: Phenotype, opts: PlushOptions): PlushMaterials {
  const color = (hex: string) => new THREE.Color(hex)
  const time = { value: 0 }
  const fur = p.nums['fur.length'] ?? 0.5
  const glow = THREE.MathUtils.smoothstep(p.nums['glow.level'] ?? 0, 0.25, 0.75)
  const furLength = fur < 0.18 ? 0 : THREE.MathUtils.lerp(0.012, 0.055, fur)
  const shells = furLength > 0 ? opts.shells : 0
  const all: THREE.Material[] = []
  const furDensity = { value: 30 }

  const shared = {
    uBellyColor: { value: color(p.colors.belly.hex) },
    uMarkColor: { value: color(p.colors.mark.hex) },
    uMarkColor2: {
      value: color(p.colors.accent.hex).lerp(new THREE.Color('#ffffff'), 0.2),
    },
    uMarkFade: { value: glow * 0.9 },
    uPatternColor: { value: color(p.colors.pattern.hex) },
    uSymbolColor: { value: color(p.colors.inner.hex) },
    uSymbolPos: { value: opts.symbolPos },
    uSymbolSize: { value: opts.symbolSize },
    uPatFreq: { value: THREE.MathUtils.lerp(7.5, 3.2, p.nums['pattern.scale'] ?? 0.5) },
    uPatContrast: { value: THREE.MathUtils.lerp(0.55, 1, p.nums['pattern.contrast'] ?? 0.5) },
    uHeight: { value: opts.height },
    uSpecial: { value: SPECIAL_ID[p.parts.special.shape] ?? 0 },
    uTime: time,
    uFurLen: { value: furLength },
    uShells: { value: Math.max(1, shells) },
    uFurDensity: furDensity,
  }

  const make = (cfg: {
    base: THREE.Color
    paint: boolean
    tip?: THREE.Color
    glow?: number
    /** ความโปร่ง 0..1 (ใช้กับเขา/ปีกเรืองแสง) */
    sheer?: number
    side?: THREE.Side
    shell?: boolean
  }): THREE.ShaderMaterial => {
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: cfg.side ?? THREE.FrontSide,
      defines: cfg.shell ? { SHELL: '' } : {},
      transparent: (cfg.sheer ?? 0) > 0.05,
      uniforms: {
        ...shared,
        uBase: { value: cfg.base },
        uTipColor: { value: cfg.tip ?? cfg.base },
        uPattern: { value: cfg.paint ? (PATTERN_ID[p.parts.pattern.shape] ?? 0) : 0 },
        uSymbol: { value: cfg.paint ? (SYMBOL_ID[p.parts.symbol.shape] ?? 0) : 0 },
        uUsePaint: { value: cfg.paint ? 1 : 0 },
        uGlow: { value: cfg.glow ?? 0 },
        uOpacity: { value: 1 },
        uSheer: { value: cfg.sheer ?? 0 },
      },
    })
    all.push(material)
    return material
  }

  const base = color(p.colors.base.hex)
  const accent = color(p.colors.accent.hex)
  const accentTip = accent.clone().lerp(new THREE.Color('#ffffff'), 0.55)
  const skin = make({ base, paint: true })
  const shell = shells > 0 ? make({ base, paint: true, shell: true }) : undefined

  const basic = (hex: string) => {
    const material = new THREE.MeshBasicMaterial({ color: hex })
    all.push(material)
    return material
  }

  return {
    skin,
    shell,
    accent: make({
      base: accent,
      tip: accentTip,
      paint: false,
      glow: glow * 0.7,
      sheer: glow * 0.18,
    }),
    membrane: make({
      base: accent,
      tip: accentTip,
      paint: false,
      glow: glow * 0.6,
      sheer: glow * 0.42,
      side: THREE.DoubleSide,
    }),
    inner: make({ base: color(p.colors.inner.hex), paint: false }),
    nose: basic('#e58aa0'),
    furLength,
    shells,
    all,
    setTime: (t) => {
      time.value = t
    },
    setPixelScale: (pxPerUnit) => {
      furDensity.value = THREE.MathUtils.clamp(pxPerUnit / 6.5, 14, 70)
    },
  }
}
