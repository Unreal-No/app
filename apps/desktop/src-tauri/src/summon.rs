//! แท่นอัญเชิญ: อ่าน "ลายนิ้วมือ" ของไฟล์ที่ผู้ใช้ลากมาวางหรือเลือก
//!
//! - คืนแค่ SHA-256 + ขนาด + นามสกุล + อายุไฟล์ — เนื้อหาไฟล์ไม่ถูกเก็บและไม่ถูกส่งออกจากเครื่อง
//! - ไฟล์ใหญ่ (> 32 MB) ใช้ 16 MB แรก + 16 MB สุดท้าย ให้ตรงกับการคำนวณฝั่ง WebView (WebCrypto)
//!   ไฟล์เดียวกันจึงได้ค่าเดียวกันไม่ว่าจะลากวางหรือเลือกจากหน้าต่างเลือกไฟล์
//! - รูปภาพส่งไบต์ให้ WebView ย่อเหลือ 32×32 เพื่อหาสีเด่น (WebView ถอดรหัสรูปเองได้ ไม่ต้องเพิ่มไลบรารี)

use std::{
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::Path,
    time::SystemTime,
};

use serde::Serialize;
use sha2::{Digest, Sha256};

/// ขนาดส่วนหัว/ท้ายที่ใช้กับไฟล์ใหญ่
pub const CHUNK: u64 = 16 * 1024 * 1024;
/// รูปภาพที่ใหญ่กว่านี้ไม่ส่งไบต์ไปหาสี (ยังอัญเชิญได้ แค่ไม่ได้สีจากรูป)
pub const MAX_IMAGE_BYTES: u64 = 25 * 1024 * 1024;
const IMAGE_EXTS: [&str; 7] = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"];

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub hash: String,
    pub size: u64,
    pub ext: String,
    pub age_years: f64,
    /// อ่านสีจากรูปได้ (ส่งไบต์ผ่าน `read_image`)
    pub image: bool,
}

/// นามสกุลไฟล์ตัวเล็ก ไม่มีจุด (ยาวผิดปกติ = ไม่มีนามสกุล)
pub fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .filter(|e| !e.is_empty() && e.len() <= 10 && e.chars().all(|c| c.is_ascii_alphanumeric()))
        .unwrap_or_default()
}

pub fn is_image(ext: &str) -> bool {
    IMAGE_EXTS.contains(&ext)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn feed(hasher: &mut Sha256, reader: &mut impl Read, mut remaining: u64) -> std::io::Result<()> {
    let mut buf = vec![0u8; 256 * 1024];
    while remaining > 0 {
        let want = buf.len().min(remaining as usize);
        let n = reader.read(&mut buf[..want])?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        remaining -= n as u64;
    }
    Ok(())
}

/// SHA-256 แบบเดียวกับฝั่ง WebView: ทั้งไฟล์ หรือหัว+ท้ายถ้าใหญ่กว่า 2×CHUNK
pub fn fingerprint(path: &Path, size: u64) -> std::io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    if size > CHUNK * 2 {
        feed(&mut hasher, &mut file, CHUNK)?;
        file.seek(SeekFrom::Start(size - CHUNK))?;
        feed(&mut hasher, &mut file, CHUNK)?;
    } else {
        feed(&mut hasher, &mut file, size)?;
    }
    Ok(hex(&hasher.finalize()))
}

