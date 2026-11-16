use tauri::{
    menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    tray::TrayIconBuilder,
    App, Emitter, Manager,
};

/// เมนู system tray: ทางเข้าหลักของแอป (หน้าต่าง overlay ไม่มีปุ่ม/ขอบ และไม่อยู่บน Taskbar)
pub fn build(app: &App) -> tauri::Result<()> {
    let call = MenuItemBuilder::with_id("call", "เรียกมาหา").build(app)?;
    let feed = MenuItemBuilder::with_id("feed", "ให้อาหาร").build(app)?;
    let play = MenuItemBuilder::with_id("play", "เล่นด้วยกัน").build(app)?;
    let quiet = CheckMenuItemBuilder::with_id("quiet", "โหมดเงียบ (ไม่รบกวน)")
        .checked(false)
        .build(app)?;
    let visible = CheckMenuItemBuilder::with_id("visible", "แสดงสัตว์เลี้ยง")
        .checked(true)
        .build(app)?;
    let reroll = MenuItemBuilder::with_id("reroll", "รับไข่ใบใหม่").build(app)?;
    let recall = MenuItemBuilder::with_id("farm-recall", "เรียกกลับจากฟาร์ม").build(app)?;

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
        .items(&[&call, &feed, &play])
        .separator()
        .items(&[&quiet, &visible])
        .item(&habitat)
        .separator()
        .items(&[&reroll, &recall])
        .separator()
        .item(&quit)
        .build()?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Mochimon")
        .menu(&menu)
        .show_menu_on_left_click(true);
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.on_menu_event(move |app, event| match event.id().as_ref() {
        "quit" => app.exit(0),
        "quiet" => {
            let on = quiet.is_checked().unwrap_or(false);
            let _ = app.emit("tray", if on { "quiet-on" } else { "quiet-off" });
        }
        "visible" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = if visible.is_checked().unwrap_or(true) {
                    window.show()
                } else {
                    window.hide()
                };
            }
        }
        id @ ("call" | "feed" | "play" | "reroll" | "farm-recall") => {
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
