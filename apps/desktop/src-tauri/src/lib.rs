//! Mochimon desktop shell
//!
//! หน้าที่ของฝั่ง Rust:
//! - จัดหน้าต่าง overlay โปร่งใสให้คลุมจอหลัก (อยู่บนสุดเสมอ, ไม่แย่ง focus)
//! - สลับ "คลิกทะลุ" ตามตำแหน่งเคอร์เซอร์เทียบกับพื้นที่ที่ frontend แจ้งว่าจับต้องได้
//! - บอกตำแหน่งพื้น (ขอบบน Taskbar) และตำแหน่งเคอร์เซอร์ให้ frontend
//! - เมนู system tray
//! - ไฟล์เซฟในโฟลเดอร์ข้อมูลของแอป (เขียนแบบ atomic + สำเนาสำรองหมุนเวียน)

mod overlay;
mod save;
mod tray;

use std::sync::Mutex;

use serde::Deserialize;
use tauri::{Manager, State, WebviewWindow};

/// พื้นที่จับต้องได้ หน่วย CSS px เทียบมุมซ้ายบนของหน้าต่าง overlay
/// - วงกลม `{x, y, r}`: จุดศูนย์กลาง + รัศมี (ตัวสัตว์)
/// - สี่เหลี่ยม `{x, y, w, h}`: มุมซ้ายบน + ขนาด (แผงดูแล)
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(untagged)]
pub enum HitShape {
    Circle { x: f64, y: f64, r: f64 },
    Rect { x: f64, y: f64, w: f64, h: f64 },
}

impl HitShape {
    pub fn contains(&self, px: f64, py: f64) -> bool {
        match *self {
            Self::Circle { x, y, r } => {
                let (dx, dy) = (px - x, py - y);
                dx * dx + dy * dy <= r * r
            }
            Self::Rect { x, y, w, h } => px >= x && px <= x + w && py >= y && py <= y + h,
        }
    }
}

#[derive(Default)]
pub struct OverlayState {
    pub shapes: Mutex<Vec<HitShape>>,
}

/// frontend เรียกทุกครั้งที่สัตว์/วิดเจ็ตขยับ: นอกพื้นที่เหล่านี้เมาส์จะทะลุไปยังแอปข้างหลัง
#[tauri::command]
fn set_hit_shapes(state: State<'_, OverlayState>, shapes: Vec<HitShape>) {
    if let Ok(mut current) = state.shapes.lock() {
        *current = shapes;
    }
}

#[tauri::command]
fn get_desktop_layout(window: WebviewWindow) -> Result<overlay::DesktopLayout, String> {
    overlay::layout(&window).map_err(|e| e.to_string())
}

/// ให้หน้าต่างรับคีย์บอร์ดชั่วคราว (ตอนพิมพ์ตั้งชื่อสัตว์) แล้วกลับเป็นไม่รับ focus เหมือนเดิม
#[tauri::command]
fn set_keyboard_focus(window: WebviewWindow, on: bool) -> Result<(), String> {
    window.set_focusable(on).map_err(|e| e.to_string())?;
    if on {
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(OverlayState::default())
        .invoke_handler(tauri::generate_handler![
            set_hit_shapes,
            get_desktop_layout,
            set_keyboard_focus,
            save::load_save,
            save::store_save
        ])
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .expect("main window is declared in tauri.conf.json");
            overlay::fit_to_primary_monitor(&window)?;
            // เริ่มต้นแบบคลิกทะลุทั้งจอ จนกว่า frontend จะแจ้งพื้นที่ของสัตว์
            window.set_ignore_cursor_events(true)?;
            window.show()?;
            overlay::spawn_cursor_poll(app.handle().clone());
            tray::build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Mochimon");
}

#[cfg(test)]
mod tests {
    use super::HitShape;

    #[test]
    fn circle_contains_points_inside_radius_only() {
        let shape = HitShape::Circle {
            x: 100.0,
            y: 50.0,
            r: 10.0,
        };
        assert!(shape.contains(100.0, 50.0));
        assert!(shape.contains(110.0, 50.0));
        assert!(shape.contains(106.0, 58.0));
        assert!(!shape.contains(111.0, 50.0));
        assert!(!shape.contains(108.0, 58.0));
    }

    #[test]
    fn rect_contains_points_inside_its_bounds_only() {
        let shape = HitShape::Rect {
            x: 20.0,
            y: 30.0,
            w: 200.0,
            h: 100.0,
        };
        assert!(shape.contains(20.0, 30.0));
        assert!(shape.contains(220.0, 130.0));
        assert!(shape.contains(120.0, 80.0));
        assert!(!shape.contains(19.0, 80.0));
        assert!(!shape.contains(221.0, 80.0));
        assert!(!shape.contains(120.0, 29.0));
        assert!(!shape.contains(120.0, 131.0));
    }

    #[test]
    fn shapes_from_the_frontend_parse_by_their_fields() {
        let shapes: Vec<HitShape> =
            serde_json::from_str(r#"[{"x":1,"y":2,"r":3},{"x":4,"y":5,"w":6,"h":7}]"#).unwrap();
        assert!(matches!(shapes[0], HitShape::Circle { r, .. } if r == 3.0));
        assert!(matches!(shapes[1], HitShape::Rect { w, h, .. } if w == 6.0 && h == 7.0));
        assert!(serde_json::from_str::<HitShape>(r#"{"x":1,"y":2}"#).is_err());
    }
}
