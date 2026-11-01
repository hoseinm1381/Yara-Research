import {
  memo,
  useCallback,
  useMemo,
  useState,
  useImperativeHandle,
} from "react";
import type { Ref, ComponentProps } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  applyNodeChanges,
  useReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import type { Node, NodeProps, NodeChange, Connection } from "@xyflow/react";
import {
  Pin,
  FileText,
  ArrowUpRight,
  Star,
  Maximize,
  RotateCcw,
  Network,
} from "lucide-react";
import * as Menu from "@radix-ui/react-context-menu";
import type { Paper, Citation, Status } from "../types";
import { labels, statuses } from "../types";
type PaperNode = Node<
  {
    paper: Paper;
    select: () => void;
    explore: () => void;
    status: (s: Status) => void;
    pin: () => void;
  },
  "paper"
>;
const colors: Record<Status, string> = {
  core: "#a78bfa",
  candidate: "#efab65",
  unreviewed: "#81a9ef",
  read: "#70c6a4",
  archived: "#8d94a4",
  rejected: "#db8c95",
};
const PaperCard = memo(function PaperCard({
  data,
  selected,
}: NodeProps<PaperNode>) {
  const p = data.paper;
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <article
          className={`paper-node ${p.status} ${selected ? "is-selected" : ""}`}
          data-testid="paper-node"
        >
          <Handle type="source" position={Position.Left} id="out" />
          <Handle type="target" position={Position.Right} id="in" />
          <div className="node-top">
            <span className={`status-dot ${p.status}`} />
            <span>{labels[p.status]}</span>
            <span className="node-year">{p.year ?? "—"}</span>
            {p.pinned && <Pin size={12} aria-label="Pinned" />}
          </div>
          <h3 dir="auto">{p.title}</h3>
          <p>
            {p.authors[0] || "Author not recorded"}
            {p.authors.length > 1 ? " et al." : ""}
          </p>
          <div className="node-bottom">
            <span>
              {p.status === "core" ? (
                <>
                  <Star size={11} />
                  Core paper
                </>
              ) : (
                p.journal || "Research paper"
              )}
            </span>
            <div>
              {p.hasNote && <FileText size={12} aria-label="Has notes" />}
              <button
                className="nodrag"
                title="Explore citations"
                aria-label={`Explore ${p.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  data.select();
                  data.explore();
                }}
              >
                <ArrowUpRight size={15} />
              </button>
            </div>
          </div>
        </article>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="context-menu">
          <Menu.Label>Research status</Menu.Label>
          {statuses.map((s) => (
            <Menu.Item key={s} onSelect={() => data.status(s)}>
              <span className={`status-dot ${s}`} />
              {labels[s]}
            </Menu.Item>
          ))}
          <Menu.Separator />
          <Menu.Item onSelect={data.pin}>
            <Pin size={13} />
            {p.pinned ? "Unpin position" : "Pin position"}
          </Menu.Item>
          <Menu.Item onSelect={data.explore}>
            <Network size={13} />
            Explore citations
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
});
const nodeTypes = { paper: PaperCard };
export interface GraphHandle {
  focus: (id: string) => void;
}
function GraphCanvas({
  papers,
  citations,
  selected,
  onSelect,
  onExplore,
  onUpdate,
  onPosition,
  onConnect,
  onViewport,
  viewport,
  ref,
  theme,
}: {
  papers: Paper[];
  citations: Citation[];
  selected: string | null;
  onSelect: (id: string) => void;
  onExplore: (id: string) => void;
  onUpdate: (p: Paper) => Promise<void>;
  onPosition: (id: string, x: number, y: number) => void;
  onConnect: (c: Connection) => void;
  onViewport: (v: { x: number; y: number; zoom: number }) => void;
  viewport?: { x: number; y: number; zoom: number };
  ref?: Ref<GraphHandle>;
  theme: string;
}) {
  const flow = useReactFlow();
  const base = useMemo<PaperNode[]>(
    () =>
      papers.map((p) => ({
        id: p.id,
        type: "paper",
        position: { x: p.x, y: p.y },
        selected: p.id === selected,
        draggable: true,
        data: {
          paper: p,
          select: () => onSelect(p.id),
          explore: () => onExplore(p.id),
          status: (s) => void onUpdate({ ...p, status: s }),
          pin: () => void onUpdate({ ...p, pinned: !p.pinned }),
        },
      })),
    [papers, selected, onSelect, onExplore, onUpdate],
  );
  const [nodes, setNodes] = useState(base);
  const [previous, setPrevious] = useState(base);
  if (previous !== base) {
    setPrevious(base);
    setNodes(base);
  }
  const onChanges = useCallback(
    (changes: NodeChange<PaperNode>[]) =>
      setNodes((n) => applyNodeChanges(changes, n)),
    [],
  );
  const edges = useMemo(() => {
    const ids = new Set(papers.map((p) => p.id));
    return citations
      .filter((c) => ids.has(c.citing) && ids.has(c.cited))
      .map((c) => ({
        id: `${c.citing}-${c.cited}`,
        source: c.citing,
        target: c.cited,
        sourceHandle: "out",
        targetHandle: "in",
        type: "default",
        markerEnd: { type: MarkerType.ArrowClosed, width: 17, height: 17 },
        className: c.verified ? "verified" : "manual",
        style: {
          stroke: c.verified ? "#666279" : "#777d91",
          strokeWidth: 1.4,
          strokeDasharray: c.verified ? undefined : "5 4",
        },
        label: undefined,
        data: { source: c.source },
        ariaLabel: `${papers.find((p) => p.id === c.citing)?.title} cites ${papers.find((p) => p.id === c.cited)?.title}`,
      }));
  }, [papers, citations]);
  useImperativeHandle(
    ref,
    () => ({
      focus(id: string) {
        const node = flow.getNode(id);
        if (node)
          void flow.setCenter(node.position.x + 150, node.position.y + 80, {
            zoom: 0.9,
            duration: 350,
          });
      },
    }),
    [flow],
  );
  return (
    <div className="graph-container">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onChanges}
        onNodeClick={(_, n) => onSelect(n.id)}
        onNodeDragStop={(_, n) => onPosition(n.id, n.position.x, n.position.y)}
        onConnect={onConnect}
        defaultViewport={viewport ?? { x: 80, y: 80, zoom: 0.8 }}
        minZoom={0.12}
        maxZoom={2}
        onMoveEnd={(_, v) => onViewport(v)}
        colorMode={theme === "light" ? "light" : "dark"}
        onlyRenderVisibleElements
        deleteKeyCode={null}
        connectionRadius={30}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          color={theme === "light" ? "#d2d1dc" : "#30323f"}
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
        />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(n) => colors[(n.data as PaperNode["data"]).paper.status]}
          maskColor={theme === "light" ? "#f5f5fa99" : "#12141ba0"}
          pannable
          zoomable
        />
      </ReactFlow>
      <div className="canvas-direction">
        <span>← REFERENCED WORK</span>
        <span>CITING WORK →</span>
      </div>
      <div className="graph-floating-tools">
        <button
          title="Fit graph to view"
          onClick={() => void flow.fitView({ padding: 0.2, duration: 400 })}
        >
          <Maximize size={15} />
        </button>
        <button
          title="Reset viewport"
          onClick={() =>
            void flow.setViewport(
              { x: 200, y: 180, zoom: 0.8 },
              { duration: 350 },
            )
          }
        >
          <RotateCcw size={15} />
        </button>
      </div>
      <div className="canvas-caption">
        Drag to explore · Scroll to zoom · Arrows point from citing to cited
      </div>
    </div>
  );
}
export function Graph(props: ComponentProps<typeof GraphCanvas>) {
  return (
    <ReactFlowProvider>
      <GraphCanvas {...props} />
    </ReactFlowProvider>
  );
}
