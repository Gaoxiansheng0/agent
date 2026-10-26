import { Background, Controls, type Edge, Handle, type Node, type NodeProps, Position, ReactFlow } from "@xyflow/react";
import { useMemo } from "react";
import { findModel } from "../../shared/models";
import { type Graph, type GraphNode, kindLabels } from "../../shared/workflow";

type Data = { node: GraphNode };

function FlowNode({ data, selected }: NodeProps<Node<Data>>) {
  const n = data.node;
  const model = findModel(n.modelId);
  return (
    <div className={`fnode k-${n.kind} ${selected ? "sel" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <div className="fkind">
        {kindLabels[n.kind]}
        {model?.status === "pending" && <em className="badge warn">待确认</em>}
      </div>
      <div className="ftitle">{n.title}</div>
      {n.notes.length > 0 && <div className="fnote">⚠ {n.notes[0]}</div>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { flow: FlowNode };

export function GraphView(props: { graph: Graph; selected?: string; onSelect: (id?: string) => void }) {
  const nodes = useMemo<Node<Data>[]>(
    () =>
      props.graph.nodes.map((n) => ({
        id: n.id,
        type: "flow",
        position: n.position,
        data: { node: n },
        selected: n.id === props.selected,
      })),
    [props.graph, props.selected],
  );
  // Draw data wiring; execution order is the single chain the exports use.
  const edges = useMemo<Edge[]>(() => {
    const data = props.graph.nodes.flatMap((n) => n.inputs.map((src) => ({ id: `d-${src}-${n.id}`, source: src, target: n.id, animated: true })));
    const order = props.graph.edges
      .filter((e) => !data.some((d) => d.source === e.source && d.target === e.target))
      .map((e) => ({ id: `o-${e.source}-${e.target}`, ...e, style: { strokeDasharray: "4 4", opacity: 0.18 } }));
    return [...order, ...data];
  }, [props.graph]);
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, n) => props.onSelect(n.id)}
      onPaneClick={() => props.onSelect(undefined)}
      nodesConnectable={false}
      fitView
      minZoom={0.2}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={24} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
