PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS papers (
 id TEXT PRIMARY KEY, doi TEXT UNIQUE, openalex TEXT UNIQUE, title TEXT NOT NULL CHECK(length(trim(title))>0),
 status TEXT NOT NULL CHECK(status IN ('core','candidate','unreviewed','read','archived','rejected')),
 metadata TEXT NOT NULL CHECK(json_valid(metadata))
);
CREATE INDEX IF NOT EXISTS idx_paper_status ON papers(status);
CREATE INDEX IF NOT EXISTS idx_paper_title ON papers(title COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS layout (paper_id TEXT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE, x REAL NOT NULL, y REAL NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS citations (
 citing TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE, cited TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
 source TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
 PRIMARY KEY(citing,cited), CHECK(citing<>cited)
);
CREATE INDEX IF NOT EXISTS idx_cited ON citations(cited);
CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS paper_tags (paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE, tag_id INTEGER NOT NULL REFERENCES tags(id), PRIMARY KEY(paper_id,tag_id));
CREATE TABLE IF NOT EXISTS notes (paper_id TEXT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE, path TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS discovery_cache (query TEXT PRIMARY KEY, response TEXT NOT NULL, fetched_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
PRAGMA user_version=1;
