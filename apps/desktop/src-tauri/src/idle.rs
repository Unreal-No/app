//! เวลาตั้งแต่ผู้ใช้แตะเมาส์หรือคีย์บอร์ดครั้งล่าสุด
//!
//! ใช้ `GetLastInputInfo` ซึ่งบอกแค่ "เวลา" ของ input ล่าสุด — ไม่มี keyboard hook และไม่รู้ว่ากดปุ่มอะไร

/// มิลลิวินาทีที่ผ่านไประหว่างตัวนับของระบบสองค่า (ตัวนับ 32 บิตวนกลับทุก ~49.7 วัน)
pub fn elapsed_ms(now_tick: u32, last_input_tick: u32) -> u32 {
    now_tick.wrapping_sub(last_input_tick)
}

/// วินาทีตั้งแต่ input ล่าสุด (`None` = ระบบนี้ไม่รองรับ ให้ frontend ใช้วิธีของตัวเอง)
#[tauri::command]
pub fn idle_seconds() -> Option<f64> {
    read().map(|ms| f64::from(ms) / 1000.0)
}

#[cfg(windows)]
fn read() -> Option<u32> {
    use windows_sys::Win32::{
        System::SystemInformation::GetTickCount,
        UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO},
    };
    let mut info = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    // SAFETY: info เป็น struct บน stack ที่ตั้ง cbSize ถูกต้องตามที่ API ต้องการ
    let ok = unsafe { GetLastInputInfo(&mut info) } != 0;
    // SAFETY: GetTickCount ไม่รับพารามิเตอร์และไม่มีเงื่อนไขพิเศษ
    ok.then(|| elapsed_ms(unsafe { GetTickCount() }, info.dwTime))
}

#[cfg(not(windows))]
fn read() -> Option<u32> {
    None
}

#[cfg(test)]
mod tests {
    use super::elapsed_ms;

    #[test]
    fn handles_the_tick_counter_wrapping_around() {
        assert_eq!(elapsed_ms(5_000, 2_000), 3_000);
        assert_eq!(elapsed_ms(1_000, u32::MAX - 999), 2_000);
        assert_eq!(elapsed_ms(7, 7), 0);
    }
}
