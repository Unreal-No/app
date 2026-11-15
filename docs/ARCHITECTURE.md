# Architecture

## ภาพรวม

```
┌──────────────────────────── apps/desktop (Tauri) ───────────────────────────┐
│  Rust: overlay.rs (หน้าต่าง + คลิกทะลุ) · tray.rs · lib.rs (commands)        │
│        ▲ invoke: set_hit_shapes, get_desktop_layout   ▼ event: cursor, tray  │
│  Webview: src/main.ts (ฉาก three.js, PetActor, คำพูด) · bridge.ts · save.ts  │
└──────────────┬──────────────────────────────────────────────┬───────────────┘
               │                                              │
        packages/creature                               packages/core ──► packages/data
   (phenotype → โมเดล + animation)              (ยีนส์ จำลองชีวิต พฤติกรรม)   (Gene DB)
               ▲                                              ▲
               └───────────────── apps/lab (Creature Lab) ────┘
```

ทิศทางการพึ่งพา: `data` ← `core` ← `creature` ← แอป แกนเกม (`core`) ไม่รู้จัก DOM, three.js หรือ Tauri

## packages/data

- `loci.json` — 44 locus: part 13, ตัวเลข 24, สี 7
- `alleles/*.json` — allele ของ part-locus (dominance, lineage, rarity, รูปทรง, พารามิเตอร์)
- `species/*.json` — สายพันธุ์ตั้งต้น 7 ชนิด = pool ของ allele + ค่าเฉลี่ย/ส่วนเบี่ยงเบน + จานสี
- `index.ts` — `buildGeneDb()` ตรวจด้วย zod และตรวจการอ้างอิงข้ามไฟล์ตอนโหลด

## packages/core

| โมดูล                  | หน้าที่                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| `rng.ts`              | PRNG แบบ seed ได้ (ผลทำซ้ำได้ → ทดสอบได้)                                                                        |
| `genetics/`           | `createFounder`, `express` (genotype→phenotype), `breed` (+linkage, mutation), `speciesLabel`, `createMochi` |
| `summon/fileSeed.ts`  | ลักษณะไฟล์ → genome (ฟังก์ชันบริสุทธิ์)                                                                               |
| `body/composition.ts` | ยีนส์โครงร่าง + การเลี้ยงดู → `BodySpec`                                                                           |
| `mind/`               | needs, emotion (valence/arousal + mood), personality (ยีนส์ + ประสบการณ์)                                       |
| `behavior/utility.ts` | Utility AI ให้คะแนนพฤติกรรม                                                                                    |
| `sim/petSim.ts`       | `PetState`, `tickPet`, `petEvent`, `carePet` — ทุกฟังก์ชันคืนสถานะใหม่ ไม่แก้ของเดิม                                  |

## packages/creature

`new Creature(phenotype, nurture, options)` → `root` (THREE.Group), `update(dt, input)`

1. `build/creature.ts` ประกอบชิ้นส่วนเป็นลำดับชั้น rig (ลำตัว → หัว/หาง/ปีก, ขาแยก) และกำหนดท่าทาง (`poses`)
2. อบข้อมูลต่อ vertex ในท่าพัก: ตำแหน่งสำหรับลวดลาย, น้ำหนักสี (ท้อง/ลายแต้ม), ความยาวขน, AO
3. `build/field.ts` หลอมรอยต่อของชิ้นส่วนในกลุ่มเดียวกันด้วยสนาม SDF (ดัน vertex + ใช้ normal ร่วม)
4. `material/plush.ts` ผิวตุ๊กตา + ขนแบบ shell (InstancedMesh ซ้อนชั้น), `material/face.ts` ตา/ปาก/แก้มเป็น shader
5. `anim/animate.ts` ผสมท่า (ยืน/นั่ง/หมอบ/นอนขด) + การเดิน หายใจ กะพริบตา หาง หู ปีก; `anim/expression.ts` ชุดสีหน้า

## packages/habitat

`createHabitat(kind)` → ฉากไดโอรามาบนแท่นกลม (ทุ่งหญ้า เกาะเมฆ ใต้น้ำ หิมะ) สร้างด้วยโค้ด มี `surfaceY` บอกระดับที่สัตว์ยืนได้
ใช้ใน Lab และเป็น "โหมดมุมพักผ่อน" ของ Desktop ไม่ขึ้นกับ `core`/`creature`

## apps/desktop

- `PetActor` (ใน `src/main.ts`) = สถานะจาก `core` + โมเดลจาก `creature` + ฟิสิกส์ง่ายๆ (เดิน ร่วง ถูกอุ้ม)
- จำลองชีวิตทุก 1 วินาทีด้วย `tickPet`; วาดด้วยกล้อง orthographic หน่วยเป็น CSS px
- `bridge.ts` ห่อการเรียก Tauri และมีค่าจำลองเมื่อรันในเบราว์เซอร์ธรรมดา → ทดสอบฉากได้โดยไม่ต้องมี Windows

## การเซฟ

M0 เก็บ `PetState` เป็น JSON ใน localStorage (`apps/desktop/src/save.ts`, คีย์ `mochimon.save.v1`) และตรวจ genome ตอนโหลด

M1 ย้ายไป SQLite — ตารางที่วางแผนไว้: `pets` (genome JSON, nurture, needs, experience) · `lineage` · `eggs` · `memories` · `relationships` · `care_events` · `inventory` · `habitats` · `summoned_files` (เก็บเฉพาะ hash) · `reminders` · `calendar_sources` · `discovered_alleles` · `settings` พร้อมเลขเวอร์ชัน schema, migration และไฟล์สำรองหมุนเวียน
