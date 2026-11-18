//! ชุดชิ้นส่วน 3D (.glb) ที่ผู้ใช้นำเข้า: เก็บสำเนาไว้ในโฟลเดอร์ข้อมูลของแอป ให้เปิดครั้งหน้ายังใช้อยู่
//!
//! ไฟล์ถูกส่งมาเป็นไบต์ดิบ (ไม่แปลงเป็น JSON) ตรวจแค่ว่าเป็น glTF แบบไฟล์เดียวและไม่ใหญ่เกิน
//! การอ่าน/ตรวจรูปทรงจริงทำฝั่ง WebView ด้วย three.js

use std::{fs, io::Write, path::Path};

use tauri::{ipc::InvokeBody, AppHandle, Manager};

const FILE: &str = "parts.glb";
pub const MAX_BYTES: usize = 20 * 1024 * 1024;

/// ตรวจว่าเป็นไฟล์ .glb (ขึ้นต้นด้วย "glTF") และขนาดพอดี
pub fn validate(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > MAX_BYTES {
        return Err("ไฟล์ใหญ่เกิน 20 MB".into());
    }
    if bytes.len() < 12 || &bytes[..4] != b"glTF" {
        return Err("ต้องเป็นไฟล์ .glb (glTF แบบไฟล์เดียว)".into());
    }
    Ok(())
}

/// เขียนแบบ atomic: ไฟล์ชั่วคราวก่อนแล้วค่อยเปลี่ยนชื่อทับ
pub fn write_pack(dir: &Path, bytes: &[u8]) -> Result<(), String> {
    validate(bytes)?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join("parts.glb.tmp");
    {
        let mut file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        file.write_all(bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, dir.join(FILE)).map_err(|e| e.to_string())
}

fn data_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn store_part_pack(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    match request.body() {
        InvokeBody::Raw(bytes) => write_pack(&data_dir(&app)?, bytes),
        InvokeBody::Json(_) => Err("expected raw bytes".into()),
    }
}

/// ไบต์ของชุดที่เก็บไว้ (ไม่มี → error "none")
#[tauri::command]
pub fn load_part_pack(app: AppHandle) -> Result<tauri::ipc::Response, String> {
    let path = data_dir(&app)?.join(FILE);
    let bytes = fs::read(path).map_err(|_| "none".to_string())?;
    validate(&bytes)?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub fn clear_part_pack(app: AppHandle) -> Result<(), String> {
    let path = data_dir(&app)?.join(FILE);
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn glb(len: usize) -> Vec<u8> {
        let mut bytes = b"glTF".to_vec();
        bytes.resize(len, 0);
        bytes
    }

    #[test]
    fn accepts_only_glb_within_the_size_limit() {
        assert!(validate(&glb(100)).is_ok());
        assert!(validate(b"PK\x03\x04 not a glb").is_err());
        assert!(validate(b"glTF").is_err());
        assert!(validate(&glb(MAX_BYTES + 1)).unwrap_err().contains("20 MB"));
    }

    #[test]
    fn writes_and_replaces_the_pack() {
        let dir = std::env::temp_dir().join(format!("mochimon-parts-{}", std::process::id()));
        write_pack(&dir, &glb(50)).unwrap();
        write_pack(&dir, &glb(80)).unwrap();
        assert_eq!(fs::read(dir.join(FILE)).unwrap().len(), 80);
        assert!(write_pack(&dir, b"nope").is_err());
        assert_eq!(fs::read(dir.join(FILE)).unwrap().len(), 80);
    }
}
