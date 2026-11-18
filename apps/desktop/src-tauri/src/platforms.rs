//! หน้าต่างของโปรแกรมอื่นบนจอ
//!
//! ฝั่ง Rust ทำแค่ "อ่านข้อมูลดิบ": รายการสี่เหลี่ยมของหน้าต่างที่มองเห็น เรียงจากหน้าสุดไปหลังสุด
//! แล้วส่งให้ frontend เป็น event `platforms` — การคำนวณว่าขอบไหนเกาะได้อยู่ฝั่ง TypeScript
//! (`computePerches` ใน packages/core ซึ่งมี unit test)
//!
//! เธรดเดียวกันนี้ยังดูว่ามีแอป/เกมเต็มจออยู่ข้างหน้าหรือไม่ เพื่อซ่อนสัตว์ชั่วคราว

use serde::Serialize;
use tauri::AppHandle;

/// สี่เหลี่ยมของหน้าต่าง หน่วย CSS px เทียบมุมซ้ายบนของหน้าต่าง overlay
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct WindowRect {
    pub id: i64,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// สี่เหลี่ยมในพิกัดจอจริง (physical px): ซ้าย บน ขวา ล่าง
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Bounds {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl Bounds {
    /// คลุมอีกสี่เหลี่ยมหนึ่งทั้งหมด (ใช้ตรวจว่าหน้าต่างเต็มจอ)
    pub fn covers(&self, other: &Bounds) -> bool {
        self.left <= other.left
            && self.top <= other.top
            && self.right >= other.right
            && self.bottom >= other.bottom
    }

    /// แปลงเป็น CSS px เทียบจุดกำเนิดของหน้าต่าง overlay
    pub fn to_css(self, id: i64, origin: (i32, i32), scale: f64) -> WindowRect {
        let scale = if scale > 0.0 { scale } else { 1.0 };
        WindowRect {
            id,
            x: f64::from(self.left - origin.0) / scale,
            y: f64::from(self.top - origin.1) / scale,
            w: f64::from(self.right - self.left) / scale,
            h: f64::from(self.bottom - self.top) / scale,
        }
    }
}

/// หน้าต่างของระบบที่ไม่ใช่ "หน้าต่างโปรแกรม" (พื้น Desktop, Taskbar ฯลฯ) — ไม่ใช้เป็นที่เกาะและไม่นับว่าเต็มจอ
pub fn is_shell_class(class: &str) -> bool {
    matches!(
        class,
        "Progman"
            | "WorkerW"
            | "Shell_TrayWnd"
            | "Shell_SecondaryTrayWnd"
            | "NotifyIconOverflowWindow"
            | "TopLevelWindowForOverflowXamlIsland"
            | "XamlExplorerHostIslandWindow"
            | "Windows.UI.Core.CoreWindow"
            | "ForegroundStaging"
            | "MultitaskingViewFrame"
    )
}

#[cfg(not(windows))]
pub fn spawn(_app: AppHandle) {}

#[cfg(windows)]
pub fn spawn(app: AppHandle) {
    imp::spawn(app);
}

#[cfg(windows)]
mod imp {
    use std::{ffi::c_void, mem, sync::atomic::Ordering, thread, time::Duration};

    use tauri::{AppHandle, Emitter, Manager};
    use windows_sys::Win32::{
        Foundation::{HWND, LPARAM, RECT},
        Graphics::{
            Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS},
            Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST},
        },
        System::Threading::GetCurrentProcessId,
        UI::WindowsAndMessaging::{
            EnumWindows, GetClassNameW, GetForegroundWindow, GetWindowLongW, GetWindowRect,
            GetWindowThreadProcessId, IsIconic, IsWindowVisible, GWL_EXSTYLE, GWL_STYLE,
            WS_CAPTION, WS_EX_TRANSPARENT,
        },
    };

    use super::{is_shell_class, Bounds, WindowRect};
    use crate::OverlayState;

    /// จำนวนหน้าต่างสูงสุดที่ส่งให้ frontend (ที่เหลืออยู่ลึกเกินจะมองเห็น)
    const MAX_WINDOWS: usize = 48;

    struct Raw {
        hwnd: HWND,
        bounds: Bounds,
    }

    fn class_name(hwnd: HWND) -> String {
        let mut buffer = [0u16; 128];
        // SAFETY: buffer ยาว 128 ตัวอักษร และส่งความยาวเดียวกันให้ระบบ
        let len = unsafe { GetClassNameW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32) };
        String::from_utf16_lossy(&buffer[..len.max(0) as usize])
    }

    fn is_own_process(hwnd: HWND) -> bool {
        let mut pid = 0u32;
        // SAFETY: pid ชี้ไปยังตัวแปรบน stack ที่ยังมีชีวิตอยู่
        unsafe {
            GetWindowThreadProcessId(hwnd, &mut pid);
            pid == GetCurrentProcessId()
        }
    }

    /// ขอบที่มองเห็นจริงของหน้าต่าง (ไม่รวมเงา/ขอบล่องหนของ Windows 10/11)
    fn bounds_of(hwnd: HWND) -> Option<Bounds> {
        let mut rect: RECT = unsafe { mem::zeroed() };
        // SAFETY: rect มีขนาดตรงกับที่แจ้ง (size_of::<RECT>())
        let ok = unsafe {
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_EXTENDED_FRAME_BOUNDS as u32,
                (&mut rect as *mut RECT).cast::<c_void>(),
                mem::size_of::<RECT>() as u32,
            ) == 0
                || GetWindowRect(hwnd, &mut rect) != 0
        };
        (ok && rect.right > rect.left && rect.bottom > rect.top).then_some(Bounds {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
        })
    }

    fn is_cloaked(hwnd: HWND) -> bool {
        let mut cloaked = 0u32;
        // SAFETY: cloaked มีขนาด 4 ไบต์ตามที่แจ้ง
        unsafe {
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_CLOAKED as u32,
                (&mut cloaked as *mut u32).cast::<c_void>(),
                mem::size_of::<u32>() as u32,
            ) == 0
                && cloaked != 0
        }
    }

    unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> i32 {
        // SAFETY: lparam คือ pointer ไปยัง Vec<Raw> ที่ `visible_windows` ส่งมาและยังมีชีวิตอยู่ตลอดการเรียก
        let list = unsafe { &mut *(lparam as *mut Vec<Raw>) };
        if list.len() >= MAX_WINDOWS {
            return 0;
        }
        // SAFETY: hwnd มาจาก EnumWindows จึงเป็น handle ที่ใช้ได้ในขณะนี้
        let (visible, minimized, ex_style) = unsafe {
            (
                IsWindowVisible(hwnd) != 0,
                IsIconic(hwnd) != 0,
                GetWindowLongW(hwnd, GWL_EXSTYLE) as u32,
            )
        };
        // ข้าม: ซ่อน/ย่ออยู่, หน้าต่างคลิกทะลุของแอปอื่น (overlay ล่องหน), ของเราเอง, และของระบบ
        if !visible || minimized || ex_style & WS_EX_TRANSPARENT != 0 {
            return 1;
        }
        if is_cloaked(hwnd) || is_own_process(hwnd) || is_shell_class(&class_name(hwnd)) {
            return 1;
        }
        if let Some(bounds) = bounds_of(hwnd) {
            list.push(Raw { hwnd, bounds });
        }
        1
    }

    /// หน้าต่างโปรแกรมที่มองเห็น เรียงจากหน้าสุดไปหลังสุด (EnumWindows คืนตามลำดับซ้อน)
    fn visible_windows() -> Vec<Raw> {
        let mut list: Vec<Raw> = Vec::new();
        // SAFETY: callback ใช้ pointer นี้เฉพาะระหว่างที่ EnumWindows ยังไม่คืนค่า
        unsafe {
            EnumWindows(Some(collect), &mut list as *mut Vec<Raw> as LPARAM);
        }
        list
    }

    /// หน้าต่างที่ผู้ใช้ทำงานอยู่ "เต็มจอจริง" บนจอเดียวกับสัตว์หรือไม่
    /// (ไร้แถบชื่อและคลุมทั้งจอ — หน้าต่างขยายใหญ่ธรรมดาไม่นับ)
    fn fullscreen_app(overlay_origin: (i32, i32)) -> bool {
        // SAFETY: ทุกฟังก์ชันรับ handle ที่ระบบเพิ่งคืนให้ และ struct มีขนาดตามที่ตั้งใน cbSize
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.is_null() || is_own_process(hwnd) || is_shell_class(&class_name(hwnd)) {
                return false;
            }
            if GetWindowLongW(hwnd, GWL_STYLE) as u32 & WS_CAPTION == WS_CAPTION {
                return false;
            }
            let mut info: MONITORINFO = mem::zeroed();
            info.cbSize = mem::size_of::<MONITORINFO>() as u32;
            if GetMonitorInfoW(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), &mut info) == 0 {
                return false;
            }
            let monitor = Bounds {
                left: info.rcMonitor.left,
                top: info.rcMonitor.top,
                right: info.rcMonitor.right,
                bottom: info.rcMonitor.bottom,
            };
            // คนละจอกับสัตว์ → ไม่ต้องซ่อน
            if (monitor.left, monitor.top) != overlay_origin {
                return false;
            }
            bounds_of(hwnd).is_some_and(|bounds| bounds.covers(&monitor))
        }
    }

    pub fn spawn(app: AppHandle) {
        thread::spawn(move || {
            let mut last: Vec<WindowRect> = Vec::new();
            let mut fullscreen_streak = 0u8;
            loop {
                thread::sleep(Duration::from_millis(250));
                let Some(window) = app.get_webview_window("main") else {
                    break;
                };
                let (Ok(origin), Ok(scale)) = (window.outer_position(), window.scale_factor())
                else {
                    continue;
                };
                let origin = (origin.x, origin.y);
                let state = app.state::<OverlayState>();

                // ซ่อนเมื่อมีแอปเต็มจอ (ต้องเห็นติดกัน 2 รอบ กันกะพริบตอนสลับหน้าต่าง) แล้วกลับมาเอง
                let wanted = state.hide_on_fullscreen.load(Ordering::Relaxed);
                fullscreen_streak = if wanted && fullscreen_app(origin) {
                    fullscreen_streak.saturating_add(1)
                } else {
                    0
                };
                let hide = fullscreen_streak >= 2;
                if hide != state.auto_hidden.load(Ordering::Relaxed) {
                    state.auto_hidden.store(hide, Ordering::Relaxed);
                    let _ = if hide {
                        window.hide()
                    } else if state.user_visible.load(Ordering::Relaxed) {
                        window.show()
                    } else {
                        Ok(())
                    };
                }
                if hide {
                    continue;
                }

                let rects: Vec<WindowRect> = visible_windows()
                    .into_iter()
                    .map(|raw| raw.bounds.to_css(raw.hwnd as i64, origin, scale))
                    .collect();
                if rects != last {
                    let _ = app.emit("platforms", &rects);
                    last = rects;
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::{is_shell_class, Bounds};

    const MONITOR: Bounds = Bounds {
        left: 0,
        top: 0,
        right: 1920,
        bottom: 1080,
    };

    #[test]
    fn fullscreen_window_covers_the_monitor_but_a_maximized_one_above_the_taskbar_does_not() {
        assert!(MONITOR.covers(&MONITOR));
        assert!(Bounds {
            left: -8,
            top: -8,
            right: 1928,
            bottom: 1088
        }
        .covers(&MONITOR));
        assert!(!Bounds {
            left: 0,
            top: 0,
            right: 1920,
            bottom: 1032
        }
        .covers(&MONITOR));
        assert!(!Bounds {
            left: 100,
            top: 100,
            right: 900,
            bottom: 700
        }
        .covers(&MONITOR));
    }

    #[test]
    fn converts_physical_pixels_to_overlay_css_pixels() {
        // จอที่สองอยู่ทางขวา (จุดกำเนิด 1920,0) สเกล 150%
        let rect = Bounds {
            left: 2220,
            top: 150,
            right: 3120,
            bottom: 750,
        }
        .to_css(7, (1920, 0), 1.5);
        assert_eq!(
            (rect.id, rect.x, rect.y, rect.w, rect.h),
            (7, 200.0, 100.0, 600.0, 400.0)
        );
        // สเกลผิดปกติ → ถือเป็น 1 ไม่หารด้วยศูนย์
        let same = Bounds {
            left: 10,
            top: 20,
            right: 110,
            bottom: 220,
        }
        .to_css(1, (0, 0), 0.0);
        assert_eq!((same.x, same.y, same.w, same.h), (10.0, 20.0, 100.0, 200.0));
    }

    #[test]
    fn desktop_and_taskbar_are_not_program_windows() {
        assert!(is_shell_class("Progman"));
        assert!(is_shell_class("Shell_TrayWnd"));
        assert!(!is_shell_class("Notepad"));
        assert!(!is_shell_class("Chrome_WidgetWin_1"));
    }
}
