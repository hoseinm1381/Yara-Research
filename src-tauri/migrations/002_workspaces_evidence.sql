ALTER TABLE papers ADD COLUMN ieee TEXT;
CREATE UNIQUE INDEX idx_paper_ieee ON papers(ieee) WHERE ieee IS NOT NULL;
CREATE TABLE workspace_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE metadata_sources (paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,provider TEXT NOT NULL,source_url TEXT NOT NULL,captured_at TEXT NOT NULL,metadata TEXT NOT NULL,PRIMARY KEY(paper_id,provider,source_url));
CREATE TABLE evidence_snapshots (id TEXT PRIMARY KEY,provider TEXT NOT NULL CHECK(provider IN ('OpenAlex','IEEE')),direction TEXT NOT NULL CHECK(direction IN ('citing','references')),focal TEXT NOT NULL,captured_at TEXT NOT NULL,source_url TEXT NOT NULL,method TEXT NOT NULL,coverage TEXT NOT NULL CHECK(coverage IN ('complete','partial','unknown','failed')),total INTEGER,raw TEXT NOT NULL,error TEXT NOT NULL);
CREATE INDEX idx_evidence_direction ON evidence_snapshots(direction,provider,captured_at);
CREATE TABLE evidence_pages (snapshot_id TEXT NOT NULL REFERENCES evidence_snapshots(id) ON DELETE CASCADE,page INTEGER NOT NULL,items TEXT NOT NULL,PRIMARY KEY(snapshot_id,page));
CREATE TABLE extension_receipts (request_id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,response TEXT NOT NULL,received_at TEXT NOT NULL);
PRAGMA user_version=2;
