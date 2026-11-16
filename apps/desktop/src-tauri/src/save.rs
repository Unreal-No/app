//! ไฟล์เซฟ: JSON ไฟล์เดียวในโฟลเดอร์ข้อมูลของแอป + สำเนาสำรองหมุนเวียน
//!
//! เป้าหมายคือ "สัตว์ของผู้ใช้ต้องไม่หาย":
//! - เขียนลงไฟล์ชั่วคราวก่อนแล้วค่อยเปลี่ยนชื่อทับ (ไฟดับกลางคันก็ไม่ได้ไฟล์ครึ่งๆ กลางๆ)
//! - เก็บสำเนาสำรอง 3 รุ่น หมุนไม่ถี่กว่าทุก 10 นาที (เซฟถูกเขียนบ่อย ถ้าหมุนทุกครั้งสำเนาจะใหม่เกินไปจนไม่มีประโยชน์)
//! - ตอนโหลด ส่งทุกไฟล์ที่อ่านได้ให้ frontend เลือกอันแรกที่ถูกต้อง

use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

use tauri::{AppHandle, Manager};

const MAIN: &str = "save.json";
const BACKUPS: [&str; 3] = ["save.bak1.json", "save.bak2.json", "save.bak3.json"];
const ROTATE_EVERY: Duration = Duration::from_secs(10 * 60);
/// กันข้อมูลผิดปกติ: เซฟจริงมีขนาดไม่กี่สิบ KB
const MAX_BYTES: usize = 8 * 1024 * 1024;

fn save_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// ควรหมุนสำเนาสำรองไหม: ยังไม่มีสำเนาเลย หรือสำเนาล่าสุดเก่ากว่า `ROTATE_EVERY`
fn backup_is_due(dir: &Path, now: SystemTime) -> bool {
    match fs::metadata(dir.join(BACKUPS[0])).and_then(|meta| meta.modified()) {
        Ok(modified) => now
            .duration_since(modified)
            .map_or(true, |age| age >= ROTATE_EVERY),
        Err(_) => true,
    }
}

/// เขียนเซฟลง `dir` แบบ atomic และหมุนสำเนาสำรองเมื่อถึงเวลา
pub fn write_save(dir: &Path, json: &str, now: SystemTime) -> Result<(), String> {
    if json.len() > MAX_BYTES {
        return Err("save is too large".into());
    }
    // ไม่ยอมเขียนสิ่งที่ไม่ใช่ JSON object ทับเซฟที่ดีอยู่
    match serde_json::from_str::<serde_json::Value>(json) {
        Ok(serde_json::Value::Object(_)) => {}
        Ok(_) => return Err("save must be a JSON object".into()),
        Err(e) => return Err(format!("save is not valid JSON: {e}")),
    }
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;

    let tmp = dir.join("save.json.tmp");
    {
        let mut file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        file.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
    }

    let main = dir.join(MAIN);
    if main.exists() && backup_is_due(dir, now) {
        // bak2 → bak3, bak1 → bak2, ไฟล์หลักปัจจุบัน → bak1 (คัดลอก เพื่อให้ไฟล์หลักยังอยู่จนถูกแทนที่)
        for i in (1..BACKUPS.len()).rev() {
            let from = dir.join(BACKUPS[i - 1]);
            if from.exists() {
                let _ = fs::rename(from, dir.join(BACKUPS[i]));
            }
        }
        let _ = fs::copy(&main, dir.join(BACKUPS[0]));
    }
    fs::rename(&tmp, &main).map_err(|e| e.to_string())
}

/// เนื้อหาของไฟล์เซฟทั้งหมดที่อ่านได้: ไฟล์หลักก่อน แล้วสำเนาสำรองจากใหม่ไปเก่า
pub fn read_saves(dir: &Path) -> Vec<String> {
    std::iter::once(MAIN)
        .chain(BACKUPS)
        .filter_map(|name| fs::read_to_string(dir.join(name)).ok())
        .filter(|text| !text.trim().is_empty())
        .collect()
}

#[tauri::command]
pub fn store_save(app: AppHandle, json: String) -> Result<(), String> {
    write_save(&save_dir(&app)?, &json, SystemTime::now())
}

#[tauri::command]
pub fn load_save(app: AppHandle) -> Result<Vec<String>, String> {
    Ok(read_saves(&save_dir(&app)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// โฟลเดอร์ชั่วคราวเฉพาะของแต่ละ test (ลบเองเมื่อจบ)
    struct TempDir(PathBuf);
    impl TempDir {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir()
                .join(format!("mochimon-save-test-{}-{name}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            Self(dir)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn writes_and_reads_back() {
        let dir = TempDir::new("roundtrip");
        assert!(read_saves(&dir.0).is_empty());
        write_save(&dir.0, r#"{"v":2,"n":1}"#, SystemTime::now()).unwrap();
        assert_eq!(read_saves(&dir.0), vec![r#"{"v":2,"n":1}"#.to_string()]);
        assert!(!dir.0.join("save.json.tmp").exists());
    }

    #[test]
    fn rejects_garbage_without_touching_the_good_save() {
        let dir = TempDir::new("reject");
        write_save(&dir.0, r#"{"v":2}"#, SystemTime::now()).unwrap();
        assert!(write_save(&dir.0, "", SystemTime::now()).is_err());
        assert!(write_save(&dir.0, "{\"v\":2,", SystemTime::now()).is_err());
        assert!(write_save(&dir.0, "[1,2]", SystemTime::now()).is_err());
        assert_eq!(read_saves(&dir.0)[0], r#"{"v":2}"#);
    }

    #[test]
    fn keeps_rotating_backups_newest_first() {
        let dir = TempDir::new("rotate");
        let start = SystemTime::now();
        // เขียน 5 ครั้ง ห่างกันครั้งละ 11 นาที → ทุกครั้งถึงเวลาหมุนสำเนา
        for n in 1..=5u64 {
            let now = start + Duration::from_secs(n * 11 * 60);
            write_save(&dir.0, &format!(r#"{{"n":{n}}}"#), now).unwrap();
        }
        assert_eq!(
            read_saves(&dir.0),
            vec![r#"{"n":5}"#, r#"{"n":4}"#, r#"{"n":3}"#, r#"{"n":2}"#]
        );
    }

    #[test]
    fn frequent_writes_do_not_churn_backups() {
        let dir = TempDir::new("churn");
        let now = SystemTime::now();
        write_save(&dir.0, r#"{"n":1}"#, now).unwrap();
        // ครั้งที่ 2: ยังไม่มีสำเนา → สำรองรุ่นที่ 1 ไว้
        write_save(&dir.0, r#"{"n":2}"#, now).unwrap();
        // ครั้งถัดๆ ไปภายใน 10 นาที: ไม่หมุน สำเนายังเป็นรุ่นที่ 1
        write_save(&dir.0, r#"{"n":3}"#, now + Duration::from_secs(20)).unwrap();
        write_save(&dir.0, r#"{"n":4}"#, now + Duration::from_secs(40)).unwrap();
        assert_eq!(read_saves(&dir.0), vec![r#"{"n":4}"#, r#"{"n":1}"#]);
    }

    #[test]
    fn unreadable_main_file_falls_back_to_backups() {
        let dir = TempDir::new("fallback");
        let now = SystemTime::now();
        write_save(&dir.0, r#"{"n":1}"#, now).unwrap();
        write_save(&dir.0, r#"{"n":2}"#, now).unwrap();
        fs::write(dir.0.join(MAIN), "").unwrap();
        assert_eq!(read_saves(&dir.0), vec![r#"{"n":1}"#]);
    }
}
