use crate::{backup, database::Store, models::*};
use std::{
    fs,
    path::{Path, PathBuf},
};
pub fn base_dir() -> Result<PathBuf> {
    if let Some(path) = std::env::var_os("YARA_DATA_DIR") {
        return Ok(PathBuf::from(path));
    }
    std::env::var_os("APPDATA")
        .map(|p| PathBuf::from(p).join("org.yara.research"))
        .ok_or("Cannot find the Windows application data directory.".into())
}
pub fn valid_folder(name: &str) -> bool {
    name == "workspace"
        || name
            .strip_prefix("workspace-")
            .is_some_and(|s| uuid::Uuid::parse_str(s).is_ok())
}
pub fn list(base: &Path) -> Result<Vec<(Workspace, PathBuf)>> {
    let active = backup::active_root(base)?;
    let mut out = vec![];
    for entry in fs::read_dir(base).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !entry.file_type().map_err(|e| e.to_string())?.is_dir()
            || !valid_folder(&entry.file_name().to_string_lossy())
            || !path.join("workspace.sqlite").is_file()
        {
            continue;
        }
        if let Ok(store) = Store::open(&path) {
            if let Ok(mut w) = store.workspace() {
                w.active = path == active;
                out.push((w, path));
            }
        }
    }
    out.sort_by(|a, b| b.0.active.cmp(&a.0.active).then(a.0.name.cmp(&b.0.name)));
    Ok(out)
}
pub fn find(base: &Path, id: &str) -> Result<PathBuf> {
    crate::database::valid_id(id)?;
    let found: Vec<_> = list(base)?
        .into_iter()
        .filter(|(w, _)| w.id == id)
        .collect();
    if found.len() != 1 {
        return Err("The selected workspace is unavailable or has an ambiguous identity. Select it again in Yara.".into());
    }
    Ok(found[0].1.clone())
}
pub fn create(base: &Path, name: &str) -> Result<Store> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err("Use a workspace name between 1 and 80 characters.".into());
    }
    let path = base.join(format!("workspace-{}", uuid::Uuid::new_v4()));
    let s = Store::open(&path)?;
    s.db.execute("UPDATE workspace_meta SET value=? WHERE key='name'", [name])
        .map_err(|e| e.to_string())?;
    Ok(s)
}
impl Store {
    pub fn workspace(&self) -> Result<Workspace> {
        let get = |key| {
            self.db
                .query_row("SELECT value FROM workspace_meta WHERE key=?", [key], |r| {
                    r.get::<_, String>(0)
                })
                .map_err(|e| e.to_string())
        };
        let count: i64 = self
            .db
            .query_row("SELECT COUNT(*) FROM papers", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        Ok(Workspace {
            id: get("id")?,
            name: get("name")?,
            paper_count: count as u64,
            active: true,
        })
    }
}
