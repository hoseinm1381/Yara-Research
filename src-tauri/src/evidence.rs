use crate::{
    database::{validate, validate_url, Store},
    models::*,
};
use rusqlite::{params, OptionalExtension};
use std::collections::HashSet;
pub fn same(a: &Paper, b: &Paper) -> bool {
    if !a.doi.is_empty() && !b.doi.is_empty() {
        return a.doi == b.doi;
    }
    (!a.openalex.is_empty() && a.openalex == b.openalex) || (!a.ieee.is_empty() && a.ieee == b.ieee)
}
pub fn ieee_url(s: &str) -> Result<String> {
    validate_url(s)?;
    let u = url::Url::parse(s).map_err(|e| e.to_string())?;
    if u.scheme() != "https"
        || u.host_str() != Some("ieeexplore.ieee.org")
        || u.port_or_known_default() != Some(443)
    {
        return Err("IEEE evidence must come from an HTTPS IEEE Xplore article page.".into());
    }
    let re = regex::Regex::new(r"^/(?:document|abstract/document)/(\d{1,16})/?$").unwrap();
    let id = re
        .captures(u.path())
        .and_then(|c| c.get(1))
        .ok_or("Open the IEEE article itself before capturing its relationships.")?
        .as_str();
    Ok(format!("https://ieeexplore.ieee.org/document/{id}"))
}
impl Store {
    pub fn record_openalex_failure(&self, q: &DiscoveryQuery, error: &str) -> Result<()> {
        if !["citing", "references"].contains(&q.mode.as_str()) {
            return Ok(());
        }
        let focal = self
            .snapshot()?
            .papers
            .into_iter()
            .find(|p| p.openalex == q.term)
            .unwrap_or_else(|| {
                let mut p = Paper::blank("OpenAlex focal paper");
                p.openalex = q.term.clone();
                p
            });
        self.capture(
            EvidenceSnapshot {
                id: uuid::Uuid::new_v4().to_string(),
                provider: "OpenAlex".into(),
                direction: q.mode.clone(),
                focal,
                captured_at: chrono::Utc::now().to_rfc3339(),
                source_url: "https://api.openalex.org/works".into(),
                method: "OpenAlex refresh attempt".into(),
                coverage: "failed".into(),
                total: None,
                raw: String::new(),
                error: error.into(),
                items: vec![],
            },
            1,
        )
    }
    pub fn evidence(&self, focal: &Paper, direction: &str) -> Result<Vec<EvidenceSnapshot>> {
        let mut stmt=self.db.prepare("SELECT id,provider,direction,focal,captured_at,source_url,method,coverage,total,raw,error FROM evidence_snapshots WHERE direction=? ORDER BY captured_at DESC,rowid DESC").map_err(|e|e.to_string())?;
        let raws = stmt
            .query_map([direction], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, String>(6)?,
                    r.get::<_, String>(7)?,
                    r.get::<_, Option<i64>>(8)?.map(|n| n as u64),
                    r.get::<_, String>(9)?,
                    r.get::<_, String>(10)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut out = vec![];
        for row in raws {
            let (
                id,
                provider,
                direction,
                raw_focal,
                captured_at,
                source_url,
                method,
                coverage,
                total,
                raw,
                error,
            ) = row.map_err(|e| e.to_string())?;
            let f: Paper = serde_json::from_str(&raw_focal).map_err(|e| e.to_string())?;
            if !same(&f, focal) {
                continue;
            }
            let mut pages = self
                .db
                .prepare("SELECT items FROM evidence_pages WHERE snapshot_id=? ORDER BY page")
                .map_err(|e| e.to_string())?;
            let mut items = vec![];
            for page in pages
                .query_map([&id], |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?
            {
                let p: Vec<Paper> = serde_json::from_str(&page.map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
                for p in p {
                    if !items.iter().any(|q| same(q, &p)) {
                        items.push(p);
                    }
                }
            }
            out.push(EvidenceSnapshot {
                id,
                provider,
                direction,
                focal: f,
                captured_at,
                source_url,
                method,
                coverage,
                total,
                raw,
                error,
                items,
            });
        }
        Ok(out)
    }
    pub fn capture(&self, mut c: EvidenceSnapshot, page: u32) -> Result<()> {
        crate::database::valid_id(&c.id)?;
        validate(&mut c.focal)?;
        let existing: Option<(String, String, String)> = self
            .db
            .query_row(
                "SELECT provider,direction,focal FROM evidence_snapshots WHERE id=?",
                [&c.id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some((provider, direction, focal)) = existing {
            let focal: Paper = serde_json::from_str(&focal).map_err(|e| e.to_string())?;
            if provider != c.provider || direction != c.direction || !same(&focal, &c.focal) {
                return Err("A capture identifier cannot be reused for a different paper, source, or direction.".into());
            }
        }
        if !["citing", "references"].contains(&c.direction.as_str())
            || !["complete", "partial", "unknown", "failed"].contains(&c.coverage.as_str())
            || c.raw.len() > 200_000
            || c.items.len() > 500
        {
            return Err("Invalid capture direction, coverage, or size.".into());
        }
        if c.provider == "IEEE" {
            c.source_url = ieee_url(&c.source_url)?;
            let article = c.source_url.rsplit('/').next().unwrap();
            if c.focal.ieee != article {
                return Err("IEEE focal article does not match the source page.".into());
            }
        } else if c.provider != "OpenAlex" {
            return Err("Unsupported evidence provider.".into());
        }
        if c.coverage == "complete"
            && c.provider == "IEEE"
            && (c.total != Some(c.items.len() as u64) || distinct_count(&c.items) != c.items.len())
        {
            return Err("A complete IEEE capture requires an explicit total matching every distinct captured entry.".into());
        }
        if c.total.is_some_and(|n| n > 1_000_000_000) {
            return Err("Invalid source result total.".into());
        }
        for p in &mut c.items {
            let title = p.title.clone();
            if title.trim().is_empty() && (identified(p) || !p.raw.trim().is_empty()) {
                p.title = "Citation pending review".into();
            }
            validate(p)?;
            p.title = title;
        }
        self.db.execute("INSERT INTO evidence_snapshots VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11) ON CONFLICT(id) DO UPDATE SET captured_at=excluded.captured_at,total=MAX(COALESCE(total,0),COALESCE(excluded.total,0)),coverage=excluded.coverage,error=excluded.error",params![c.id,c.provider,c.direction,serde_json::to_string(&c.focal).map_err(|e|e.to_string())?,c.captured_at,c.source_url,c.method,c.coverage,c.total.map(|n|n as i64),c.raw,c.error]).map_err(|e|e.to_string())?;
        self.db
            .execute(
                "INSERT OR REPLACE INTO evidence_pages VALUES(?1,?2,?3)",
                params![
                    c.id,
                    page,
                    serde_json::to_string(&c.items).map_err(|e| e.to_string())?
                ],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn record_openalex(&self, q: &DiscoveryQuery, r: &DiscoveryResult) -> Result<()> {
        if !["citing", "references"].contains(&q.mode.as_str()) {
            return Ok(());
        }
        let Some(session) = &q.session_id else {
            return Ok(());
        };
        crate::database::valid_id(session)?;
        let mut focal = self
            .snapshot()?
            .papers
            .into_iter()
            .find(|p| p.openalex == q.term)
            .unwrap_or_else(|| {
                let mut p = Paper::blank("OpenAlex focal paper");
                p.openalex = q.term.clone();
                p
            });
        if !focal.openalex.starts_with("https://openalex.org/") {
            focal.openalex = format!("https://openalex.org/{}", focal.openalex);
        }
        let id = format!(
            "{}",
            uuid::Uuid::new_v5(
                &uuid::Uuid::NAMESPACE_URL,
                format!("{session}:{}", q.mode).as_bytes()
            )
        );
        let c = EvidenceSnapshot {
            id: id.clone(),
            provider: "OpenAlex".into(),
            direction: q.mode.clone(),
            focal: focal.clone(),
            captured_at: r.fetched_at.clone(),
            source_url: format!(
                "https://api.openalex.org/works?filter={}:{}",
                if q.mode == "citing" {
                    "cites"
                } else {
                    "cited_by"
                },
                q.term
            ),
            method: "OpenAlex API · controlled pagination".into(),
            coverage: "partial".into(),
            total: Some(r.count),
            raw: String::new(),
            error: String::new(),
            items: r.papers.clone(),
        };
        self.capture(c, q.page)?;
        let pages: Vec<u32> = {
            let mut stmt = self
                .db
                .prepare("SELECT page FROM evidence_pages WHERE snapshot_id=? ORDER BY page")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([&id], |r| r.get(0))
                .map_err(|e| e.to_string())?;
            rows.collect::<std::result::Result<_, _>>()
                .map_err(|e| e.to_string())?
        };
        let snapshots = self.evidence(&focal, &q.mode)?;
        let current = snapshots
            .iter()
            .find(|s| s.id == id)
            .ok_or("Cannot read discovery coverage.")?;
        let expected = current.total.unwrap_or(r.count).div_ceil(50).max(1) as u32;
        let complete = pages.len() == expected as usize
            && (1..=expected).all(|n| pages.contains(&n))
            && current.items.len() as u64 == current.total.unwrap_or(r.count);
        self.db
            .execute(
                "UPDATE evidence_snapshots SET coverage=?2 WHERE id=?1",
                params![id, if complete { "complete" } else { "partial" }],
            )
            .map_err(|e| e.to_string())?;
        self.db.execute("UPDATE papers SET metadata=json_set(metadata,'$.lastDiscovery',?1) WHERE openalex=?2",params![r.fetched_at,q.term]).map_err(|e|e.to_string())?;
        Ok(())
    }
    pub fn metadata_source(&self, id: &str, provider: &str, url: &str, p: &Paper) -> Result<()> {
        let bytes = serde_json::to_string(p).map_err(|e| e.to_string())?;
        self.db.execute("INSERT INTO metadata_sources VALUES(?1,?2,?3,?4,?5) ON CONFLICT(paper_id,provider,source_url) DO UPDATE SET captured_at=excluded.captured_at,metadata=excluded.metadata",params![id,provider,url,chrono::Utc::now().to_rfc3339(),bytes]).map_err(|e|e.to_string())?;
        Ok(())
    }
}
pub fn identified(p: &Paper) -> bool {
    !p.doi.is_empty() || !p.openalex.is_empty() || !p.ieee.is_empty()
}
pub fn distinct_count(papers: &[Paper]) -> usize {
    let mut keys = HashSet::new();
    for p in papers {
        keys.insert(if !p.doi.is_empty() {
            p.doi.clone()
        } else if !p.openalex.is_empty() {
            p.openalex.clone()
        } else if !p.ieee.is_empty() {
            p.ieee.clone()
        } else {
            p.id.clone()
        });
    }
    keys.len()
}
