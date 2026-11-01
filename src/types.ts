export const statuses = [
  "core",
  "candidate",
  "unreviewed",
  "read",
  "archived",
  "rejected",
] as const;
export type Status = (typeof statuses)[number];
export const labels: Record<Status, string> = {
  core: "Core",
  candidate: "Candidate",
  unreviewed: "Unreviewed",
  read: "Read",
  archived: "Archived",
  rejected: "Rejected",
};
export interface Paper {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  doi: string;
  openalex: string;
  ieee: string;
  abstract: string;
  journal: string;
  publisher: string;
  url: string;
  publicationDate: string;
  citationCount: number | null;
  status: Status;
  tags: string[];
  keywords: string[];
  summary: string;
  strengths: string;
  weaknesses: string;
  findings: string;
  relevance: string;
  tasks: string;
  raw: string;
  source: string;
  references: string[];
  x: number;
  y: number;
  pinned: boolean;
  hidden: boolean;
  hasNote: boolean;
  createdAt: string;
  updatedAt: string;
  lastDiscovery: string;
}
export interface Citation {
  citing: string;
  cited: string;
  source: string;
  verified: boolean;
  createdAt: string;
}
export interface Snapshot {
  papers: Paper[];
  citations: Citation[];
  settings: Record<string, string>;
  root: string;
  workspace: Workspace;
}
export interface Note {
  content: string;
  revision: string;
  exists: boolean;
}
export interface DiscoveryQuery {
  mode: "search" | "citing" | "references" | "both" | "ids";
  term: string;
  page: number;
  refresh: boolean;
  sessionId?: string;
}
export interface DiscoveryResult {
  papers: Paper[];
  count: number;
  page: number;
  more: boolean;
  cached: boolean;
  fetchedAt: string;
  stale?: boolean;
  refreshError?: string | null;
}
export interface Workspace {
  id: string;
  name: string;
  paperCount: number;
  active: boolean;
}
export interface EvidenceSnapshot {
  id: string;
  provider: "OpenAlex" | "IEEE";
  direction: "citing" | "references";
  focal: Paper;
  capturedAt: string;
  sourceUrl: string;
  method: string;
  coverage: "complete" | "partial" | "unknown" | "failed";
  total: number | null;
  raw: string;
  error: string;
  items: Paper[];
}
export function newPaper(values: Partial<Paper> = {}): Paper {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "",
    authors: [],
    year: null,
    doi: "",
    openalex: "",
    ieee: "",
    abstract: "",
    journal: "",
    publisher: "",
    url: "",
    publicationDate: "",
    citationCount: null,
    status: "unreviewed",
    tags: [],
    keywords: [],
    summary: "",
    strengths: "",
    weaknesses: "",
    findings: "",
    relevance: "",
    tasks: "",
    raw: "",
    source: "manual",
    references: [],
    x: 0,
    y: 0,
    pinned: false,
    hidden: false,
    hasNote: false,
    createdAt: now,
    updatedAt: now,
    lastDiscovery: "",
    ...values,
  };
}
