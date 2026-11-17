//! คุยกับสัตว์ด้วย AI
//!
//! - API key ของ Anthropic เก็บใน Windows Credential Manager (ไม่อยู่ในไฟล์เซฟ ไม่ส่งกลับไปหน้าจอ)
//! - คำขอไปยัง Messages API ส่งจากฝั่ง Rust เพื่อให้ key อยู่ฝั่งนี้เท่านั้น; frontend สร้างเนื้อหาคำขอเอง
//! - Ollama ต่อได้เฉพาะเครื่องนี้ (localhost)

use std::time::Duration;

use reqwest::Url;
use serde_json::Value;

const SERVICE: &str = "app.mochimon.desktop";
const ACCOUNT: &str = "anthropic-api-key";
const API_URL: &str = "https://api.anthropic.com/v1/messages";
const API_VERSION: &str = "2026-10-21";
/// beta ที่ frontend ขอเปิดได้ (กันการส่งค่าแปลกๆ ไปกับ key ของผู้ใช้)
const ALLOWED_BETAS: [&str; 1] = ["server-side-fallback-2026-07-01"];
const MAX_BODY: usize = 512 * 1024;
const TIMEOUT: Duration = Duration::from_secs(120);

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|_| "เข้าถึงที่เก็บรหัสของ Windows ไม่ได้".to_string())
}

/// ตรวจรูปแบบ API key แบบหยาบๆ ก่อนเก็บ (key จริงตรวจตอนใช้ครั้งแรก)
pub fn validate_key(input: &str) -> Result<String, String> {
    let key = input.trim();
    if !key.starts_with("sk-ant-")
        || key.len() < 20
        || key.len() > 300
        || key.chars().any(char::is_whitespace)
    {
        return Err("API key ของ Anthropic ขึ้นต้นด้วย sk-ant- — ลองคัดลอกใหม่จาก Claude Console".into());
    }
    Ok(key.to_string())
}

#[tauri::command]
pub fn set_api_key(key: String) -> Result<(), String> {
    let key = validate_key(&key)?;
    entry()?
        .set_password(&key)
        .map_err(|_| "บันทึก API key ลงที่เก็บรหัสของ Windows ไม่สำเร็จ".to_string())
}

#[tauri::command]
pub fn has_api_key() -> bool {
    entry().is_ok_and(|e| e.get_password().is_ok())
}

#[tauri::command]
pub fn clear_api_key() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("ลบ API key ไม่สำเร็จ".into()),
    }
}

/// ข้อความผิดพลาดที่ผู้ใช้เข้าใจได้ จากสถานะ HTTP และเนื้อหาที่ API ตอบมา
pub fn describe_api_error(status: u16, body: &str) -> String {
    let parsed: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let kind = parsed["error"]["type"].as_str().unwrap_or_default();
    let message: String = parsed["error"]["message"]
        .as_str()
        .unwrap_or_default()
        .chars()
        .take(160)
        .collect();
    match (status, kind) {
        (401, _) => "API key ไม่ถูกต้องหรือถูกยกเลิกแล้ว — ใส่ใหม่ในการตั้งค่าแชต".into(),
        (402, _) | (_, "billing_error") => "บัญชี Anthropic มีปัญหาเรื่องการชำระเงินหรือเครดิต".into(),
        (403, _) => "API key นี้ไม่มีสิทธิ์ใช้รุ่นที่เลือก".into(),
        (404, _) => "ไม่พบรุ่นที่เลือก — ลองเปลี่ยนรุ่นในการตั้งค่าแชต".into(),
        (413, _) => "ข้อความยาวเกินไป".into(),
        (429, _) => "ใช้งานถี่เกินไปหรือถึงวงเงินที่ตั้งไว้ — รอสักครู่แล้วลองใหม่".into(),
        (529, _) => "ตอนนี้ระบบของ Anthropic ไม่ว่าง — ลองใหม่อีกครั้ง".into(),
        (500..=599, _) => "ระบบของ Anthropic ขัดข้องชั่วคราว — ลองใหม่อีกครั้ง".into(),
        _ if !message.is_empty() => format!("คำขอไม่สำเร็จ (สถานะ {status}): {message}"),
        _ => format!("คำขอไม่สำเร็จ (สถานะ {status})"),
    }
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(TIMEOUT)
        .build()
        .map_err(|_| "เริ่มการเชื่อมต่อไม่ได้".to_string())
}

