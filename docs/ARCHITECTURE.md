# Architecture

## ภาพรวม

```
┌──────────────────────────── apps/desktop (Tauri) ───────────────────────────┐
│  Rust: overlay.rs (หน้าต่าง + คลิกทะลุ) · platforms.rs (หน้าต่างแอปอื่น)      │
│        save.rs (ไฟล์เซฟ) · tray.rs · lib.rs (commands)                       │
│        ▲ invoke: set_hit_shapes, load_save, store_save, …                    │
│        ▼ event: cursor, tray, platforms                                      │
│  Webview: main.ts (วงรอบหลัก) · game.ts · pet.ts · panel.ts · world.ts · …   │
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

ฝั่ง Webview (`src/`):

| ไฟล์         | หน้าที่                                                                                 |
| ----------- | ------------------------------------------------------------------------------------ |
| `main.ts`   | วงรอบหลัก, เมาส์ (คลิก = ลูบ, ลาก = อุ้ม, คลิกขวา = แผงดูแล), เมนู tray, แจ้งพื้นที่จับต้องได้ให้ Rust |
| `world.ts`  | ตัววาดภาพ กล้อง ขนาดจอ เคอร์เซอร์ ฉากมุมพักผ่อน และ "พื้นผิวที่ยืนได้" (`surfaceAt`)               |
| `pet.ts`    | `PetActor` = สถานะจาก `core` + โมเดลจาก `creature` + ฟิสิกส์ (เดิน ร่วง ถูกอุ้ม กระโดดขึ้นขอบ) |
| `game.ts`   | สัตว์บนจอ (สูงสุด 4) + ฟาร์ม, คำสั่งดูแล/จับคู่, จำลองชีวิตทุก 1 วินาทีด้วย `tickPet`, เซฟ            |
| `panel.ts`  | แผงดูแล (DOM): สถานะ ปุ่มดูแล ตั้งชื่อ จับคู่ ฝากฟาร์ม                                           |
| `store.ts`  | โหลด/เขียนเซฟ และย้ายข้อมูลจากรุ่นเก่า                                                      |
| `bridge.ts` | ห่อการเรียก Tauri และมีค่าจำลองเมื่อรันในเบราว์เซอร์ธรรมดา → ทดสอบฉากได้โดยไม่ต้องมี Windows      |

วาดด้วยกล้อง orthographic หน่วยเป็น CSS px; ตอนทุกตัวพัก (นั่ง/หลับ) ลดเหลือ ~12fps

### เกาะขอบหน้าต่างของโปรแกรมอื่น

- Rust (`platforms.rs`, เฉพาะ Windows) ส่งแค่**ข้อมูลดิบ**: สี่เหลี่ยมของหน้าต่างที่มองเห็น เรียงจากหน้าสุดไปหลังสุด ทุก ~250ms เมื่อมีการเปลี่ยน
- `computePerches` (`packages/core/src/desktop/perches.ts`, มี unit test) คำนวณช่วงขอบบนที่มองเห็นจริง โดยตัดส่วนที่ถูกหน้าต่างข้างหน้าบัง
- ฟิสิกส์ใช้กฎเดียว: "ตกลงบนพื้นผิวที่สูงที่สุดซึ่งอยู่ใต้เท้า" (พื้น Taskbar, แท่นฉาก, ขอบหน้าต่าง) — จึงใช้ได้ทั้งการลากไปปล่อย การกระโดดขึ้นเอง และการร่วงเมื่อหน้าต่างหายไป
- ฟิสิกส์กลางอากาศคำนวณเป็นก้าวย่อยคงที่ (1/120 วินาที) เพื่อให้ผลเหมือนกันทุกเฟรมเรต

### มารยาทของแอปที่เปิดทั้งวัน

- ซ่อนเองเมื่อหน้าต่างที่ผู้ใช้ทำงานอยู่ "เต็มจอจริง" (ไร้แถบชื่อและคลุมทั้งจอเดียวกับสัตว์) แล้วกลับมาเอง — ตรวจจากหน้าต่างหน้าสุดโดยตรง
- เปิดพร้อม Windows (`tauri-plugin-autostart`, ค่าเริ่มต้นปิด) และกันเปิดซ้ำ (`tauri-plugin-single-instance`)
- ทุกอย่างเปิด-ปิดได้จากเมนู tray; ค่าตั้งเก็บในเซฟและซิงก์กลับไปที่เมนูตอนเริ่มแอป

## การเซฟ

เซฟเป็น **ไฟล์ JSON ไฟล์เดียว** (`SaveData` รุ่น 2 ใน `packages/core/src/save/save.ts`): สัตว์บนจอ, สัตว์ที่ฟาร์ม, ฉากที่เลือก, ค่าตั้ง

- ที่เก็บ: โฟลเดอร์ข้อมูลของแอป (`save.json`) เขียนโดย `save.rs` — เขียนลงไฟล์ชั่วคราวแล้วเปลี่ยนชื่อทับ (atomic)
  และเก็บสำเนาสำรอง 3 รุ่น หมุนไม่ถี่กว่าทุก 10 นาที; มีสำเนาใน localStorage อีกชั้น
- ตอนโหลด `firstValidSave` ลองไฟล์หลัก → สำเนาสำรองใหม่ไปเก่า → localStorage → เซฟรุ่นแรก (สัตว์ตัวเดียว) แล้วย้ายให้อัตโนมัติ
- `parseSave` ตรวจ genome ทุกตัวและซ่อมค่าที่หาย/เพี้ยน เป้าหมายคือ**สัตว์ของผู้ใช้ต้องไม่หาย**

ยังไม่ใช้ SQLite: ข้อมูลตอนนี้เล็ก (ไม่กี่สิบ KB) ไฟล์เดียวจึงง่ายและเสี่ยงน้อยกว่า
จะย้ายเมื่อมีข้อมูลที่โตตามเวลา (ความทรงจำ ประวัติการดูแล การเตือน) — ตารางที่วางแผนไว้: `pets` (genome JSON, nurture, needs, experience) · `lineage` · `eggs` · `memories` · `relationships` · `care_events` · `inventory` · `habitats` · `summoned_files` (เก็บเฉพาะ hash) · `reminders` · `calendar_sources` · `discovered_alleles` · `settings` พร้อมเลขเวอร์ชัน schema, migration และไฟล์สำรองหมุนเวียน
