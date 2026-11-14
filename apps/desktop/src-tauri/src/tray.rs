use tauri::{
    menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder},
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
    let reroll = MenuItemBuilder::with_id("reroll", "สุ่มสัตว์ตัวใหม่ (ทดลอง)").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "ออกจาก Mochimon").build(app)?;

    let menu = MenuBuilder::new(app)
        .items(&[&call, &feed, &play])
        .separator()
        .items(&[&quiet, &visible])
        .separator()
        .item(&reroll)
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
        id @ ("call" | "feed" | "play" | "reroll") => {
            let _ = app.emit("tray", id);
        }
        _ => {}
    })
    .build(app)?;
    Ok(())
}
