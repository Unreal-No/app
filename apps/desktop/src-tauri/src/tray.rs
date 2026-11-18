use std::sync::atomic::Ordering;

use tauri::{
    menu::{CheckMenuItem, CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    tray::TrayIconBuilder,
    App, Emitter, Manager, Wry,
};
use tauri_plugin_autostart::ManagerExt;

use crate::{MenuState, OverlayState};

/// รายการแบบติ๊กถูกที่ต้องตั้งค่าจากเซฟตอนเริ่มแอป
pub struct TrayItems {
    quiet: CheckMenuItem<Wry>,
    perching: CheckMenuItem<Wry>,
    hide_on_fullscreen: CheckMenuItem<Wry>,
    daylight: CheckMenuItem<Wry>,
}

impl TrayItems {
    pub fn apply(&self, menu: MenuState) {
        let _ = self.quiet.set_checked(menu.quiet);
        let _ = self.perching.set_checked(menu.perching);
        let _ = self.hide_on_fullscreen.set_checked(menu.hide_on_fullscreen);
        let _ = self.daylight.set_checked(menu.daylight);
    }
}

/// เมนู system tray: ทางเข้าหลักของแอป (หน้าต่าง overlay ไม่มีปุ่ม/ขอบ และไม่อยู่บน Taskbar)
pub fn build(app: &App) -> tauri::Result<()> {
    let call = MenuItemBuilder::with_id("call", "เรียกมาหา").build(app)?;
    let feed = MenuItemBuilder::with_id("feed", "ให้อาหาร").build(app)?;
    let play = MenuItemBuilder::with_id("play", "เล่นด้วยกัน").build(app)?;
    // ทางเข้าแผงดูแลอีกทาง (ปกติคลิกขวาที่ตัวสัตว์)
    let panel = MenuItemBuilder::with_id("panel", "เปิดแผงดูแล (ตัวถัดไป)").build(app)?;
    let assistant =
        MenuItemBuilder::with_id("assistant", "ผู้ช่วย: เตือน · งาน · โฟกัส · สุขภาพ").build(app)?;
    let focus = MenuItemBuilder::with_id("focus-start", "เริ่มโฟกัส").build(app)?;
    let chat = MenuItemBuilder::with_id("chat", "คุยกับสัตว์").build(app)?;
    let quiet = CheckMenuItemBuilder::with_id("quiet", "โหมดเงียบ (ไม่รบกวน)")
        .checked(false)
        .build(app)?;
    let visible = CheckMenuItemBuilder::with_id("visible", "แสดงสัตว์เลี้ยง")
        .checked(true)
        .build(app)?;
    let perching = CheckMenuItemBuilder::with_id("perching", "เกาะขอบหน้าต่างโปรแกรมอื่น")
        .checked(true)
        .build(app)?;
    let hide_on_fullscreen = CheckMenuItemBuilder::with_id("fshide", "ซ่อนเมื่อมีแอป/เกมเต็มจอ")
        .checked(true)
        .build(app)?;
    let daylight = CheckMenuItemBuilder::with_id("daylight", "แสงและบรรยากาศตามเวลาจริง")
        .checked(true)
        .build(app)?;
    let autostart = CheckMenuItemBuilder::with_id("autostart", "เปิดพร้อม Windows")
        .checked(app.autolaunch().is_enabled().unwrap_or(false))
        .build(app)?;
    let reroll = MenuItemBuilder::with_id("reroll", "รับไข่ใบใหม่").build(app)?;
    let summon = MenuItemBuilder::with_id("summon", "อัญเชิญจากไฟล์…").build(app)?;
    let book = MenuItemBuilder::with_id("book", "สมุดฟาร์ม (ฟาร์ม · เครือญาติ · สมุดสะสม)").build(app)?;

    // โหมดฉากหลัง: กลมกลืน (ไม่มีฉาก) หรือมุมพักผ่อนพร้อมไดโอรามา
    let habitat = SubmenuBuilder::new(app, "ฉากมุมพักผ่อน")
        .text("habitat-none", "ไม่มีฉาก (โหมดกลมกลืน)")
        .separator()
        .text("habitat-meadow", "ทุ่งหญ้า")
        .text("habitat-cloud", "เกาะเมฆ")
        .text("habitat-underwater", "ใต้น้ำ")
        .text("habitat-snow", "หิมะ")
        .build()?;
    let quit = MenuItemBuilder::with_id("quit", "ออกจาก Mochimon").build(app)?;

    let menu = MenuBuilder::new(app)
        .items(&[&chat, &assistant, &focus])
        .separator()
        .items(&[&call, &feed, &play, &panel])
        .separator()
        .items(&[&summon, &book, &reroll])
        .separator()
        .items(&[&quiet, &visible, &perching, &hide_on_fullscreen, &daylight])
        .item(&habitat)
        .separator()
        .item(&autostart)
        .item(&quit)
        .build()?;

    app.manage(TrayItems {
        quiet: quiet.clone(),
        perching: perching.clone(),
        hide_on_fullscreen: hide_on_fullscreen.clone(),
        daylight: daylight.clone(),
    });

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Mochimon")
        .menu(&menu)
        .show_menu_on_left_click(true);
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.on_menu_event(move |app, event| match event.id().as_ref() {
        "quit" => {
            // ให้ frontend เซฟลงไฟล์ก่อน แล้วมันจะเรียก quit_now เอง — ถ้าไม่ตอบใน 2 วินาทีก็ปิดเลย
            let _ = app.emit("tray", "quit");
            let handle = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(2));
                handle.exit(0);
            });
        }
        "quiet" => {
            let on = quiet.is_checked().unwrap_or(false);
            let _ = app.emit("tray", if on { "quiet-on" } else { "quiet-off" });
        }
        "perching" => {
            let on = perching.is_checked().unwrap_or(true);
            let _ = app.emit("tray", if on { "perch-on" } else { "perch-off" });
        }
        "fshide" => {
            let on = hide_on_fullscreen.is_checked().unwrap_or(true);
            app.state::<OverlayState>()
                .hide_on_fullscreen
                .store(on, Ordering::Relaxed);
            let _ = app.emit("tray", if on { "fshide-on" } else { "fshide-off" });
        }
        "daylight" => {
            let on = daylight.is_checked().unwrap_or(true);
            let _ = app.emit("tray", if on { "daylight-on" } else { "daylight-off" });
        }
        "autostart" => {
            let launcher = app.autolaunch();
            let wanted = autostart.is_checked().unwrap_or(false);
            let result = if wanted {
                launcher.enable()
            } else {
                launcher.disable()
            };
            // ตั้งไม่สำเร็จ → ให้เครื่องหมายถูกตรงกับสถานะจริง
            if result.is_err() {
                let _ = autostart.set_checked(launcher.is_enabled().unwrap_or(false));
            }
        }
        "visible" => {
            let show = visible.is_checked().unwrap_or(true);
            let state = app.state::<OverlayState>();
            state.user_visible.store(show, Ordering::Relaxed);
            // ถ้ากำลังถูกซ่อนเพราะแอปเต็มจอ ปล่อยให้เธรดเบื้องหลังเป็นคนแสดงกลับเอง
            if let Some(window) = app.get_webview_window("main") {
                let _ = if !show {
                    window.hide()
                } else if !state.auto_hidden.load(Ordering::Relaxed) {
                    window.show()
                } else {
                    Ok(())
                };
            }
        }
        id @ ("call" | "feed" | "play" | "panel" | "reroll" | "summon" | "book" | "assistant"
        | "chat" | "focus-start") => {
            let _ = app.emit("tray", id);
        }
        id if id.starts_with("habitat-") => {
            let _ = app.emit("tray", id);
        }
        _ => {}
    })
    .build(app)?;
    Ok(())
}
