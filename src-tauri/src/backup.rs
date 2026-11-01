use crate::{
    database::{hash, write_new, Store},
    models::*,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};
#[derive(Serialize, Deserialize)]
struct Manifest {
    format: String,
    version: u32,
    files: BTreeMap<String, String>,
}
pub fn export(store: &Store, target: &Path) -> Result<()> {
    if target.exists() {
        return Err("Choose a new backup filename to preserve existing backups.".into());
    }
    if target.starts_with(&store.root) {
        return Err("Save backups outside the active workspace folder.".into());
    }
    let tmp = target.with_extension(format!("{}.partial", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut data = BTreeMap::new();
        let sqlite = store
            .root
            .join(format!("backup-{}.sqlite", uuid::Uuid::new_v4()));
        store
            .db
            .backup("main", &sqlite, None)
            .map_err(|e| format!("Cannot snapshot database: {e}"))?;
        let bytes = fs::read(&sqlite).map_err(|e| e.to_string())?;
        fs::remove_file(&sqlite).map_err(|e| e.to_string())?;
        data.insert("workspace.sqlite".to_string(), bytes);
        for p in store.snapshot()?.papers {
            let note = store.read_note(&p.id)?;
            if !note.exists {
                return Err(format!("Note for '{}' is missing. Recreate or recover it before making a complete backup.",p.title));
            }
            data.insert(format!("notes/{}.md", p.id), note.content.into_bytes());
        }
        let manifest = Manifest {
            format: "yara-research".into(),
            version: 2,
            files: data.iter().map(|(k, v)| (k.clone(), hash(v))).collect(),
        };
        let f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)
            .map_err(|e| e.to_string())?;
        let mut z = ZipWriter::new(f);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        z.start_file("manifest.json", options)
            .map_err(|e| e.to_string())?;
        z.write_all(&serde_json::to_vec(&manifest).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        for (name, bytes) in data {
            z.start_file(name, options).map_err(|e| e.to_string())?;
            z.write_all(&bytes).map_err(|e| e.to_string())?;
        }
        z.finish()
            .map_err(|e| e.to_string())?
            .sync_all()
            .map_err(|e| e.to_string())?;
        fs::rename(&tmp, target).map_err(|e| e.to_string())?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}
pub fn restore(base: &Path, source: &Path) -> Result<Store> {
    let f = fs::File::open(source).map_err(|e| e.to_string())?;
    if f.metadata().map_err(|e| e.to_string())?.len() > 512_000_000 {
        return Err("Backup exceeds 512 MB.".into());
    }
    let mut z = ZipArchive::new(f).map_err(|_| "Not a valid Yara backup archive.")?;
    if z.len() > 20000 {
        return Err("Archive has too many files.".into());
    }
    let mut data = BTreeMap::new();
    let mut total = 0;
    for i in 0..z.len() {
        let mut e = z.by_index(i).map_err(|e| e.to_string())?;
        let name = e.name().to_string();
        if name != "manifest.json" && name != "workspace.sqlite" && !valid_note_name(&name) {
            return Err("Backup contains an unexpected or unsafe path.".into());
        }
        if data.contains_key(&name)
            || e.is_dir()
            || e.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000)
        {
            return Err("Backup contains duplicate entries or symbolic links.".into());
        }
        total += e.size();
        if total > 1_000_000_000 || e.size() > 256_000_000 {
            return Err("Expanded backup exceeds safety limits.".into());
        }
        let mut bytes = vec![];
        (&mut e)
            .take(256_000_001)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > 256_000_000 {
            return Err("Backup entry is too large.".into());
        }
        data.insert(name, bytes);
    }
    let m: Manifest = serde_json::from_slice(
        data.get("manifest.json")
            .ok_or("Missing backup manifest.")?,
    )
    .map_err(|_| "Invalid backup manifest.")?;
    if m.format != "yara-research" || ![1, 2].contains(&m.version) {
        return Err("Unsupported backup version.".into());
    }
    if m.files.len() + 1 != data.len() || !m.files.contains_key("workspace.sqlite") {
        return Err("Backup is incomplete.".into());
    }
    for (name, expected) in &m.files {
        if hash(data.get(name).ok_or("Backup file is missing.")?) != *expected {
            return Err("Backup checksum mismatch: archive is damaged.".into());
        }
    }
    let root = base.join(format!("workspace-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(root.join("notes")).map_err(|e| e.to_string())?;
    // The current workspace remains untouched. A validated new folder becomes active only after all checks pass.
    for (name, bytes) in data.iter().filter(|(n, _)| n.as_str() != "manifest.json") {
        write_new(&root.join(name), bytes)?;
    }
    let store = Store::open(&root)?;
    let check: String = store
        .db
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if check != "ok" {
        return Err("Restored database failed integrity check.".into());
    }
    let violations: i64 = store
        .db
        .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;
    if violations != 0 {
        return Err("Backup has invalid citation relationships.".into());
    }
    for mut p in store.snapshot()?.papers {
        crate::database::validate(&mut p)?;
        if !store.read_note(&p.id)?.exists {
            return Err("Backup is missing a paper note.".into());
        }
    }
    let prior = store.workspace()?;
    store
        .db
        .execute(
            "INSERT OR REPLACE INTO workspace_meta VALUES('restoredFrom',?)",
            [prior.id],
        )
        .map_err(|e| e.to_string())?;
    store
        .db
        .execute(
            "UPDATE workspace_meta SET value=? WHERE key='id'",
            [uuid::Uuid::new_v4().to_string()],
        )
        .map_err(|e| e.to_string())?;
    store
        .db
        .execute(
            "UPDATE workspace_meta SET value=? WHERE key='name'",
            [format!("{} (restored)", prior.name)],
        )
        .map_err(|e| e.to_string())?;
    Ok(store)
}
fn valid_note_name(s: &str) -> bool {
    s.strip_prefix("notes/")
        .and_then(|s| s.strip_suffix(".md"))
        .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok())
}
pub fn active_root(base: &Path) -> Result<PathBuf> {
    let pointer = base.join("active-workspace");
    if !pointer.exists() {
        return Ok(base.join("workspace"));
    }
    let name = fs::read_to_string(pointer).map_err(|e| e.to_string())?;
    if name != "workspace"
        && (!name.starts_with("workspace-") || uuid::Uuid::parse_str(&name[10..]).is_err())
    {
        return Err(
            "Invalid workspace pointer. Original workspaces are preserved in the data directory."
                .into(),
        );
    }
    Ok(base.join(name))
}
pub fn activate(base: &Path, root: &Path) -> Result<()> {
    let name = root
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid workspace directory.")?;
    let tmp = base.join(format!("active-{}.tmp", uuid::Uuid::new_v4()));
    write_new(&tmp, name.as_bytes())?;
    fs::rename(tmp, base.join("active-workspace")).map_err(|e| e.to_string())
}
