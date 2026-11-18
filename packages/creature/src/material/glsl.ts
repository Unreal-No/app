/** ฟังก์ชัน GLSL ที่ใช้ร่วมกัน: noise + ลวดลายตามตำแหน่ง */
export const NOISE = /* glsl */ `
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
`

export const PATTERN = /* glsl */ `
uniform int uPattern;
uniform float uPatFreq;
uniform float uPatContrast;
uniform float uHeight;

float patternMask(vec3 p) {
  if (uPattern == 1) return 1.0 - smoothstep(0.26, 0.31, worley(p * uPatFreq));
  if (uPattern == 2) {
    float wave = sin(p.z * uPatFreq * 3.2 + p.y * 1.5 + vnoise(p * 3.0) * 2.4);
    return smoothstep(0.25, 0.4, wave);
  }
  if (uPattern == 3) {
    vec3 q = p * uPatFreq * 1.6;
    q.x += 0.5 * floor(q.y);
    q.z += 0.5 * floor(q.y);
    return smoothstep(0.34, 0.5, length(fract(q) - 0.5)) * 0.85;
  }
  if (uPattern == 4) return smoothstep(0.5, 0.54, vnoise(p * uPatFreq * 0.55 + 7.3));
  if (uPattern == 5) return 1.0 - smoothstep(0.15, 0.7, p.y / max(uHeight, 0.001));
  return 0.0;
}
`

/** รูปทรง 2 มิติสำหรับสัญลักษณ์บนตัว (ค่าลบ = อยู่ข้างใน) */
export const SYMBOLS = /* glsl */ `
float sdStar(vec2 p) {
  // ดาว 5 แฉก: รัศมีสลับยาว-สั้นตามมุม
  float a = atan(p.x, p.y);
  float k = 0.42 + 0.58 * pow(abs(cos(2.5 * a)), 2.2);
  return length(p) - k;
}
float sdHeart(vec2 p) {
  p.x = abs(p.x);
  p.y = p.y * 1.05 + 0.55;
  if (p.y + p.x > 1.0) return length(p - vec2(0.25, 0.75)) - 0.3536;
  return min(length(p - vec2(0.0, 1.0)), length(p - 0.5 * max(p.x + p.y, 0.0))) * sign(p.x - p.y);
}
float sdMoon(vec2 p) {
  return max(length(p) - 0.9, 0.62 - length(p - vec2(0.42, 0.18)));
}
`
