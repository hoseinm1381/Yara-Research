mod backup;
mod bridge;
mod database;
mod discovery;
mod evidence;
mod models;
mod workspaces;
pub fn native_messaging(origin: &str) -> models::Result<()> {
    bridge::run_stdio(origin, &workspaces::base_dir()?)
}
#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_v11;
use database::Store;
use models::*;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::{Manager, State};
pub struct Runtime {
    base: PathBuf,
    store: Mutex<Store>,
    key: Mutex<String>,
    generation: AtomicU64,
}
fn lock(rt: &Runtime) -> Result<std::sync::MutexGuard<'_, Store>> {
    rt.store
        .lock()
        .map_err(|_| "Workspace is temporarily unavailable. Restart Yara to recover.".into())
}
#[tauri::command]
fn snapshot(rt: State<Runtime>) -> Result<Snapshot> {
    lock(&rt)?.snapshot()
}
#[tauri::command]
fn list_workspaces(rt: State<Runtime>) -> Result<Vec<Workspace>> {
    Ok(workspaces::list(&rt.base)?
        .into_iter()
        .map(|(w, _)| w)
        .collect())
}
#[tauri::command]
fn create_workspace(rt: State<Runtime>, name: String) -> Result<Workspace> {
    let s = workspaces::create(&rt.base, &name)?;
    s.workspace()
}
#[tauri::command]
fn switch_workspace(rt: State<Runtime>, id: String) -> Result<Snapshot> {
    let root = workspaces::find(&rt.base, &id)?;
    let next = Store::open(&root)?;
    let mut s = lock(&rt)?;
    rt.generation.fetch_add(1, Ordering::SeqCst);
    backup::activate(&rt.base, &root)?;
    *s = next;
    s.snapshot()
}
#[tauri::command]
fn rename_workspace(rt: State<Runtime>, name: String) -> Result<Workspace> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err("Use a name between 1 and 80 characters.".into());
    }
    let s = lock(&rt)?;
    s.db.execute("UPDATE workspace_meta SET value=? WHERE key='name'", [name])
        .map_err(|e| e.to_string())?;
    s.workspace()
}
#[tauri::command]
fn workspace_revision(rt: State<Runtime>) -> Result<String> {
    let s = lock(&rt)?;
    let v: i64 =
        s.db.query_row("PRAGMA data_version", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
    Ok(format!("{}:{v}", s.workspace()?.id))
}
#[tauri::command]
fn relationship_evidence(
    rt: State<Runtime>,
    id: String,
    direction: String,
) -> Result<Vec<EvidenceSnapshot>> {
    let s = lock(&rt)?;
    s.evidence(&s.paper(&id)?, &direction)
}
#[tauri::command]
fn cached_discovery(rt: State<Runtime>, query: DiscoveryQuery) -> Result<Option<DiscoveryResult>> {
    let mut cached = lock(&rt)?.cache_get(&discovery::cache_key(&query))?;
    if let Some(r) = &mut cached {
        r.cached = true;
        r.stale = true;
    }
    Ok(cached)
}
#[tauri::command]
fn metadata_sources(rt: State<Runtime>, id: String) -> Result<serde_json::Value> {
    let s = lock(&rt)?;
    s.paper(&id)?;
    let mut stmt = s
        .db
        .prepare("SELECT provider,source_url,captured_at FROM metadata_sources WHERE paper_id=?")
        .map_err(|e| e.to_string())?;
    let rows=stmt.query_map([id],|r|Ok(serde_json::json!({"provider":r.get::<_,String>(0)?,"url":r.get::<_,String>(1)?,"capturedAt":r.get::<_,String>(2)?}))).map_err(|e|e.to_string())?;
    Ok(serde_json::Value::Array(
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?,
    ))
}
#[tauri::command]
fn save_paper(rt: State<Runtime>, paper: Paper) -> Result<Paper> {
    let mut s = lock(&rt)?;
    let p = s.save(paper, false)?;
    s.metadata_source(&p.id, "Manual", "", &p)?;
    s.infer_edges()?;
    Ok(p)
}
#[tauri::command]
fn import_papers(
    rt: State<Runtime>,
    papers: Vec<Paper>,
    anchor: Option<String>,
    direction: Option<String>,
) -> Result<Vec<Paper>> {
    if papers.len() > 500 {
        return Err("Import at most 500 papers at once.".into());
    }
    let mut prepared = papers;
    for p in &mut prepared {
        database::validate(p)?;
    }
    let mut s = lock(&rt)?;
    if let Some(id) = &anchor {
        s.paper(id)?;
        if ![Some("citing"), Some("references"), None].contains(&direction.as_deref()) {
            return Err("Invalid citation direction.".into());
        }
    }
    // An outer savepoint makes a multi-paper import atomic, including inferred connections.
    s.db.execute_batch("SAVEPOINT batch_import")
        .map_err(|e| e.to_string())?;
    let result = (|| {
        let mut out = vec![];
        for p in prepared {
            let original = p.clone();
            let saved = s.save(p, true)?;
            if original.source == "OpenAlex" {
                s.metadata_source(&saved.id, "OpenAlex", &original.url, &original)?;
            }
            if let (Some(id), Some(dir)) = (&anchor, &direction) {
                if id != &saved.id {
                    let focal = s.paper(id)?;
                    let mut providers = std::collections::BTreeSet::new();
                    for capture in s.evidence(&focal, dir)? {
                        if capture.coverage == "failed" {
                            continue;
                        }
                        for item in capture
                            .items
                            .iter()
                            .filter(|p| crate::evidence::same(p, &saved) || p.id == saved.id)
                        {
                            providers.insert(capture.provider.clone());
                            s.metadata_source(
                                &saved.id,
                                &capture.provider,
                                &capture.source_url,
                                item,
                            )?;
                        }
                    }
                    s.edge(&Citation {
                        citing: if dir == "citing" {
                            saved.id.clone()
                        } else {
                            id.clone()
                        },
                        cited: if dir == "citing" {
                            id.clone()
                        } else {
                            saved.id.clone()
                        },
                        source: if providers.is_empty() {
                            "manual import".into()
                        } else {
                            providers.iter().cloned().collect::<Vec<_>>().join(" + ")
                        },
                        verified: !providers.is_empty(),
                        created_at: chrono::Utc::now().to_rfc3339(),
                    })?;
                }
            }
            out.push(saved);
        }
        s.infer_edges()?;
        Ok(out)
    })();
    match result {
        Ok(out) => {
            s.db.execute_batch("RELEASE batch_import")
                .map_err(|e| e.to_string())?;
            Ok(out)
        }
        Err(e) => {
            let _ =
                s.db.execute_batch("ROLLBACK TO batch_import; RELEASE batch_import");
            Err(e)
        }
    }
}
#[tauri::command]
fn save_position(rt: State<Runtime>, id: String, x: f64, y: f64) -> Result<()> {
    lock(&rt)?.position(&id, x, y)
}
#[tauri::command]
fn reset_demo(rt: State<Runtime>) -> Result<()> {
    let s = lock(&rt)?;
    let papers = s.snapshot()?.papers;
    if papers
        .iter()
        .any(|p| !p.source.starts_with("Optional demo"))
    {
        return Err("Reset is available only when every paper belongs to the optional demo. Your research was preserved.".into());
    }
    s.db.execute("DELETE FROM papers", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
fn delete_paper(rt: State<Runtime>, id: String) -> Result<()> {
    let s = lock(&rt)?;
    s.paper(&id)?;
    s.db.execute("DELETE FROM papers WHERE id=?", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
fn save_citation(rt: State<Runtime>, citing: String, cited: String) -> Result<()> {
    lock(&rt)?.edge(&Citation {
        citing,
        cited,
        source: "manual".into(),
        verified: false,
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}
#[tauri::command]
fn delete_citation(rt: State<Runtime>, citing: String, cited: String) -> Result<()> {
    lock(&rt)?
        .db
        .execute(
            "DELETE FROM citations WHERE citing=?1 AND cited=?2",
            rusqlite::params![citing, cited],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
fn read_note(rt: State<Runtime>, id: String) -> Result<Note> {
    lock(&rt)?.read_note(&id)
}
#[tauri::command]
fn save_note(rt: State<Runtime>, id: String, content: String, revision: String) -> Result<Note> {
    lock(&rt)?.save_note(&id, &content, &revision)
}
#[tauri::command]
fn set_setting(rt: State<Runtime>, key: String, value: String) -> Result<()> {
    lock(&rt)?.setting(&key, &value)
}
#[tauri::command]
fn set_api_key(rt: State<Runtime>, key: String) -> Result<()> {
    if key.len() > 1000 || key.contains(['\n', '\r']) {
        return Err("Invalid API key.".into());
    }
    *rt.key.lock().map_err(|e| e.to_string())? = key;
    Ok(())
}
#[tauri::command]
fn cancel_discovery(rt: State<Runtime>) {
    rt.generation.fetch_add(1, Ordering::SeqCst);
}
#[tauri::command]
async fn discover(rt: State<'_, Runtime>, query: DiscoveryQuery) -> Result<DiscoveryResult> {
    let key = rt.key.lock().map_err(|e| e.to_string())?.clone();
    let identity = discovery::cache_key(&query);
    let cached = lock(&rt)?.cache_get(&identity)?;
    let workspace_id = lock(&rt)?.workspace()?.id;
    if !query.refresh {
        if let Some(mut value) = cached.clone() {
            value.cached = true;
            value.stale = chrono::DateTime::parse_from_rfc3339(&value.fetched_at)
                .map(|t| chrono::Utc::now().signed_duration_since(t).num_hours() > 24)
                .unwrap_or(true);
            return Ok(value);
        }
    }
    let generation = rt.generation.load(Ordering::SeqCst);
    let result = tokio::select! {r=discovery::fetch(&query,&key)=>r,_=async{loop{tokio::time::sleep(std::time::Duration::from_millis(100)).await;if rt.generation.load(Ordering::SeqCst)!=generation{break;}}}=>return Err("Discovery canceled.".into())};
    match result {
        Ok(r) => {
            let s = lock(&rt)?;
            if s.workspace()?.id != workspace_id {
                return Err("Workspace changed; discovery canceled.".into());
            }
            s.cache_put(&identity, &r)?;
            s.record_openalex(&query, &r)?;
            Ok(r)
        }
        Err(e) => {
            {
                let s = lock(&rt)?;
                if s.workspace()?.id == workspace_id {
                    s.record_openalex_failure(&query, &e)?;
                }
            }
            if let Some(mut r) = cached {
                r.cached = true;
                r.stale = true;
                r.refresh_error = Some(e);
                Ok(r)
            } else {
                Err(e)
            }
        }
    }
}
#[tauri::command]
fn export_backup(rt: State<Runtime>, path: String) -> Result<()> {
    let s = lock(&rt)?;
    backup::export(&s, &PathBuf::from(path))
}
#[tauri::command]
fn restore_backup(rt: State<Runtime>, path: String) -> Result<Snapshot> {
    let next = backup::restore(&rt.base, &PathBuf::from(path))?;
    let mut s = lock(&rt)?;
    rt.generation.fetch_add(1, Ordering::SeqCst);
    backup::activate(&rt.base, &next.root)?;
    *s = next;
    s.snapshot()
}
#[tauri::command]
fn open_url(url: String) -> Result<()> {
    database::validate_url(&url)?;
    open::that(url).map_err(|e| format!("Cannot open browser: {e}"))
}
#[tauri::command]
fn open_note(rt: State<Runtime>, id: String, editor: String) -> Result<String> {
    let s = lock(&rt)?;
    let note = s.read_note(&id)?;
    if !note.exists {
        return Err("Save the note first to recreate the missing file.".into());
    }
    let path = s.note_path(&id)?;
    if editor == "default" {
        open::that(&path).map_err(|e| format!("Cannot open default editor: {e}"))?;
        return Ok("Opened in the default Markdown editor.".into());
    }
    let configured = s
        .snapshot()?
        .settings
        .get("vscode")
        .cloned()
        .unwrap_or_default();
    let mut candidates = vec![PathBuf::from(configured)];
    for var in ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(root) = std::env::var_os(var) {
            let root = PathBuf::from(root);
            candidates.push(root.join("Programs/Microsoft VS Code/Code.exe"));
            candidates.push(root.join("Microsoft VS Code/Code.exe"));
        }
    }
    if let Some(paths) = std::env::var_os("PATH") {
        for path in std::env::split_paths(&paths) {
            candidates.push(path.join("Code.exe"));
            if let Some(parent) = path.parent() {
                candidates.push(parent.join("Code.exe"));
            }
        }
    }
    for exe in candidates {
        if exe.is_file()
            && exe
                .file_name()
                .is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case("Code.exe"))
        {
            std::process::Command::new(exe)
                .arg("--reuse-window")
                .arg(&path)
                .spawn()
                .map_err(|e| format!("Cannot launch VS Code: {e}"))?;
            return Ok("Opened in VS Code. Return to Yara to reload external changes.".into());
        }
    }
    Err(
        "VS Code was not found. Set its Code.exe path in Settings, or use Open in default editor."
            .into(),
    )
}
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let base = std::env::var_os("YARA_DATA_DIR")
                .map(PathBuf::from)
                .unwrap_or(app.path().app_data_dir()?);
            std::fs::create_dir_all(&base)?;
            let root = backup::active_root(&base).map_err(std::io::Error::other)?;
            let store = Store::open(&root).map_err(std::io::Error::other)?;
            app.manage(Runtime {
                base,
                store: Mutex::new(store),
                key: Mutex::new(String::new()),
                generation: AtomicU64::new(0),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            snapshot,
            list_workspaces,
            create_workspace,
            switch_workspace,
            rename_workspace,
            workspace_revision,
            relationship_evidence,
            cached_discovery,
            metadata_sources,
            save_paper,
            import_papers,
            save_position,
            delete_paper,
            reset_demo,
            save_citation,
            delete_citation,
            read_note,
            save_note,
            set_setting,
            set_api_key,
            discover,
            cancel_discovery,
            export_backup,
            restore_backup,
            open_url,
            open_note
        ])
        .run(tauri::generate_context!())
        .expect("Yara could not start; existing workspace data has not been removed.");
}
