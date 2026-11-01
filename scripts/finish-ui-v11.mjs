import fs from "node:fs";
let s = fs.readFileSync("src/App.tsx", "utf8");
const begin = s.indexOf("                <Graph ref={graphRef}"),
  end = s.indexOf("                {!visible.length", begin);
if (begin < 0 || end < 0) throw new Error("Graph anchors missing");
let graph = s
  .slice(begin, end)
  .replace("<Graph ref=", "<Graph key={snapshot.workspace.id} ref=");
s = s.slice(0, begin) + s.slice(end);
const condition = s.indexOf("            {!papers.length ?");
const close = s.indexOf(
  '            <footer className="canvas-footer">',
  condition,
);
s =
  s.slice(0, condition) +
  `            <div className="canvas-content"><div className="graph-stage" style={{visibility:papers.length&&view==='graph'?'visible':'hidden'}}>${graph}</div>\n` +
  s.slice(condition, close) +
  "            </div>\n" +
  s.slice(close);
s = s.replace('import { ReactFlowProvider } from "@xyflow/react";\n', "");
s = s.replace(
  /export function Root\(\) \{[\s\S]*$/,
  "export function Root(){return <App/>;}\n",
);
for (const name of [
  "BookOpen",
  "Star",
  "Bookmark",
  "Archive",
  "Settings2",
  "Sun",
  "Moon",
])
  s = s.replace(`  ${name},\n`, "");
const tagStart = s.indexOf("  const allTags = useMemo(");
const tagEnd = s.indexOf("  const matchesSearch", tagStart);
if (tagStart >= 0) s = s.slice(0, tagStart) + s.slice(tagEnd);
fs.writeFileSync("src/App.tsx", s);
