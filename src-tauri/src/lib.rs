pub mod library;

use std::{path::Path, sync::Mutex};

use library::{Library, StockItemDto};
use serde::Deserialize;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

type LibraryState = Mutex<Library>;

fn lock_library<'a>(
    state: &'a tauri::State<'a, LibraryState>,
) -> Result<std::sync::MutexGuard<'a, Library>, String> {
    state
        .lock()
        .map_err(|_| "library state lock is poisoned".to_string())
}

#[tauri::command]
fn list_items(state: tauri::State<'_, LibraryState>) -> Result<Vec<StockItemDto>, String> {
    let library = lock_library(&state)?;
    Ok(library
        .list()
        .into_iter()
        .map(|item| library.to_dto(&item))
        .collect())
}

#[tauri::command]
fn import_files(
    paths: Vec<String>,
    state: tauri::State<'_, LibraryState>,
) -> Result<Vec<StockItemDto>, String> {
    let mut library = lock_library(&state)?;
    let mut imported = Vec::new();

    for path in paths {
        if let Some(item) = library.import_file(Path::new(&path))? {
            imported.push(library.to_dto(&item));
        }
    }

    Ok(imported)
}

#[tauri::command]
fn import_image_bytes(
    bytes: Vec<u8>,
    source_name: String,
    state: tauri::State<'_, LibraryState>,
) -> Result<StockItemDto, String> {
    let mut library = lock_library(&state)?;
    let item = library.import_bytes(&bytes, source_name)?;
    Ok(library.to_dto(&item))
}

#[tauri::command]
fn update_item(
    id: String,
    title: Option<String>,
    tags: Option<Vec<String>>,
    favorite: Option<bool>,
    state: tauri::State<'_, LibraryState>,
) -> Result<StockItemDto, String> {
    let mut library = lock_library(&state)?;
    let item = library.update(&id, title, tags, favorite)?;
    Ok(library.to_dto(&item))
}

#[tauri::command]
fn delete_item(id: String, state: tauri::State<'_, LibraryState>) -> Result<(), String> {
    lock_library(&state)?.delete(&id)
}

#[tauri::command]
fn reveal_item(id: String, state: tauri::State<'_, LibraryState>) -> Result<(), String> {
    let path = lock_library(&state)?.image_path(&id)?;
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(|error| error.to_string())
}

#[derive(Deserialize)]
struct AutoTagOutput {
    tags: Vec<String>,
}

#[tauri::command]
async fn auto_tag_item(
    id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, LibraryState>,
) -> Result<StockItemDto, String> {
    let image_path = {
        let library = lock_library(&state)?;
        library.image_path(&id)?
    };

    let output = app
        .shell()
        .sidecar("tagger")
        .map_err(|error| format!("failed to prepare tagger sidecar: {error}"))?
        .args([image_path])
        .output()
        .await
        .map_err(|error| format!("failed to run tagger sidecar: {error}"))?;

    if !output.status.success() {
        let status = output
            .status
            .code()
            .map_or_else(|| "signal".to_string(), |code| code.to_string());
        return Err(sidecar_error(
            format!("tagger sidecar exited with status {status}"),
            &output.stderr,
        ));
    }

    let parsed: AutoTagOutput = serde_json::from_slice(&output.stdout).map_err(|error| {
        sidecar_error(
            format!("tagger sidecar returned invalid JSON: {error}"),
            &output.stderr,
        )
    })?;

    let mut library = lock_library(&state)?;
    let item = library.merge_auto_tags(&id, &parsed.tags, 3)?;
    Ok(library.to_dto(&item))
}

fn sidecar_error(message: String, stderr: &[u8]) -> String {
    let excerpt: String = String::from_utf8_lossy(stderr).chars().take(500).collect();
    let excerpt = excerpt.trim();
    if excerpt.is_empty() {
        message
    } else {
        format!("{message}; stderr: {excerpt}")
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let library = Library::new(app_data_dir).map_err(std::io::Error::other)?;
            app.manage(Mutex::new(library));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_items,
            import_files,
            import_image_bytes,
            update_item,
            delete_item,
            reveal_item,
            auto_tag_item
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