/// ส่งคำขอไปยัง Messages API ด้วย key ที่เก็บไว้ — คืนเนื้อหาคำตอบทั้งก้อน (JSON)
#[tauri::command]
pub async fn claude_messages(body: Value, betas: Vec<String>) -> Result<Value, String> {
    let key = match entry()?.get_password() {
        Ok(key) => key,
        Err(_) => return Err("ยังไม่ได้ใส่ API key — เปิดการตั้งค่าแชตแล้วใส่ key ก่อน".into()),
    };
    if !body.is_object() {
        return Err("คำขอไม่ถูกต้อง".into());
    }
    if serde_json::to_vec(&body).map_or(true, |bytes| bytes.len() > MAX_BODY) {
        return Err("ข้อความยาวเกินไป".into());
    }
    let mut request = client()?
        .post(API_URL)
        .header("x-api-key", key)
        .header("anthropic-version", API_VERSION)
        .header("content-type", "application/json")
        .json(&body);
    let betas: Vec<&str> = betas
        .iter()
        .map(String::as_str)
        .filter(|b| ALLOWED_BETAS.contains(b))
        .collect();
    if !betas.is_empty() {
        request = request.header("anthropic-beta", betas.join(","));
    }
    let response = request.send().await.map_err(|e| {
        if e.is_timeout() {
            "รอคำตอบนานเกินไป — ลองใหม่อีกครั้ง".to_string()
        } else {
            "เชื่อมต่อ Anthropic ไม่ได้ — ตรวจอินเทอร์เน็ตแล้วลองใหม่".to_string()
        }
    })?;
    let status = response.status().as_u16();
    let text = response
        .text()
        .await
        .map_err(|_| "อ่านคำตอบไม่ครบ".to_string())?;
    if !(200..300).contains(&status) {
        return Err(describe_api_error(status, &text));
    }
    serde_json::from_str(&text).map_err(|_| "อ่านคำตอบไม่ได้".to_string())
}

/// ที่อยู่ Ollama ต้องเป็นเครื่องนี้เท่านั้น
pub fn ollama_endpoint(base: &str) -> Result<Url, String> {
    let url = Url::parse(base.trim()).map_err(|_| "ที่อยู่ Ollama ไม่ถูกต้อง".to_string())?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1"));
    if url.scheme() != "http" || !local {
        return Err("ต่อ Ollama ได้เฉพาะในเครื่องนี้ (http://localhost:11434)".into());
    }
    url.join("/api/chat")
        .map_err(|_| "ที่อยู่ Ollama ไม่ถูกต้อง".to_string())
}

/// คุยผ่านโมเดลในเครื่อง (Ollama) — ไม่มีข้อมูลออกจากเครื่อง
#[tauri::command]
pub async fn ollama_chat(base_url: String, body: Value) -> Result<Value, String> {
    let endpoint = ollama_endpoint(&base_url)?;
    let response = client()?
        .post(endpoint)
        .json(&body)
        .send()
        .await
        .map_err(|_| "ต่อ Ollama ในเครื่องไม่ได้ — เปิดโปรแกรม Ollama แล้วลองใหม่".to_string())?;
    let status = response.status().as_u16();
    let text = response
        .text()
        .await
        .map_err(|_| "อ่านคำตอบไม่ครบ".to_string())?;
    match status {
        200..=299 => serde_json::from_str(&text).map_err(|_| "อ่านคำตอบไม่ได้".to_string()),
        404 => Err("ไม่พบรุ่นนี้ใน Ollama — ลองสั่ง ollama pull ก่อน".into()),
        _ => Err(format!("Ollama ตอบผิดพลาด (สถานะ {status})")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checks_the_shape_of_an_api_key() {
        assert_eq!(
            validate_key("  sk-ant-api03-abcdefghijklmnop  ").unwrap(),
            "sk-ant-api03-abcdefghijklmnop"
        );
        assert!(validate_key("sk-proj-abcdefghijklmnopqrstu").is_err());
        assert!(validate_key("sk-ant-short").is_err());
        assert!(validate_key("sk-ant-api03 abc defghijklmnop").is_err());
    }

    #[test]
    fn explains_api_errors_in_plain_words() {
        assert!(describe_api_error(401, "").contains("API key"));
        assert!(describe_api_error(429, "").contains("รอสักครู่"));
        assert!(describe_api_error(529, "").contains("ไม่ว่าง"));
        assert!(describe_api_error(404, "").contains("รุ่น"));
        let body = r#"{"type":"error","error":{"type":"invalid_request_error","message":"messages: roles must alternate"}}"#;
        assert!(describe_api_error(400, body).contains("roles must alternate"));
        let billing = r#"{"type":"error","error":{"type":"billing_error","message":"x"}}"#;
        assert!(describe_api_error(400, billing).contains("ชำระเงิน"));
    }

    #[test]
    fn ollama_only_on_this_machine() {
        assert_eq!(
            ollama_endpoint("http://localhost:11434").unwrap().as_str(),
            "http://localhost:11434/api/chat"
        );
        assert_eq!(
            ollama_endpoint("http://127.0.0.1:11500/").unwrap().as_str(),
            "http://127.0.0.1:11500/api/chat"
        );
        assert!(ollama_endpoint("http://192.168.1.5:11434").is_err());
        assert!(ollama_endpoint("https://example.com").is_err());
        assert!(ollama_endpoint("nope").is_err());
    }
}
