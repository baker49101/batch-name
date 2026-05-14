#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileItem {
    id: String,
    path: String,
    parent_dir: String,
    name: String,
    base_name: String,
    extension: String,
    kind: String,
    size: u64,
    created_at: String,
    modified_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenamePreview {
    id: String,
    original_path: String,
    target_path: String,
    original_name: String,
    target_name: String,
    status: String,
    will_rename: bool,
    message: String,
    warnings: Vec<String>,
    item: FileItem,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameResultItem {
    #[serde(flatten)]
    preview: RenamePreview,
    success: bool,
    error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameExecutionResult {
    batch_id: String,
    executed_at: String,
    items: Vec<RenameResultItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UndoEntry {
    id: String,
    original_path: String,
    target_path: String,
    original_name: String,
    target_name: String,
    success: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UndoRecord {
    batch_id: String,
    executed_at: String,
    entries: Vec<UndoEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UndoResultItem {
    #[serde(flatten)]
    entry: UndoEntry,
    restored: bool,
    error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UndoResult {
    batch_id: String,
    items: Vec<UndoResultItem>,
}

#[tauri::command]
fn scan_paths(paths: Vec<String>, recursive: bool) -> Result<Vec<FileItem>, String> {
    let mut results = Vec::new();
    let mut seen = HashSet::new();

    for input_path in paths {
        collect_path(PathBuf::from(input_path), recursive, &mut results, &mut seen)?;
    }

    Ok(results)
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
fn get_platform() -> &'static str {
    current_platform()
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn execute_rename_previews(
    app: AppHandle,
    previews: Vec<RenamePreview>,
) -> Result<RenameExecutionResult, String> {
    let batch_id = format!("batch-{}", now_millis());
    let executed_at = now_iso();
    let mut items = Vec::new();

    for preview in previews {
        if !preview.will_rename || (preview.status != "ready" && preview.status != "warning") {
            let message = preview.message.clone();
            items.push(RenameResultItem {
                preview,
                success: false,
                error: Some(message),
            });
            continue;
        }

        let original_key = normalize_path_key(&preview.original_path);
        let target_key = normalize_path_key(&preview.target_path);
        if original_key != target_key && Path::new(&preview.target_path).exists() {
            let mut blocked = preview;
            blocked.status = "error".to_string();
            blocked.will_rename = false;
            blocked.message = "磁盘上已经存在同名文件，已阻止覆盖。".to_string();
            items.push(RenameResultItem {
                preview: blocked,
                success: false,
                error: Some("磁盘上已经存在同名文件，已阻止覆盖。".to_string()),
            });
            continue;
        }

        match rename_safely(&preview.original_path, &preview.target_path) {
            Ok(()) => items.push(RenameResultItem {
                preview,
                success: true,
                error: None,
            }),
            Err(error) => items.push(RenameResultItem {
                preview,
                success: false,
                error: Some(error),
            }),
        }
    }

    let record = UndoRecord {
        batch_id: batch_id.clone(),
        executed_at: executed_at.clone(),
        entries: items
            .iter()
            .map(|item| UndoEntry {
                id: item.preview.id.clone(),
                original_path: item.preview.original_path.clone(),
                target_path: item.preview.target_path.clone(),
                original_name: item.preview.original_name.clone(),
                target_name: item.preview.target_name.clone(),
                success: item.success,
            })
            .collect(),
    };

    write_json(&undo_record_path(&app)?, &record)?;
    Ok(RenameExecutionResult {
        batch_id,
        executed_at,
        items,
    })
}

#[tauri::command]
fn undo_last_rename(app: AppHandle) -> Result<Option<UndoResult>, String> {
    let path = undo_record_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }

    let record: UndoRecord = read_json(&path)?;
    let mut items = Vec::new();

    for entry in record.entries.into_iter().filter(|entry| entry.success).rev() {
        match rename_safely(&entry.target_path, &entry.original_path) {
            Ok(()) => items.push(UndoResultItem {
                entry,
                restored: true,
                error: None,
            }),
            Err(error) => items.push(UndoResultItem {
                entry,
                restored: false,
                error: Some(error),
            }),
        }
    }

    Ok(Some(UndoResult {
        batch_id: record.batch_id,
        items,
    }))
}

#[tauri::command]
fn read_recent_rules(app: AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let path = recent_rules_path(&app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    read_json(&path)
}

#[tauri::command]
fn save_recent_rules(app: AppHandle, rules: Vec<serde_json::Value>) -> Result<bool, String> {
    write_json(&recent_rules_path(&app)?, &rules)?;
    Ok(true)
}

fn collect_path(
    input_path: PathBuf,
    recursive: bool,
    results: &mut Vec<FileItem>,
    seen: &mut HashSet<String>,
) -> Result<(), String> {
    let normalized = normalize_path_key(&input_path.to_string_lossy());
    if !seen.insert(normalized) {
        return Ok(());
    }

    let metadata = fs::metadata(&input_path).map_err(|error| error.to_string())?;
    if metadata.is_dir() {
        collect_directory(input_path, recursive, results, seen)?;
    } else {
        results.push(create_file_item(&input_path, &metadata, "file")?);
    }
    Ok(())
}

fn collect_directory(
    dir_path: PathBuf,
    recursive: bool,
    results: &mut Vec<FileItem>,
    seen: &mut HashSet<String>,
) -> Result<(), String> {
    let entries = fs::read_dir(&dir_path)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    if entries.is_empty() {
        let metadata = fs::metadata(&dir_path).map_err(|error| error.to_string())?;
        results.push(create_file_item(&dir_path, &metadata, "directory")?);
        return Ok(());
    }

    for entry in entries {
        let child_path = entry.path();
        let metadata = entry.metadata().map_err(|error| error.to_string())?;
        if metadata.is_dir() {
            results.push(create_file_item(&child_path, &metadata, "directory")?);
            if recursive {
                let normalized = normalize_path_key(&child_path.to_string_lossy());
                if seen.insert(normalized) {
                    collect_directory(child_path, recursive, results, seen)?;
                }
            }
        } else {
            results.push(create_file_item(&child_path, &metadata, "file")?);
        }
    }

    Ok(())
}

fn create_file_item(path: &Path, metadata: &fs::Metadata, kind: &str) -> Result<FileItem, String> {
    let path_string = path.to_string_lossy().to_string();
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_string();
    let (base_name, extension) = split_file_name(&name);

    Ok(FileItem {
        id: file_url_id(&path_string),
        path: path_string,
        parent_dir: path
            .parent()
            .unwrap_or_else(|| Path::new(""))
            .to_string_lossy()
            .to_string(),
        name: name.clone(),
        base_name: if kind == "directory" { name } else { base_name },
        extension: if kind == "directory" {
            String::new()
        } else {
            extension
        },
        kind: kind.to_string(),
        size: metadata.len(),
        created_at: system_time_to_iso(metadata.created().unwrap_or(UNIX_EPOCH)),
        modified_at: system_time_to_iso(metadata.modified().unwrap_or(UNIX_EPOCH)),
    })
}

fn split_file_name(name: &str) -> (String, String) {
    if let Some(dot_index) = name.rfind('.') {
        if dot_index > 0 && dot_index < name.len() - 1 {
            return (name[..dot_index].to_string(), name[dot_index..].to_string());
        }
    }
    (name.to_string(), String::new())
}

fn rename_safely(original_path: &str, target_path: &str) -> Result<(), String> {
    if original_path == target_path {
        return Ok(());
    }

    let original_key = normalize_path_key(original_path);
    let target_key = normalize_path_key(target_path);
    if original_key == target_key {
        let original = Path::new(original_path);
        let file_name = original
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("rename-target");
        let temp_path = original.with_file_name(format!(".__rename_tmp_{}_{}", now_millis(), file_name));
        fs::rename(original_path, &temp_path).map_err(|error| error.to_string())?;
        fs::rename(temp_path, target_path).map_err(|error| error.to_string())?;
        return Ok(());
    }

    fs::rename(original_path, target_path).map_err(|error| error.to_string())
}

fn normalize_path_key(value: &str) -> String {
    let mut normalized = value.replace('\\', "/");
    while normalized.contains("//") {
        normalized = normalized.replace("//", "/");
    }
    normalized.to_lowercase()
}

fn file_url_id(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    if normalized.starts_with('/') {
        format!("file://{}", normalized)
    } else {
        format!("file:///{}", normalized)
    }
}

fn current_platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    }
}

fn undo_record_path(app: &AppHandle) -> Result<PathBuf, String> {
    app_data_file(app, "last-undo.json")
}

fn recent_rules_path(app: &AppHandle) -> Result<PathBuf, String> {
    app_data_file(app, "recent-rules.json")
}

fn app_data_file(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join(name))
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, String> {
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&content).map_err(|error| error.to_string())
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let content = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}

fn system_time_to_iso(time: SystemTime) -> String {
    let datetime: chrono::DateTime<Utc> = time.into();
    datetime.to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            scan_paths,
            path_exists,
            get_platform,
            read_text_file,
            execute_rename_previews,
            undo_last_rename,
            read_recent_rules,
            save_recent_rules
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
