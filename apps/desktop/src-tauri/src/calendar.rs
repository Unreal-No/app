//! ดึงลิงก์ปฏิทินแบบ ICS (Google "ที่อยู่ลับในรูปแบบ iCal", Outlook "เผยแพร่ปฏิทิน")
//!
//! ต้องดึงจากฝั่ง Rust เพราะ WebView ถูกบล็อกด้วย CORS — ส่งข้อความดิบกลับไปให้ TypeScript อ่าน
//! ลิงก์เป็นความลับของผู้ใช้: ใช้แค่ส่งคำขอไปยังโฮสต์ปฏิทินนั้น ไม่บันทึกลง log

use std::{net::IpAddr, time::Duration};

use reqwest::Url;

/// ปฏิทินจริงมีขนาดไม่กี่ร้อย KB — กันไฟล์ผิดปกติ
const MAX_BYTES: usize = 5 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(20);

/// ตรวจและแปลงลิงก์: รับเฉพาะ https:// และ webcal(s):// (แปลงเป็น https) ไปยังโฮสต์บนอินเทอร์เน็ต
pub fn normalize(input: &str) -> Result<Url, String> {
    let trimmed = input.trim();
    let lower = trimmed.to_ascii_lowercase();
    let candidate = if lower.starts_with("webcals://") {
        format!("https://{}", &trimmed["webcals://".len()..])
    } else if lower.starts_with("webcal://") {
        format!("https://{}", &trimmed["webcal://".len()..])
    } else {
        trimmed.to_string()
    };
    let url = Url::parse(&candidate).map_err(|_| "ลิงก์ไม่ถูกต้อง".to_string())?;
    if url.scheme() != "https" {
        return Err("ใช้ได้เฉพาะลิงก์ https:// หรือ webcal://".into());
    }
    let host = url.host_str().unwrap_or_default().trim_matches(['[', ']']);
    if host.is_empty() || host.eq_ignore_ascii_case("localhost") || host.ends_with(".local") {
        return Err("ลิงก์ต้องชี้ไปที่บริการปฏิทินบนอินเทอร์เน็ต".into());
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        let private = match ip {
            IpAddr::V4(v4) => {
                v4.is_private() || v4.is_loopback() || v4.is_link_local() || v4.is_unspecified()
            }
            IpAddr::V6(v6) => {
                v6.is_loopback() || v6.is_unspecified() || (v6.segments()[0] & 0xfe00) == 0xfc00
            }
        };
        if private {
            return Err("ลิงก์ต้องชี้ไปที่บริการปฏิทินบนอินเทอร์เน็ต".into());
        }
    } else if !host.contains('.') {
        return Err("ลิงก์ต้องชี้ไปที่บริการปฏิทินบนอินเทอร์เน็ต".into());
    }
    Ok(url)
}

/// เนื้อหาเป็นปฏิทินจริงไหม (หน้าเข้าสู่ระบบ/หน้าผิดพลาดของเว็บมักเป็น HTML)
pub fn looks_like_calendar(body: &str) -> bool {
    body.trim_start_matches('\u{feff}')
        .trim_start()
        .get(..15)
        .is_some_and(|head| head.eq_ignore_ascii_case("BEGIN:VCALENDAR"))
}

/// ข้อความผิดพลาดที่ผู้ใช้เข้าใจได้จากสถานะ HTTP
pub fn describe_status(status: u16) -> String {
    match status {
        401 | 403 => format!("ปฏิทินไม่อนุญาตให้อ่าน (สถานะ {status}) — ลิงก์อาจถูกรีเซ็ต ลองคัดลอกลิงก์ใหม่"),
        404 | 410 => format!("ไม่พบปฏิทินนี้แล้ว (สถานะ {status}) — ลองคัดลอกลิงก์ใหม่"),
        429 => "ดึงบ่อยเกินไป บริการปฏิทินขอให้รอสักพัก".into(),
        500..=599 => format!("บริการปฏิทินขัดข้องชั่วคราว (สถานะ {status})"),
        _ => format!("ดึงปฏิทินไม่สำเร็จ (สถานะ {status})"),
    }
}

