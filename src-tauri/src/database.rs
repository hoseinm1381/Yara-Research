use crate::models::*;
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};

pub struct Store {
    pub root: PathBuf,
    pub db: Connection,
}
pub fn hash(content: &[u8]) -> String {
    format!("{:x}", Sha256::digest(content))
}
pub fn normalize_doi(input: &str) -> Result<String> {
    let mut s = input.trim().to_lowercase();
    for prefix in [
        "https://doi.org/",
        "http://doi.org/",
        "https://dx.doi.org/",
        "http://dx.doi.org/",
        "doi:",
    ] {
        if let Some(rest) = s.strip_prefix(prefix) {
            s = rest.trim().to_string();
            break;
        }
    }
    if !s.is_empty()
        && !regex::Regex::new(r"^10\.\d{4,9}/\S+$")
            .unwrap()
            .is_match(&s)
    {
        return Err("Invalid DOI. Use a value such as 10.1038/nature14539.".into());
    }
    Ok(s)
}
pub fn valid_id(id: &str) -> Result<()> {
    uuid::Uuid::parse_str(id)
        .map(|_| ())
        .map_err(|_| "Invalid paper identifier.".into())
}
pub fn validate(p: &mut Paper) -> Result<()> {
    valid_id(&p.id)?;
    p.title = p.title.trim().into();
    if p.title.is_empty() || p.title.len() > 10000 {
        return Err("A title is required (up to 10,000 bytes).".into());
    }
    p.doi = normalize_doi(&p.doi)?;
    if !p.ieee.is_empty() && !regex::Regex::new(r"^\d{1,16}$").unwrap().is_match(&p.ieee) {
        return Err("Invalid IEEE article identifier.".into());
    }
    if !p.openalex.is_empty() {
        let id = p
            .openalex
            .trim()
            .trim_start_matches("https://openalex.org/")
            .to_uppercase();
        if !regex::Regex::new(r"^W\d+$").unwrap().is_match(&id) {
            return Err("Invalid OpenAlex work ID.".into());
        }
        p.openalex = format!("https://openalex.org/{id}");
    }
    if ![
        "core",
        "candidate",
        "unreviewed",
        "read",
        "archived",
        "rejected",
    ]
    .contains(&p.status.as_str())
    {
        return Err("Invalid research status.".into());
    }
    if p.year.is_some_and(|y| !(1000..=2200).contains(&y)) {
        return Err("Year must be between 1000 and 2200.".into());
    }
    if !p.x.is_finite() || !p.y.is_finite() || p.x.abs() > 1e7 || p.y.abs() > 1e7 {
        return Err("Invalid graph coordinates.".into());
    }
    if !p.url.is_empty() {
        validate_url(&p.url)?;
    }
    p.tags = p
        .tags
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    p.tags.sort();
    p.tags.dedup();
    if serde_json::to_vec(p).map_err(|e| e.to_string())?.len() > 4_000_000 {
        return Err("Paper metadata exceeds 4 MB.".into());
    }
    Ok(())
}
pub fn validate_url(s: &str) -> Result<()> {
    let u = url::Url::parse(s).map_err(|_| "Invalid publication URL.")?;
    if !["https", "http"].contains(&u.scheme())
        || u.host_str().is_none()
        || !u.username().is_empty()
        || u.password().is_some()
    {
        return Err("Only HTTP or HTTPS publication URLs are supported.".into());
    }
    Ok(())
}
impl Store {
    pub fn open(root: &Path) -> Result<Self> {
        fs::create_dir_all(root.join("notes")).map_err(|e| e.to_string())?;
        let db = Connection::open(root.join("workspace.sqlite")).map_err(|e| e.to_string())?;
        db.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        db.execute_batch(
            "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;",
        )
        .map_err(|e| e.to_string())?;
        let version: u32 = db
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if version > 2 {
            return Err("Workspace was created by a newer version of Yara Research.".into());
        }
        if version == 0 {
            db.execute_batch(&format!(
                "BEGIN IMMEDIATE; {} COMMIT;",
                include_str!("../migrations/001_initial.sql")
            ))
            .map_err(|e| e.to_string())?;
        }
        if version <= 1 {
            db.execute_batch(&format!(
                "BEGIN IMMEDIATE; {} COMMIT;",
                include_str!("../migrations/002_workspaces_evidence.sql")
            ))
            .map_err(|e| e.to_string())?;
        }
        db.execute(
            "INSERT OR IGNORE INTO workspace_meta VALUES('id',?)",
            [uuid::Uuid::new_v4().to_string()],
        )
        .map_err(|e| e.to_string())?;
        db.execute(
            "INSERT OR IGNORE INTO workspace_meta VALUES('name','My research')",
            [],
        )
        .map_err(|e| e.to_string())?;
        Ok(Self {
            root: root.to_path_buf(),
            db,
        })
    }
    pub fn snapshot(&self) -> Result<Snapshot> {
        let mut stmt=self.db.prepare("SELECT p.metadata,l.x,l.y,l.pinned,l.hidden FROM papers p JOIN layout l ON l.paper_id=p.id ORDER BY p.rowid").map_err(|e|e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, f64>(1)?,
                    r.get::<_, f64>(2)?,
                    r.get::<_, bool>(3)?,
                    r.get::<_, bool>(4)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut papers = vec![];
        for row in rows {
            let (raw, x, y, pinned, hidden) = row.map_err(|e| e.to_string())?;
            let mut p: Paper = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            p.x = x;
            p.y = y;
            p.pinned = pinned;
            p.hidden = hidden;
            p.has_note = self.note_path(&p.id)?.exists();
            papers.push(p);
        }
        let mut stmt = self
            .db
            .prepare("SELECT citing,cited,source,verified,created_at FROM citations")
            .map_err(|e| e.to_string())?;
        let citations = stmt
            .query_map([], |r| {
                Ok(Citation {
                    citing: r.get(0)?,
                    cited: r.get(1)?,
                    source: r.get(2)?,
                    verified: r.get(3)?,
                    created_at: r.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        let mut stmt = self
            .db
            .prepare("SELECT key,value FROM settings")
            .map_err(|e| e.to_string())?;
        let settings = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| e.to_string())?
            .collect::<std::result::Result<HashMap<_, _>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(Snapshot {
            papers,
            citations,
            settings,
            root: self.root.to_string_lossy().into(),
            workspace: self.workspace()?,
        })
    }
    pub fn paper(&self, id: &str) -> Result<Paper> {
        let raw: String = self
            .db
            .query_row("SELECT metadata FROM papers WHERE id=?", [id], |r| r.get(0))
            .map_err(|_| "Paper no longer exists.")?;
        let mut p: Paper = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        let (x, y, pin, hid) = self
            .db
            .query_row(
                "SELECT x,y,pinned,hidden FROM layout WHERE paper_id=?",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .map_err(|e| e.to_string())?;
        p.x = x;
        p.y = y;
        p.pinned = pin;
        p.hidden = hid;
        Ok(p)
    }
    pub fn save(&mut self, mut p: Paper, importing: bool) -> Result<Paper> {
        validate(&mut p)?;
        let ids: Vec<String> = {
            let mut stmt=self.db.prepare("SELECT id FROM papers WHERE id=?1 OR (doi IS NOT NULL AND doi=?2) OR (openalex IS NOT NULL AND openalex=?3) OR (ieee IS NOT NULL AND ieee=?4)").map_err(|e|e.to_string())?;
            let rows = stmt
                .query_map(params![p.id, p.doi, p.openalex, p.ieee], |r| r.get(0))
                .map_err(|e| e.to_string())?;
            rows.collect::<std::result::Result<_, _>>()
                .map_err(|e| e.to_string())?
        };
        if ids.len() > 1 {
            return Err("Identifiers conflict with different saved papers. Review DOI and OpenAlex ID before importing.".into());
        }
        if let Some(id) = ids.first() {
            if importing {
                let mut old = self.paper(id)?;
                let mut refs = old.references.clone();
                refs.extend(p.references);
                refs.sort();
                refs.dedup();
                old.references = refs;
                // Enrich missing identifiers and metadata without replacing any researcher correction.
                if old.doi.is_empty() {
                    old.doi = p.doi;
                }
                if old.openalex.is_empty() {
                    old.openalex = p.openalex;
                }
                if old.ieee.is_empty() {
                    old.ieee = p.ieee;
                }
                if old.authors.is_empty() {
                    old.authors = p.authors;
                }
                if old.year.is_none() {
                    old.year = p.year;
                }
                if old.r#abstract.is_empty() {
                    old.r#abstract = p.r#abstract;
                }
                if old.journal.is_empty() {
                    old.journal = p.journal;
                }
                if old.publisher.is_empty() {
                    old.publisher = p.publisher;
                }
                if old.url.is_empty() {
                    old.url = p.url;
                }
                if old.publication_date.is_empty() {
                    old.publication_date = p.publication_date;
                }
                if old.keywords.is_empty() {
                    old.keywords = p.keywords;
                }
                if old.citation_count.is_none() {
                    old.citation_count = p.citation_count;
                }
                p = old;
            } else if id != &p.id {
                return Err("This DOI or OpenAlex ID already belongs to a saved paper.".into());
            }
        }
        p.updated_at = chrono::Utc::now().to_rfc3339();
        // Create the note before committing the record; a failed DB write can leave only an innocuous orphan note.
        let path = self.note_path(&p.id)?;
        if !path.exists() {
            let content = note_template(&p);
            write_new(&path, content.as_bytes())?;
        }
        p.has_note = true;
        let tx = self.db.savepoint().map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO papers(id,doi,openalex,title,status,metadata) VALUES(?1,NULLIF(?2,''),NULLIF(?3,''),?4,?5,?6) ON CONFLICT(id) DO UPDATE SET doi=excluded.doi,openalex=excluded.openalex,title=excluded.title,status=excluded.status,metadata=excluded.metadata",params![p.id,p.doi,p.openalex,p.title,p.status,serde_json::to_string(&p).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
        tx.execute(
            "UPDATE papers SET ieee=NULLIF(?2,'') WHERE id=?1",
            params![p.id, p.ieee],
        )
        .map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO layout VALUES(?1,?2,?3,?4,?5) ON CONFLICT(paper_id) DO UPDATE SET x=excluded.x,y=excluded.y,pinned=excluded.pinned,hidden=excluded.hidden",params![p.id,p.x,p.y,p.pinned,p.hidden]).map_err(|e|e.to_string())?;
        tx.execute(
            "INSERT OR IGNORE INTO notes VALUES(?1,?2)",
            params![p.id, format!("notes/{}.md", p.id)],
        )
        .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM paper_tags WHERE paper_id=?", [&p.id])
            .map_err(|e| e.to_string())?;
        for tag in &p.tags {
            tx.execute("INSERT OR IGNORE INTO tags(name) VALUES(?)", [tag])
                .map_err(|e| e.to_string())?;
            tx.execute(
                "INSERT INTO paper_tags SELECT ?1,id FROM tags WHERE name=?2",
                params![p.id, tag],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(p)
    }
    pub fn infer_edges(&self) -> Result<()> {
        let papers = self.snapshot()?.papers;
        let ids: HashMap<_, _> = papers
            .iter()
            .filter(|p| !p.openalex.is_empty())
            .map(|p| (&p.openalex, &p.id))
            .collect();
        for p in &papers {
            for reference in &p.references {
                if let Some(id) = ids.get(reference) {
                    if *id != &p.id {
                        self.edge(&Citation {
                            citing: p.id.clone(),
                            cited: (*id).clone(),
                            source: if p.source == "OpenAlex" {
                                "OpenAlex references"
                            } else {
                                "manual references"
                            }
                            .into(),
                            verified: p.source == "OpenAlex",
                            created_at: chrono::Utc::now().to_rfc3339(),
                        })?;
                    }
                }
            }
        }
        Ok(())
    }
    pub fn edge(&self, e: &Citation) -> Result<()> {
        valid_id(&e.citing)?;
        valid_id(&e.cited)?;
        self.db.execute("INSERT INTO citations VALUES(?1,?2,?3,?4,?5) ON CONFLICT(citing,cited) DO UPDATE SET verified=MAX(verified,excluded.verified),source=CASE WHEN excluded.verified>verified THEN excluded.source ELSE source END",params![e.citing,e.cited,e.source,e.verified,e.created_at]).map_err(|e|e.to_string())?;
        Ok(())
    }
    pub fn position(&self, id: &str, x: f64, y: f64) -> Result<()> {
        if !x.is_finite() || !y.is_finite() || x.abs() > 1e7 || y.abs() > 1e7 {
            return Err("Invalid position".into());
        }
        self.db
            .execute(
                "UPDATE layout SET x=?2,y=?3 WHERE paper_id=?1",
                params![id, x, y],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn note_path(&self, id: &str) -> Result<PathBuf> {
        valid_id(id)?;
        Ok(self.root.join("notes").join(format!("{id}.md")))
    }
    pub fn read_note(&self, id: &str) -> Result<Note> {
        self.paper(id)?;
        let path = self.note_path(id)?;
        match fs::read_to_string(path) {
            Ok(content) => Ok(Note {
                revision: hash(content.as_bytes()),
                content,
                exists: true,
            }),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Note {
                content: note_template(&self.paper(id)?),
                revision: String::new(),
                exists: false,
            }),
            Err(e) => Err(format!("Cannot read note: {e}")),
        }
    }
    pub fn save_note(&self, id: &str, content: &str, revision: &str) -> Result<Note> {
        if content.len() > 10_000_000 {
            return Err("Note exceeds 10 MB.".into());
        }
        let old = self.read_note(id)?;
        if old.revision != revision {
            return Err("The note changed outside Yara. Copy your edits, then reload the external version before saving.".into());
        }
        let path = self.note_path(id)?;
        // Preserve the previous bytes as recovery evidence before replacement.
        if path.exists() {
            fs::copy(&path, path.with_extension("md.previous"))
                .map_err(|e| format!("Cannot preserve previous note: {e}"))?;
        }
        let tmp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
        write_new(&tmp, content.as_bytes())?;
        // Recheck immediately before replacing to catch changes made while the temporary file was written.
        if self.read_note(id)?.revision != revision {
            let _ = fs::remove_file(tmp);
            return Err("External note changed during save. Reload before saving.".into());
        }
        fs::rename(&tmp, &path).map_err(|e| {
            format!(
                "Cannot replace note; your edit is preserved at {}: {e}",
                tmp.display()
            )
        })?;
        self.read_note(id)
    }
    pub fn setting(&self, key: &str, value: &str) -> Result<()> {
        if ![
            "theme",
            "vscode",
            "viewport",
            "sidebarCollapsed",
            "inspectorWidth",
        ]
        .contains(&key)
            || value.len() > 10000
        {
            return Err("Unsupported setting.".into());
        }
        self.db.execute("INSERT INTO settings VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![key,value]).map_err(|e|e.to_string())?;
        Ok(())
    }
    pub fn cache_get(&self, key: &str) -> Result<Option<DiscoveryResult>> {
        let raw: Option<String> = self
            .db
            .query_row(
                "SELECT response FROM discovery_cache WHERE query=?",
                [key],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        raw.map(|s| serde_json::from_str(&s).map_err(|e| e.to_string()))
            .transpose()
    }
    pub fn cache_put(&self, key: &str, r: &DiscoveryResult) -> Result<()> {
        self.db.execute("INSERT INTO discovery_cache VALUES(?1,?2,?3) ON CONFLICT(query) DO UPDATE SET response=excluded.response,fetched_at=excluded.fetched_at",params![key,serde_json::to_string(r).map_err(|e|e.to_string())?,r.fetched_at]).map_err(|e|e.to_string())?;
        Ok(())
    }
}
pub fn write_new(path: &Path, bytes: &[u8]) -> Result<()> {
    use std::io::Write;
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    f.write_all(bytes)
        .and_then(|_| f.sync_all())
        .map_err(|e| e.to_string())
}
pub fn note_template(p: &Paper) -> String {
    format!("# {}\n\n## Metadata\n\n- Authors: {}\n- Year: {}\n- DOI: {}\n\n## Personal Summary\n\n## Important Findings\n\n## Strengths\n\n## Weaknesses\n\n## Methodology\n\n## Research Relevance\n\n## Questions\n\n## Follow-Up Notes\n",p.title,p.authors.join(", "),p.year.map(|y|y.to_string()).unwrap_or_default(),p.doi)
}
