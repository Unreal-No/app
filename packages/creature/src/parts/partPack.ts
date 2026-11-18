import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { geneDb, type GeneDb } from '@mochimon/core'

/**
 * ชุดชิ้นส่วน 3D จากไฟล์ .glb ที่ออกแบบด้วยโปรแกรมอื่น (Blender, AI สร้างโมเดล ฯลฯ)
 *
 * ข้อกำหนด (รายละเอียดใน docs/PARTS_GUIDE.md):
 * - node ชื่อ `<ช่อง>.<รูปทรง>` ตรงกับ allele ที่มีอยู่ เช่น `ears.point`, `horns.spiral`, `wings.bat`, `tail.fluffy`
 *   (`horns.<รูปทรง>.center` = เขาเดี่ยวกลางหน้าผาก, นอกนั้นเป็นคู่ซ้าย-ขวา)
 * - หน่วย: หู/เขา 1 = รัศมีหัว, ปีก 1 = ความยาวปีก, หาง 1 = ความยาวหาง
 * - origin ของ node = จุดต่อ; ชิ้นคู่ทำเฉพาะฝั่งขวา (+X) โปรแกรมสะท้อนฝั่งซ้ายให้
 * - หู/เขางอกไปทาง +Y, ปีกกางไปทาง +X, หางยื่นไปทาง −Z, ด้านหน้าของสัตว์คือ +Z
 * - ชื่อ material กำหนดสี: skin (สีตัว+ขน) · inner (ในหู) · accent (เขา/เรืองแสง) · membrane (ปีก) ·
 *   texture (ใช้สี/ภาพจากไฟล์) — ต่อท้าย `_nofur` เพื่อไม่ใส่ขน
 */
export const PART_SLOTS = ['ears', 'horns', 'wings', 'tail'] as const
export type PartSlot = (typeof PART_SLOTS)[number]
export type PieceRole = 'skin' | 'inner' | 'accent' | 'membrane' | 'texture'

/** ขีดจำกัดเพื่อไม่ให้เครื่องช้า */
export const MAX_PACK_BYTES = 20 * 1024 * 1024
export const MAX_PACK_TRIANGLES = 200_000

export interface PartPiece {
  /** geometry ในพิกัดของ node (origin = จุดต่อ) — คัดลอกก่อนใช้ทุกครั้ง */
  geometry: THREE.BufferGeometry
  role: PieceRole
  fur: boolean
  /** วัสดุจากไฟล์ (เฉพาะ role = texture) */
  material?: THREE.Material
}

export interface PartModel {
  key: string
  pieces: PartPiece[]
  /** เขาเดี่ยวกลางหน้าผาก */
  center: boolean
}

export interface PackReport {
  /** ชิ้นที่ใช้ได้: key + ชื่อไทย */
  used: { key: string; name: string }[]
  /** ชื่อ node ที่ไม่ตรงกับรูปทรงใดเลย */
  unknown: string[]
  problems: string[]
  triangles: number
}

export interface PartPack {
  parts: Map<string, PartModel>
  report: PackReport
  dispose(): void
}

/** รูปทรงที่รองรับต่อช่อง → ชื่อไทย (จาก Gene DB) */
export function knownShapes(db: GeneDb = geneDb): Map<string, string> {
  const map = new Map<string, string>()
  const locusSlot = new Map(db.loci.filter((l) => l.kind === 'part').map((l) => [l.id, l.slot]))
  for (const def of Object.values(db.alleles)) {
    const slot = locusSlot.get(def.locus)
    if (!slot || !(PART_SLOTS as readonly string[]).includes(slot) || def.shape === 'none') continue
    map.set(`${slot}.${def.shape}`, def.name.th)
  }
  return map
}

const roleOf = (name: string): { role: PieceRole; fur: boolean } => {
  const lower = name.toLowerCase()
  const fur = !lower.includes('nofur')
  for (const role of ['inner', 'accent', 'membrane', 'texture', 'skin'] as const)
    if (lower.startsWith(role)) return { role, fur }
  return { role: 'skin', fur }
}

const triangles = (g: THREE.BufferGeometry): number =>
  (g.index ? g.index.count : g.getAttribute('position').count) / 3

