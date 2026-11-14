use std::{thread, time::Duration};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

use crate::OverlayState;

/// พิกัดเป็น CSS px เทียบมุมซ้ายบนของหน้าต่าง overlay
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopLayout {
    pub width: f64,
    pub height: f64,
    /// ระยะจากขอบบนหน้าต่างถึง "พื้น" ที่สัตว์ยืน = ขอบล่างของ work area (ขอบบน Taskbar)
    pub ground_y: f64,
}

#[derive(Debug, Clone, Serialize)]
struct CursorPayload {
    x: f64,
    y: f64,
}

/// ขยายหน้าต่างให้คลุมจอหลักทั้งจอ (รวมพื้นที่ Taskbar เพื่อให้สัตว์ยืนบนขอบ Taskbar ได้)
pub fn fit_to_primary_monitor(window: &WebviewWindow) -> tauri::Result<()> {
    if let Some(monitor) = window.primary_monitor()? {
        let position = monitor.position();
        let size = monitor.size();
        window.set_position(PhysicalPosition::new(position.x, position.y))?;
        // เตี้ยกว่าจอ 1px: หน้าต่างไร้ขอบที่ขนาดเท่าจอพอดีจะถูก Windows มองเป็นแอป fullscreen
        // (ซ่อน Taskbar / ปิดการแจ้งเตือน) ซึ่งเราไม่ต้องการ
        window.set_size(PhysicalSize::new(size.width, size.height.saturating_sub(1)))?;
    }
    Ok(())
}

pub fn layout(window: &WebviewWindow) -> tauri::Result<DesktopLayout> {
    let scale = window.scale_factor()?;
    let size = window.inner_size()?;
    let origin = window.outer_position()?;
    let window_height = f64::from(size.height);
    let ground = match window.primary_monitor()? {
        Some(monitor) => {
            let area = monitor.work_area();
            let bottom = i64::from(area.position.y) + i64::from(area.size.height);
            (bottom - i64::from(origin.y)) as f64
        }
        None => window_height,
    };
    Ok(DesktopLayout {
        width: f64::from(size.width) / scale,
        height: window_height / scale,
        // Taskbar ซ่อนอัตโนมัติ/อยู่ด้านอื่นของจอ → ยืนที่ขอบล่างของหน้าต่างแทน
        ground_y: ground.clamp(0.0, window_height) / scale,
    })
}

/// เธรดเฝ้าเคอร์เซอร์ (~60Hz)
///
/// หน้าต่างที่ตั้ง "ignore cursor events" จะไม่ได้รับ mouse event ใดๆ เลย จึงต้องถามตำแหน่งเคอร์เซอร์
/// จากระบบเอง แล้วสลับโหมด: เคอร์เซอร์อยู่บนสัตว์ → รับเมาส์, อยู่บนพื้นที่ว่าง → คลิกทะลุ
pub fn spawn_cursor_poll(app: AppHandle) {
    thread::spawn(move || {
        let mut interactive = false;
        let mut last = (f64::NAN, f64::NAN);
        let mut tick: u32 = 0;
        loop {
            thread::sleep(Duration::from_millis(16));
            let Some(window) = app.get_webview_window("main") else {
                break;
            };
            if !window.is_visible().unwrap_or(false) {
                continue;
            }
            let (Ok(cursor), Ok(origin), Ok(scale)) = (
                window.cursor_position(),
                window.outer_position(),
                window.scale_factor(),
            ) else {
                continue;
            };
            let x = (cursor.x - f64::from(origin.x)) / scale;
            let y = (cursor.y - f64::from(origin.y)) / scale;

            let hit = app
                .state::<OverlayState>()
                .shapes
                .lock()
                .map(|shapes| shapes.iter().any(|shape| shape.contains(x, y)))
                .unwrap_or(false);
            if hit != interactive && window.set_ignore_cursor_events(!hit).is_ok() {
                interactive = hit;
            }

            // ส่งตำแหน่งให้ frontend ~30Hz เฉพาะตอนที่ขยับ (ใช้ให้สัตว์มองตาม/เดินตาม)
            tick = tick.wrapping_add(1);
            if tick % 2 == 0 && (x, y) != last {
                last = (x, y);
                let _ = app.emit("cursor", CursorPayload { x, y });
            }
        }
    });
}
