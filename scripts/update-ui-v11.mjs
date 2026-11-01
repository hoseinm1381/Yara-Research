import fs from "node:fs";
let s = fs.readFileSync("src/App.tsx", "utf8");
const replace = (a, b) => {
  if (!s.includes(a))
    throw new Error(`Missing update anchor: ${a.slice(0, 90)}`);
  s = s.replace(a, b);
};
replace(
  "import { Graph }",
  'import { WorkspaceSidebar } from "./components/WorkspaceSidebar";\nimport { ResizableInspector } from "./components/ResizableInspector";\nimport * as Menu from "@radix-ui/react-dropdown-menu";\nimport { Graph }',
);
replace("import type { Paper, Snapshot }", "import type { Paper, Snapshot }");
replace(
  "    [focusId, setFocusId] = useState<string | null>(null),\n    [focusTick, setFocusTick] = useState(0),",
  '    [coreId,setCoreId]=useState(""),\n    [collapsed,setCollapsed]=useState(false),\n    [inspectorWidth,setInspectorWidth]=useState(344),',
);
replace(
  "  const viewportTimer = useRef",
  '  const graphRef=useRef<import("./components/Graph").GraphHandle>(null);\n  const viewportTimer = useRef',
);
replace(
  '        setTheme(s.settings.theme || "dark");',
  '        setTheme(s.settings.theme || "dark");\n        setCollapsed(s.settings.sidebarCollapsed==="true");setInspectorWidth(Number(s.settings.inspectorWidth)||344);',
);
const begin = s.indexOf("      if (id === selected) {");
const end = s.indexOf("      if (id !== selected", begin);
s = s.slice(0, begin) + "      if(id===selected)return;\n" + s.slice(end);
s = s
  .replace(/\n\s*setFocusId\([^\n]+\);/g, "")
  .replace(/\n\s*setFocusTick\([^\n]+\);/g, "");
const sidebarStart = s.indexOf('      <aside className="sidebar">');
const sidebarEnd = s.indexOf('      <main className="main">', sidebarStart);
s =
  s.slice(0, sidebarStart) +
  `      <WorkspaceSidebar snapshot={snapshot} view={view} filters={filters} theme={theme} collapsed={collapsed} onCollapse={()=>{const next=!collapsed;setCollapsed(next);void backend.call('set_setting',{key:'sidebarCollapsed',value:String(next)}).catch(e=>notify(String(e)));}} onNavigate={(v,status,tag='')=>{setView(v);setFilters({...initialFilters,status,tag});}} onSettings={()=>{void canLeave().then(ok=>{if(ok)setModal({type:'settings'});});}} onTheme={()=>{const next=theme==='dark'?'light':'dark';setTheme(next);void backend.call('set_setting',{key:'theme',value:next}).catch(e=>notify(String(e)));}} onSwitch={switchWorkspace} onChanged={async()=>{await reload();}}/>\n` +
  s.slice(sidebarEnd);
const crumbStart = s.indexOf('          <div className="breadcrumb">');
const crumbEnd = s.indexOf(
  '          <div className="global-search">',
  crumbStart,
);
s = s.slice(0, crumbStart) + s.slice(crumbEnd);
const addStart = s.indexOf(
  '          <button\n            className="primary"',
  s.indexOf('<header className="topbar">'),
);
const addEnd = s.indexOf("        </header>", addStart);
s =
  s.slice(0, addStart) +
  `          <Menu.Root><Menu.Trigger asChild><button className="primary" aria-label="Add Paper" aria-haspopup="menu"><Plus size={16}/>Add Paper<ChevronDown size={13}/></button></Menu.Trigger><Menu.Portal><Menu.Content className="context-menu add-paper-menu" align="end" collisionPadding={8}><Menu.Item onSelect={()=>setModal({type:'paper',paper:newPaper({x:papers.length%4*380,y:Math.floor(papers.length/4)*210})})}><Plus size={15}/>Add Paper Manually</Menu.Item><Menu.Item onSelect={()=>setModal({type:'discovery',mode:'search'})}><Search size={15}/>Discover Papers</Menu.Item><Menu.Item onSelect={()=>setModal({type:'paste'})}><ClipboardPaste size={15}/>Import from Text</Menu.Item></Menu.Content></Menu.Portal></Menu.Root>\n` +
  s.slice(addEnd);
