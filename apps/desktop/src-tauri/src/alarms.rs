//! การแจ้งเตือนนัดที่เชื่อถือได้แม้หน้าต่างสัตว์ถูกซ่อน
//!
//! ปกติ frontend เป็นคนแสดงการเตือน (สัตว์ถือป้ายเดินมา) แต่ตอนหน้าต่างถูกซ่อน
//! (มีแอปเต็มจอ หรือผู้ใช้ปิดการแสดงสัตว์) WebView อาจหยุดวาดและชะลอตัวจับเวลา
//! ฝั่ง Rust จึงถือรายการเวลานัดไว้ และแสดง Windows toast แทนเฉพาะตอนที่หน้าต่างถูกซ่อน

use std::{
    collections::HashSet,
    sync::{atomic::Ordering, Mutex},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::Deserialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_notification::NotificationExt;

use crate::OverlayState;

/// นัดที่ต้องแจ้ง (เวลาเป็น epoch ms เหมือนฝั่ง TypeScript)
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Alarm {
    pub id: String,
    pub at_ms: i64,
    pub title: String,
    pub body: String,
}

impl Alarm {
    /// นัดเดียวกันแต่ถูกเลื่อนเวลา = แจ้งใหม่ได้
    fn key(&self) -> String {
        format!("{}@{}", self.id, self.at_ms)
    }
}

#[derive(Default)]
pub struct AlarmState {
    alarms: Mutex<Vec<Alarm>>,
    fired: Mutex<HashSet<String>>,
}

/// เลยเวลาไปนานกว่านี้ไม่ต้องเด้ง toast แล้ว (เช่น เครื่องหลับข้ามวัน — ป้ายบนจอจะแจ้งแทน)
const STALE_MS: i64 = 12 * 60 * 60 * 1000;

/// นัดที่ถึงเวลาแจ้งตอนนี้และยังไม่เคยแจ้ง
pub fn due<'a>(alarms: &'a [Alarm], fired: &HashSet<String>, now_ms: i64) -> Vec<&'a Alarm> {
    alarms
        .iter()
        .filter(|a| a.at_ms <= now_ms && now_ms - a.at_ms <= STALE_MS && !fired.contains(&a.key()))
        .collect()
}

/// รับรายการใหม่ทั้งชุด: นัดที่เลยเวลาไปแล้วตอนนี้ถือว่าแจ้งแล้ว (frontend แสดงป้ายอยู่) และล้างประวัติที่ไม่ใช้
pub fn replace(state: &AlarmState, alarms: Vec<Alarm>, now_ms: i64) {
    if let (Ok(mut current), Ok(mut fired)) = (state.alarms.lock(), state.fired.lock()) {
        let keys: HashSet<String> = alarms.iter().map(Alarm::key).collect();
        fired.retain(|key| keys.contains(key));
        for alarm in alarms.iter().filter(|a| a.at_ms <= now_ms) {
            fired.insert(alarm.key());
        }
        *current = alarms;
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn set_alarms(state: State<'_, AlarmState>, alarms: Vec<Alarm>) {
    replace(&state, alarms, now_ms());
}

pub fn spawn(app: AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(1));
        let state = app.state::<AlarmState>();
        let now = now_ms();
        let ready: Vec<Alarm> = match (state.alarms.lock(), state.fired.lock()) {
            (Ok(alarms), Ok(mut fired)) => {
                let list: Vec<Alarm> = due(&alarms, &fired, now).into_iter().cloned().collect();
                for alarm in &list {
                    fired.insert(alarm.key());
                }
                list
            }
            _ => continue,
        };
        if ready.is_empty() {
            continue;
        }
        let overlay = app.state::<OverlayState>();
        let hidden = overlay.auto_hidden.load(Ordering::Relaxed)
            || !overlay.user_visible.load(Ordering::Relaxed);
        if !hidden {
            continue;
        }
        for alarm in ready {
            let _ = app
                .notification()
                .builder()
                .title(&alarm.title)
                .body(&alarm.body)
                .show();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn alarm(id: &str, at_ms: i64) -> Alarm {
        Alarm {
            id: id.into(),
            at_ms,
            title: "Mochimon".into(),
            body: id.into(),
        }
    }

    #[test]
    fn fires_each_alarm_once_when_its_time_comes() {
        let state = AlarmState::default();
        replace(&state, vec![alarm("a", 1_000), alarm("b", 5_000)], 0);
        let alarms = state.alarms.lock().unwrap().clone();
        let mut fired = state.fired.lock().unwrap().clone();
        assert!(due(&alarms, &fired, 999).is_empty());
        let now: Vec<&str> = due(&alarms, &fired, 1_000)
            .iter()
            .map(|a| a.id.as_str())
            .collect();
        assert_eq!(now, ["a"]);
        fired.insert(alarms[0].key());
        assert!(due(&alarms, &fired, 2_000).is_empty());
        assert_eq!(due(&alarms, &fired, 6_000).len(), 1);
    }

    #[test]
    fn alarms_already_overdue_when_received_are_not_toasted() {
        let state = AlarmState::default();
        replace(
            &state,
            vec![alarm("late", 1_000), alarm("soon", 9_000)],
            5_000,
        );
        let alarms = state.alarms.lock().unwrap().clone();
        let fired = state.fired.lock().unwrap().clone();
        let ids: Vec<&str> = due(&alarms, &fired, 9_500)
            .iter()
            .map(|a| a.id.as_str())
            .collect();
        assert_eq!(ids, ["soon"]);
    }

    #[test]
    fn snoozed_alarm_fires_again_and_stale_ones_are_skipped() {
        let state = AlarmState::default();
        replace(&state, vec![alarm("a", 1_000)], 0);
        state.fired.lock().unwrap().insert(alarm("a", 1_000).key());
        // เลื่อนไป 5 นาที → รหัสเดิม เวลาใหม่
        replace(&state, vec![alarm("a", 301_000)], 2_000);
        let alarms = state.alarms.lock().unwrap().clone();
        let fired = state.fired.lock().unwrap().clone();
        assert_eq!(due(&alarms, &fired, 301_000).len(), 1);
        assert!(due(&alarms, &fired, 301_000 + STALE_MS + 1).is_empty());
    }
}
