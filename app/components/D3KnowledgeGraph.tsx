import * as d3 from "d3";
import * as React from "react";
import styled, { useTheme } from "styled-components";

/** A single node in the knowledge graph. */
export interface GraphNode {
  id: string;
  label?: string;
  group?: number;
  metadata?: Record<string, string | undefined>;
  // D3 simulation mutable fields
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

/** A directed edge between two nodes. */
export interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  label?: string;
}

interface Props {
  /** Node list – automatically sliced to first 200 entries. */
  nodes: GraphNode[];
  /** Edge list referencing node IDs. */
  links: GraphLink[];
  width?: number;
  height?: number;
}

const NODE_RADIUS = 14;
const MAX_NODES = 200;

const COLOR_SCALE = d3.scaleOrdinal(d3.schemeTableau10);

/**
 * Renders an interactive force-directed knowledge graph using D3.js.
 * Limits rendering to the first 200 nodes for performance, and shows
 * a metadata tooltip when the user clicks on a node.
 */
export function D3KnowledgeGraph({
  nodes: rawNodes,
  links: rawLinks,
  width = 800,
  height = 600,
}: Props) {
  const svgRef = React.useRef<SVGSVGElement>(null);
  const theme = useTheme();

  const [tooltip, setTooltip] = React.useState<{
    visible: boolean;
    x: number;
    y: number;
    node: GraphNode | null;
  }>({ visible: false, x: 0, y: 0, node: null });

  React.useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    // Hard cap at 200 nodes for browser performance
    const nodes: GraphNode[] = rawNodes.slice(0, MAX_NODES).map((n) => ({
      ...n,
    }));
    const nodeIds = new Set(nodes.map((n) => n.id));

    // Only keep links whose both endpoints are in the visible node set
    const links: GraphLink[] = rawLinks
      .filter((l) => {
        const src = typeof l.source === "string" ? l.source : l.source.id;
        const tgt = typeof l.target === "string" ? l.target : l.target.id;
        return nodeIds.has(src) && nodeIds.has(tgt);
      })
      .map((l) => ({ ...l }));

    // ── D3 Force Simulation ──────────────────────────────────────────────────
    const simulation = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<GraphNode, GraphLink>(links)
          .id((d) => d.id)
          .distance(80)
      )
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide(NODE_RADIUS + 4));

    // ── Container with zoom ──────────────────────────────────────────────────
    const container = svg
      .attr("width", width)
      .attr("height", height)
      .call(
        d3
          .zoom<SVGSVGElement, unknown>()
          .scaleExtent([0.3, 4])
          .on("zoom", (event) => {
            inner.attr("transform", event.transform);
          })
      )
      .on("click", () => {
        setTooltip({ visible: false, x: 0, y: 0, node: null });
      });

    const inner = container.append("g");

    // Arrow marker
    svg
      .append("defs")
      .append("marker")
      .attr("id", "arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", NODE_RADIUS + 8)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", theme.textTertiary);

    // ── Edges ────────────────────────────────────────────────────────────────
    const link = inner
      .append("g")
      .attr("class", "links")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", theme.textTertiary)
      .attr("stroke-opacity", 0.5)
      .attr("stroke-width", 1.5)
      .attr("marker-end", "url(#arrow)");

    // ── Nodes ────────────────────────────────────────────────────────────────
    const nodeGroup = inner
      .append("g")
      .attr("class", "nodes")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .attr("cursor", "pointer")
      .call(
        d3
          .drag<SVGGElement, GraphNode>()
          .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      )
      .on("click", (event: MouseEvent, d: GraphNode) => {
        event.stopPropagation();
        const svgRect = svgRef.current!.getBoundingClientRect();
        setTooltip({
          visible: true,
          x: event.clientX - svgRect.left,
          y: event.clientY - svgRect.top,
          node: d,
        });
      });

    nodeGroup
      .append("circle")
      .attr("r", NODE_RADIUS)
      .attr("fill", (d) => COLOR_SCALE(String(d.group ?? 0)))
      .attr("stroke", theme.background)
      .attr("stroke-width", 2);

    nodeGroup
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .attr("font-size", "10px")
      .attr("fill", "white")
      .attr("pointer-events", "none")
      .text((d) => (d.label ?? d.id).substring(0, 8));

    // ── Simulation tick ──────────────────────────────────────────────────────
    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as GraphNode).x!)
        .attr("y1", (d) => (d.source as GraphNode).y!)
        .attr("x2", (d) => (d.target as GraphNode).x!)
        .attr("y2", (d) => (d.target as GraphNode).y!);

      nodeGroup.attr(
        "transform",
        (d) => `translate(${d.x!},${d.y!})`
      );
    });

    return () => {
      simulation.stop();
    };
  }, [rawNodes, rawLinks, width, height, theme]);

  return (
    <Wrapper>
      <svg ref={svgRef} style={{ width: "100%", height }} />

      {tooltip.visible && tooltip.node && (
        <Tooltip style={{ left: tooltip.x + 16, top: tooltip.y }}>
          <TooltipTitle>{tooltip.node.label ?? tooltip.node.id}</TooltipTitle>
          {tooltip.node.metadata &&
            Object.entries(tooltip.node.metadata).map(([k, v]) => (
              <TooltipRow key={k}>
                <TooltipKey>{k}:</TooltipKey> {v}
              </TooltipRow>
            ))}
          {!tooltip.node.metadata && (
            <TooltipRow>No metadata available.</TooltipRow>
          )}
        </Tooltip>
      )}
    </Wrapper>
  );
}

const Wrapper = styled.div`
  position: relative;
  width: 100%;
  background: ${(props) => props.theme.backgroundTertiary};
  border-radius: 8px;
  overflow: hidden;
`;

const Tooltip = styled.div`
  position: absolute;
  background: ${(props) => props.theme.tooltipBackground};
  color: ${(props) => props.theme.tooltipText};
  border: 1px solid ${(props) => props.theme.divider};
  border-radius: 6px;
  padding: 12px 16px;
  min-width: 200px;
  max-width: 320px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  pointer-events: none;
  z-index: 10;
  font-size: 13px;
`;

const TooltipTitle = styled.div`
  font-weight: 600;
  margin-bottom: 8px;
  font-size: 14px;
`;

const TooltipRow = styled.div`
  margin-bottom: 4px;
  line-height: 1.5;
  word-break: break-word;
`;

const TooltipKey = styled.span`
  font-weight: 500;
  opacity: 0.7;
`;

export default D3KnowledgeGraph;
