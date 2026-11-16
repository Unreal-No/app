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

/// วงกลมพื้นที่จับต้องได้ หน่วย CSS px เทียบมุมซ้ายบนของหน้าต่าง overlay
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct HitShape {
    pub x: f64,
    pub y: f64,
    pub r: f64,
}

impl HitShape {
    pub fn contains(&self, x: f64, y: f64) -> bool {
        let (dx, dy) = (x - self.x, y - self.y);
        dx * dx + dy * dy <= self.r * self.r
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(OverlayState::default())
        .invoke_handler(tauri::generate_handler![
            set_hit_shapes,
            get_desktop_layout,
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
    fn hit_shape_contains_points_inside_radius_only() {
        let shape = HitShape { x: 100.0, y: 50.0, r: 10.0 };
        assert!(shape.contains(100.0, 50.0));
        assert!(shape.contains(110.0, 50.0));
        assert!(shape.contains(106.0, 58.0));
        assert!(!shape.contains(111.0, 50.0));
        assert!(!shape.contains(108.0, 58.0));
    }
}