/** อ่านไฟล์ .glb → ชุดชิ้นส่วน + รายงานผล (โยน Error พร้อมข้อความภาษาไทยถ้าอ่านไม่ได้เลย) */
export async function loadPartPack(data: ArrayBuffer, db: GeneDb = geneDb): Promise<PartPack> {
  if (data.byteLength > MAX_PACK_BYTES) throw new Error('ไฟล์ใหญ่เกิน 20 MB')
  let scene: THREE.Group
  try {
    const gltf = await new GLTFLoader().parseAsync(data, '')
    scene = gltf.scene
  } catch {
    throw new Error('อ่านไฟล์นี้ไม่ได้ — ต้องเป็นไฟล์ .glb (glTF แบบไฟล์เดียว)')
  }
  scene.updateMatrixWorld(true)
  const known = knownShapes(db)
  const parts = new Map<string, PartModel>()
  const report: PackReport = { used: [], unknown: [], problems: [], triangles: 0 }
  const ownedMaterials = new Set<THREE.Material>()

  // three.js ตัดจุดออกจากชื่อ node (ชื่อเดิมอยู่ใน userData.name) และผู้ออกแบบอาจใช้ขีดล่างแทนจุด
  const nameOf = (obj: THREE.Object3D): string =>
    String((obj.userData as { name?: string }).name ?? obj.name).replace(/_/g, '.')
  const isPart = (obj: THREE.Object3D | null): boolean =>
    obj !== null && /^(ears|horns|wings|tail)\./.test(nameOf(obj))
  const candidates: THREE.Object3D[] = []
  scene.traverse((obj) => {
    if (isPart(obj) && !isPart(obj.parent)) candidates.push(obj)
  })
  for (const node of candidates) {
    const raw = nameOf(node)
    const center = raw.endsWith('.center')
    const key = center ? raw.slice(0, -'.center'.length) : raw
    const label = known.get(key)
    if (!label) {
      report.unknown.push(raw)
      continue
    }
    if (center && !key.startsWith('horns.')) {
      report.problems.push(`${raw}: ".center" ใช้ได้กับเขาเท่านั้น`)
      continue
    }
    const inverse = node.matrixWorld.clone().invert()
    const pieces: PartPiece[] = []
    node.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return
      const geometry = (obj.geometry as THREE.BufferGeometry).clone()
      geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, obj.matrixWorld))
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals()
      // ใช้แค่ตำแหน่ง/normal/uv — สี/ขนคำนวณใหม่ตามยีนส์
      for (const attr of Object.keys(geometry.attributes))
        if (!['position', 'normal', 'uv'].includes(attr)) geometry.deleteAttribute(attr)
      const material = Array.isArray(obj.material) ? obj.material[0] : obj.material
      const { role, fur } = roleOf(material?.name ?? '')
      report.triangles += triangles(geometry)
      const piece: PartPiece = { geometry, role, fur }
      if (role === 'texture' && material) {
        // ฉาก overlay ไม่มีไฟ → ใช้วัสดุไม่รับแสงที่คงสี/ภาพจากไฟล์
        const source = material as THREE.MeshStandardMaterial
        const basic = new THREE.MeshBasicMaterial({
          color: source.color ?? new THREE.Color(1, 1, 1),
          map: source.map ?? null,
          transparent: source.transparent,
          opacity: source.opacity,
          side: THREE.DoubleSide,
        })
        ownedMaterials.add(basic)
        piece.material = basic
      }
      pieces.push(piece)
    })
    if (pieces.length === 0) {
      report.problems.push(`${raw}: ไม่มีรูปทรง (mesh) อยู่ข้างใน`)
      continue
    }
    if (parts.has(key)) report.problems.push(`${raw}: ชื่อซ้ำ ใช้ชิ้นแรก`)
    else {
      parts.set(key, { key, pieces, center })
      report.used.push({ key, name: label })
    }
  }
  const disposeAll = (): void => {
    for (const part of parts.values()) for (const piece of part.pieces) piece.geometry.dispose()
    for (const m of ownedMaterials) m.dispose()
  }
  if (report.triangles > MAX_PACK_TRIANGLES) {
    disposeAll()
    throw new Error(
      `ชิ้นส่วนละเอียดเกินไป (${Math.round(report.triangles / 1000)}k สามเหลี่ยม เกิน ${MAX_PACK_TRIANGLES / 1000}k) — ลด polygon ใน Blender (Decimate) ก่อนนะ`,
    )
  }
  if (parts.size === 0 && report.unknown.length === 0 && report.problems.length === 0)
    report.problems.push('ไม่เจอ node ที่ชื่อขึ้นต้นด้วย ears. / horns. / wings. / tail.')
  return { parts, report, dispose: disposeAll }
}

// ───────── ชุดที่ใช้อยู่ ─────────
let active: PartPack | null = null

/** ตั้งชุดชิ้นส่วนที่ใช้สร้างสัตว์ตัวต่อๆ ไป (null = ใช้ชิ้นส่วนจากโค้ดทั้งหมด) */
export function setPartPack(pack: PartPack | null): void {
  if (active && active !== pack) active.dispose()
  active = pack
}
export const activePartPack = (): PartPack | null => active
export const partFromPack = (slot: PartSlot, shape: string): PartModel | undefined =>
  active?.parts.get(`${slot}.${shape}`)
