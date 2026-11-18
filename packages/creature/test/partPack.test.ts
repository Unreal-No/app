import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { knownShapes, loadPartPack } from '../src/parts/partPack'

const example = readFileSync(new URL('../../../tools/parts-kit/example-parts.glb', import.meta.url))
const buffer = (b: Buffer): ArrayBuffer =>
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer

describe('ชุดชิ้นส่วน .glb', () => {
  it('รู้จักรูปทรงของหู เขา ปีก หาง จาก Gene DB', () => {
    const shapes = knownShapes()
    expect(shapes.get('ears.point')).toBeTruthy()
    expect(shapes.get('wings.bat')).toBeTruthy()
    expect(shapes.get('tail.fluffy')).toBeTruthy()
    expect(shapes.has('wings.none')).toBe(false)
    expect(shapes.has('head.cat')).toBe(false)
  })

  it('อ่านไฟล์ตัวอย่างจาก Blender: ครบ 4 ชิ้น วัสดุตามชื่อ material', async () => {
    const pack = await loadPartPack(buffer(example))
    expect([...pack.parts.keys()].sort()).toEqual([
      'ears.point',
      'horns.spiral',
      'tail.fluffy',
      'wings.bat',
    ])
    expect(pack.report.unknown).toEqual([])
    expect(pack.report.problems).toEqual([])
    expect(pack.parts.get('horns.spiral')!.center).toBe(true)
    const ear = pack.parts.get('ears.point')!
    expect(ear.pieces.map((p) => p.role).sort()).toEqual(['inner', 'skin'])
    const horn = pack.parts.get('horns.spiral')!
    expect(horn.pieces.some((p) => p.role === 'texture' && p.material)).toBe(true)
    // แกน: หูงอกขึ้น (+Y), หางยื่นไปด้านหลัง (−Z) หลังแปลงจาก Blender
    const box = (key: string) => {
      const all = new THREE.Box3()
      for (const piece of pack.parts.get(key)!.pieces) {
        piece.geometry.computeBoundingBox()
        all.union(piece.geometry.boundingBox!)
      }
      return all
    }
    expect(box('ears.point').max.y).toBeGreaterThan(0.6)
    expect(box('ears.point').min.y).toBeGreaterThan(-0.05)
    expect(box('tail.fluffy').min.z).toBeLessThan(-0.6)
    expect(box('wings.bat').max.x).toBeGreaterThan(0.6)
    pack.dispose()
  })

  it('ไฟล์เสีย/ไม่ใช่ glb แจ้งเป็นภาษาคน', async () => {
    await expect(
      loadPartPack(new TextEncoder().encode('hello').buffer as ArrayBuffer),
    ).rejects.toThrow('อ่านไฟล์นี้ไม่ได้')
    await expect(loadPartPack(new ArrayBuffer(21 * 1024 * 1024))).rejects.toThrow('20 MB')
  })
})
