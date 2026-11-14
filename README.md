# Mochimon — Desktop Hybrid Virtual Pet

สัตว์เลี้ยงเสมือนที่อาศัยอยู่บนหน้าจอ Desktop ของคุณ (แนว Tamagotchi × Monster Farm, **ไม่มีการต่อสู้**)
เน้นความน่ารัก การเลี้ยงดู การผสมพันธุ์ข้ามสายพันธุ์ และการเป็นเพื่อนที่มีประโยชน์จริงระหว่างทำงาน

> สถานะ: **ต้นแบบระยะแรก (M0)** — แกนยีนส์/การจำลองและ Creature Lab ใช้งานได้
> แอป Desktop (Tauri) ยังต้องทดสอบบน Windows จริง ดู [docs/ROADMAP.md](docs/ROADMAP.md)

## โครงสร้าง

| โฟลเดอร์             | เนื้อหา                                                                             |
| ------------------- | --------------------------------------------------------------------------------- |
| `packages/data`     | Gene DB: locus, allele, สายพันธุ์ตั้งต้น (JSON + ตรวจด้วย zod)                           |
| `packages/core`     | แกนเกม TypeScript ล้วน: ยีนส์ ผสมพันธุ์ กลายพันธุ์ อัญเชิญจากไฟล์ รูปร่าง อารมณ์ นิสัย Behavior AI |
| `packages/creature` | ตัวสร้างสัตว์ 3D แบบ procedural ด้วย three.js (ผิวตุ๊กตา ขนฟู ใบหน้า ท่าทาง)                 |
| `apps/lab`          | Creature Lab — หน้าเว็บสำหรับดู/ผสม/อัญเชิญสัตว์ ใช้ปรับหน้าตาและทดสอบ                       |
| `apps/desktop`      | แอป Desktop (Tauri 2): หน้าต่างโปร่งใส อยู่บนสุด คลิกทะลุ สัตว์เดินบน Taskbar                |
| `docs`              | เอกสารออกแบบ                                                                      |

## เริ่มใช้งาน

ต้องมี Node 22+ และ pnpm 10+

```bash
pnpm install
pnpm test          # unit test ของแกนเกม
pnpm typecheck
pnpm lab           # เปิด Creature Lab ที่ http://localhost:5173
```

แอป Desktop (ต้องมี Rust และ Windows 10/11 ที่มี WebView2):

```bash
pnpm desktop        # โหมดพัฒนา
pnpm desktop:build  # สร้างตัวติดตั้ง
```

ฉาก overlay เปิดในเบราว์เซอร์ธรรมดาได้ด้วย `pnpm --filter @mochimon/desktop dev` (พอร์ต 1420)
โดยจะใช้ค่าจำลองแทนส่วนที่ต้องพึ่ง Windows

## เอกสาร

- [GDD — ภาพรวมเกม](docs/GDD.md)
- [Tech Stack — เหตุผลการเลือกเทคโนโลยี](docs/TECH_STACK.md)
- [Architecture — โครงสร้างระบบ](docs/ARCHITECTURE.md)
- [Genetics — ระบบยีนส์และการผสมพันธุ์](docs/GENETICS.md)
- [Emotion & AI — อารมณ์ นิสัย พฤติกรรม](docs/EMOTION_AI.md)
- [Companion — ฟีเจอร์ผู้ช่วย](docs/COMPANION.md)
- [Art Direction — แนวทางศิลป์](docs/ART_DIRECTION.md)
- [Roadmap](docs/ROADMAP.md)