const heading = s.indexOf('        <div className="workspace-heading">');
const headingEnd = s.indexOf(
  '        <div className="workspace-body">',
  heading,
);
s = s.slice(0, heading) + s.slice(headingEnd);
replace(
  'papers.some((p) => p.id === focusId && p.status === "core")',
  'papers.some((p) => p.id === coreId && p.status === "core")',
);
replace("? focusId!", "? coreId");
replace(
  "onChange={(e) => e.target.value && select(e.target.value)}",
  "onChange={(e) => {setCoreId(e.target.value);if(e.target.value)void select(e.target.value);}}",
);
replace("Focus a core paper", "Select a core paper");
const graphStart = s.indexOf("                <Graph");
const graphEnd = s.indexOf("                {!visible.length", graphStart);
if (graphStart < 0 || graphEnd < 0) throw new Error("Missing graph block");
// The graph stays mounted in library and empty views so routine navigation never restores or resets its viewport.
const graphBlock = s
  .slice(graphStart, graphEnd)
  .replace("                <Graph", "                <Graph ref={graphRef}")
  .replace(/\n\s*focusId=\{focusId\}/, "")
  .replace(/\n\s*focusTick=\{focusTick\}/, "");
s = s.slice(0, graphStart) + graphBlock + s.slice(graphEnd);
replace(
  "            <Inspector",
  "            <ResizableInspector savedWidth={inspectorWidth} onSave={saveInspectorWidth}><Inspector",
);
s = s.replace(
  /onFocus=\{\(\) => \{\s*\}\}/,
  "onFocus={()=>graphRef.current?.focus(paper.id)}",
);
// Find the inspector's closing tag without depending on its callbacks' formatting.
const inspector = s.indexOf("<ResizableInspector");
const inspectorClose = s.indexOf("            />", inspector);
if (inspectorClose < 0) throw new Error("No inspector closing tag");
s =
  s.slice(0, inspectorClose) +
  s
    .slice(inspectorClose)
    .replace("            />", "            /></ResizableInspector>");
s = s.replace(
  '<span className="muted">1.0</span>',
  '<span className="muted">1.1.0</span>',
);
const beforeReturn = s.indexOf("  if (!snapshot)");
s =
  s.slice(0, beforeReturn) +
  `  const saveInspectorWidth=useCallback((width:number)=>{setInspectorWidth(width);void backend.call('set_setting',{key:'inspectorWidth',value:String(width)}).catch(e=>notify(String(e)));},[notify]);
  async function switchWorkspace(id:string){if(!await canLeave())return;clearTimeout(viewportTimer.current);const next=await backend.call<Snapshot>('switch_workspace',{id});setSelected(null);setDirty(false);setModal(null);setCoreId('');setFilters(initialFilters);setSnapshot(next);setTheme(next.settings.theme||'dark');setCollapsed(next.settings.sidebarCollapsed==='true');setInspectorWidth(Number(next.settings.inspectorWidth)||344);try{setInitialViewport(JSON.parse(next.settings.viewport||'null')||undefined);}catch{setInitialViewport(undefined);}}
  useEffect(()=>{let last='';let disposed=false;const poll=async()=>{try{const rev=await backend.call<string>('workspace_revision');if(last&&last!==rev&&!disposed)await reload();last=rev;}catch(e){if(!disposed)notify(String(e));}};void poll();const timer=setInterval(()=>void poll(),2500);return ()=>{disposed=true;clearInterval(timer);};},[reload,notify]);
` +
  s.slice(beforeReturn);
// Removed icons are deliberately checked by TypeScript afterwards.
fs.writeFileSync("src/App.tsx", s);
