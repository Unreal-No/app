// ไม่เปิดหน้าต่าง console ซ้อนบน Windows ตอน release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    mochimon_desktop_lib::run()
}