#[tauri::command]
pub async fn fetch_calendar(url: String) -> Result<String, String> {
    let url = normalize(&url)?;
    let client = reqwest::Client::builder()
        .timeout(TIMEOUT)
        .user_agent(concat!("Mochimon/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| "เริ่มการเชื่อมต่อไม่ได้".to_string())?;
    let mut response = client.get(url).send().await.map_err(|e| {
        if e.is_timeout() {
            "เชื่อมต่อนานเกินไป — ตรวจอินเทอร์เน็ตแล้วลองใหม่".to_string()
        } else {
            "เชื่อมต่อบริการปฏิทินไม่ได้ — ตรวจอินเทอร์เน็ตแล้วลองใหม่".to_string()
        }
    })?;
    let status = response.status();
    if !status.is_success() {
        return Err(describe_status(status.as_u16()));
    }
    if response
        .content_length()
        .is_some_and(|len| len as usize > MAX_BYTES)
    {
        return Err("ไฟล์ปฏิทินใหญ่เกินไป".into());
    }
    let mut body: Vec<u8> = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "ดาวน์โหลดปฏิทินไม่ครบ".to_string())?
    {
        body.extend_from_slice(&chunk);
        if body.len() > MAX_BYTES {
            return Err("ไฟล์ปฏิทินใหญ่เกินไป".into());
        }
    }
    let text = String::from_utf8_lossy(&body).into_owned();
    if !looks_like_calendar(&text) {
        return Err(
            "ลิงก์นี้ไม่ใช่ไฟล์ปฏิทิน (ICS) — ใช้ลิงก์ \"ที่อยู่ลับในรูปแบบ iCal\" ของ Google หรือลิงก์ ICS ของ Outlook"
                .into(),
        );
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_https_and_webcal_links() {
        let google = "https://calendar.google.com/calendar/ical/x/private-abc/basic.ics";
        assert_eq!(normalize(google).unwrap().as_str(), google);
        assert_eq!(
            normalize(" webcal://outlook.office365.com/owa/calendar/a/b/calendar.ics ")
                .unwrap()
                .as_str(),
            "https://outlook.office365.com/owa/calendar/a/b/calendar.ics"
        );
        assert_eq!(
            normalize("WEBCALS://p01-caldav.icloud.com/published/2/abc")
                .unwrap()
                .scheme(),
            "https"
        );
    }

    #[test]
    fn rejects_other_schemes_and_local_addresses() {
        for bad in [
            "http://calendar.example.com/a.ics",
            "file:///C:/cal.ics",
            "ftp://example.com/a.ics",
            "https://localhost/a.ics",
            "https://router/a.ics",
            "https://192.168.1.10/a.ics",
            "https://127.0.0.1/a.ics",
            "https://[::1]/a.ics",
            "https://printer.local/a.ics",
            "not a link",
        ] {
            assert!(normalize(bad).is_err(), "{bad} should be rejected");
        }
        assert!(normalize("https://8.8.8.8/a.ics").is_ok());
    }

    #[test]
    fn recognises_calendar_bodies() {
        assert!(looks_like_calendar("BEGIN:VCALENDAR\r\nVERSION:2.0"));
        assert!(looks_like_calendar("\u{feff}  begin:vcalendar\n"));
        assert!(!looks_like_calendar("<!DOCTYPE html><html>Sign in"));
        assert!(!looks_like_calendar(""));
    }

    #[test]
    fn explains_http_errors_in_plain_words() {
        assert!(describe_status(404).contains("ไม่พบ"));
        assert!(describe_status(403).contains("ลิงก์"));
        assert!(describe_status(503).contains("ชั่วคราว"));
    }
}
