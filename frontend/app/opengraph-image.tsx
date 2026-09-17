import { ImageResponse } from "next/og";

// Social-share card, generated at build time — no static asset to keep in
// sync. Dark slate ground with an abstract node-and-edge motif echoing
// the knowledge graph itself.
export const alt = "EIB Knowledge Graph — financial news as a graph";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  const nodes: Array<[number, number, number, string]> = [
    [920, 140, 26, "#34d399"],
    [1050, 260, 16, "#38bdf8"],
    [860, 330, 20, "#a78bfa"],
    [1000, 430, 14, "#f59e0b"],
    [780, 480, 12, "#38bdf8"],
    [1105, 480, 18, "#34d399"],
  ];
  const edges: Array<[number, number]> = [
    [0, 1],
    [0, 2],
    [1, 3],
    [2, 3],
    [2, 4],
    [3, 5],
    [1, 5],
  ];
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "72px 80px",
          background: "linear-gradient(135deg, #0b1220 0%, #111827 100%)",
          color: "#f8fafc",
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        <svg
          width="1200"
          height="630"
          style={{ position: "absolute", top: 0, left: 0 }}
        >
          {edges.map(([a, b], i) => (
            <line
              key={i}
              x1={nodes[a][0]}
              y1={nodes[a][1]}
              x2={nodes[b][0]}
              y2={nodes[b][1]}
              stroke="#475569"
              strokeWidth={2}
            />
          ))}
          {nodes.map(([x, y, r, c], i) => (
            <circle key={i} cx={x} cy={y} r={r} fill={c} opacity={0.9} />
          ))}
        </svg>
        <div
          style={{
            display: "flex",
            fontSize: 30,
            color: "#94a3b8",
            letterSpacing: 6,
            textTransform: "uppercase",
          }}
        >
          Columbia IEOR × European Investment Bank
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 84,
            fontWeight: 700,
            marginTop: 18,
            lineHeight: 1.05,
          }}
        >
          EIB Knowledge Graph
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 34,
            color: "#cbd5e1",
            marginTop: 26,
            maxWidth: 700,
            lineHeight: 1.35,
          }}
        >
          15 years of financial news, read by LLMs into a living graph — with
          neural link predictions and a news factor model.
        </div>
      </div>
    ),
    { ...size }
  );
}