pub fn inspect(path: &Path, now: SystemTime) -> Result<FileInfo, String> {
    let meta = fs::metadata(path).map_err(|_| "เปิดไฟล์นี้ไม่ได้".to_string())?;
    if meta.is_dir() {
        return Err("ใช้โฟลเดอร์อัญเชิญไม่ได้ — ลองวางไฟล์ทีละไฟล์".into());
    }
    let size = meta.len();
    if size == 0 {
        return Err("ไฟล์นี้ว่างเปล่า ไม่มีพลังพอจะอัญเชิญ".into());
    }
    let age_years = meta
        .modified()
        .ok()
        .and_then(|m| now.duration_since(m).ok())
        .map_or(0.0, |d| d.as_secs_f64() / (365.25 * 24.0 * 3600.0));
    let hash = fingerprint(path, size).map_err(|_| "อ่านไฟล์นี้ไม่ได้".to_string())?;
    let ext = extension(path);
    let image = is_image(&ext) && size <= MAX_IMAGE_BYTES;
    Ok(FileInfo {
        hash,
        size,
        ext,
        age_years,
        image,
    })
}

#[tauri::command]
pub async fn inspect_file(path: String) -> Result<FileInfo, String> {
    tauri::async_runtime::spawn_blocking(move || inspect(Path::new(&path), SystemTime::now()))
        .await
        .map_err(|e| e.to_string())?
}

/// ไบต์ของรูปภาพ (เฉพาะนามสกุลรูปและไม่ใหญ่เกิน) ให้ WebView ย่อเพื่อหาสี
#[tauri::command]
pub async fn read_image(path: String) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = Path::new(&path);
        if !is_image(&extension(path)) {
            return Err("not an image".to_string());
        }
        let meta = fs::metadata(path).map_err(|e| e.to_string())?;
        if !meta.is_file() || meta.len() > MAX_IMAGE_BYTES {
            return Err("image is too large".to_string());
        }
        fs::read(path)
            .map(tauri::ipc::Response::new)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp(name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("mochimon-summon-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        File::create(&path).unwrap().write_all(bytes).unwrap();
        path
    }

    #[test]
    fn hashes_small_files_whole() {
        let path = temp("hello.TXT", b"hello");
        let info = inspect(&path, SystemTime::now()).unwrap();
        assert_eq!(
            info.hash,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
        assert_eq!(info.size, 5);
        assert_eq!(info.ext, "txt");
        assert!(!info.image);
        assert!(info.age_years < 0.01);
    }

    #[test]
    fn large_files_use_head_and_tail() {
        let size = (CHUNK * 2 + 1000) as usize;
        let mut bytes = vec![0u8; size];
        bytes[0] = 1;
        bytes[size - 1] = 2;
        let path = temp("big.bin", &bytes);
        let mut expected = Sha256::new();
        expected.update(&bytes[..CHUNK as usize]);
        expected.update(&bytes[size - CHUNK as usize..]);
        assert_eq!(
            fingerprint(&path, size as u64).unwrap(),
            hex(&expected.finalize())
        );
        // ตรงกลางเปลี่ยน → ค่าเดิม (ไม่ได้อ่านส่วนกลาง)
        bytes[size / 2] = 9;
        let path2 = temp("big2.bin", &bytes);
        assert_eq!(
            fingerprint(&path2, size as u64).unwrap(),
            fingerprint(&path, size as u64).unwrap()
        );
    }

    #[test]
    fn rejects_folders_and_empty_files() {
        let dir = std::env::temp_dir();
        assert!(inspect(&dir, SystemTime::now())
            .unwrap_err()
            .contains("โฟลเดอร์"));
        let empty = temp("empty.png", b"");
        assert!(inspect(&empty, SystemTime::now())
            .unwrap_err()
            .contains("ว่าง"));
        assert!(inspect(Path::new("/no/such/file.png"), SystemTime::now()).is_err());
    }

    #[test]
    fn recognises_extensions() {
        assert_eq!(extension(Path::new("a/b/Photo.JPEG")), "jpeg");
        assert_eq!(extension(Path::new("noext")), "");
        assert_eq!(extension(Path::new("weird.ex t")), "");
        assert_eq!(extension(Path::new("x.verylongextension")), "");
        assert!(is_image("webp"));
        assert!(!is_image("svg"));
        let png = temp("dot.png", &[1, 2, 3]);
        assert!(inspect(&png, SystemTime::now()).unwrap().image);
    }
}
