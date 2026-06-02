"use client";

import { useState } from "react";

type Winner = {
  meta_ad_id: string;
  page_name: string;
  origin_country: string;
  suggested_angle: string;
  localization_hook: string;
};

const GRADIENT = "linear-gradient(90deg, rgb(255, 155, 74), rgb(255, 106, 0))";
const DARK_CARD = "#111111";
const BORDER = "rgba(255,255,255,0.08)";
const MUTED = "#6b7280";

const gradientText: React.CSSProperties = {
  background: GRADIENT,
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
  backgroundClip: "text",
};

export default function Page() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Winner[]>([]);
  const [seed, setSeed] = useState<any>(null);

  async function runPipeline(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE}/api/research/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      setSeed(data.seed || null);
      setResults(data.results || []);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        maxWidth: 960,
        margin: "0 auto",
        padding: "60px 24px 80px",
        position: "relative",
      }}
    >
      {/* Radial gradient background glow */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          top: 0,
          left: "50%",
          transform: "translateX(-50%)",
          width: 800,
          height: 400,
          background: `radial-gradient(60% 40% at 50% 0%, rgba(255,120,30,0.15) 0%, transparent 70%)`,
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      <div style={{ position: "relative", zIndex: 1 }}>
        {/* Header */}
        <header style={{ marginBottom: 48, textAlign: "center" }}>
          <p
            style={{
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              marginBottom: 12,
              ...gradientText,
            }}
          >
            JR Consulting
          </p>
          <h1
            style={{
              fontSize: "clamp(28px, 5vw, 42px)",
              fontWeight: 700,
              lineHeight: 1.2,
              margin: "0 0 16px",
              letterSpacing: "-0.02em",
            }}
          >
            Buscador de Anuncios Ganadores
          </h1>
          <p style={{ color: MUTED, fontSize: 16, margin: 0 }}>
            Descubre los mejores anuncios de Meta con análisis de inteligencia artificial
          </p>
        </header>

        {/* Search form */}
        <section
          style={{
            background: DARK_CARD,
            border: `1px solid ${BORDER}`,
            borderRadius: 16,
            padding: 24,
            marginBottom: 32,
          }}
        >
          <form onSubmit={runPipeline} style={{ display: "grid", gap: 16 }}>
            <label
              htmlFor="query"
              style={{ fontSize: 14, fontWeight: 500, color: "#d1d5db" }}
            >
              Nicho o categoría de producto
            </label>
            <textarea
              id="query"
              rows={4}
              placeholder="Ej: gadgets para cocina, mascotas, o sorpréndeme"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{
                padding: "12px 14px",
                background: "rgba(255,255,255,0.04)",
                border: `1px solid ${BORDER}`,
                borderRadius: 10,
                color: "#fff",
                fontSize: 15,
                fontFamily: "inherit",
                resize: "vertical",
                outline: "none",
                transition: "border-color 0.2s",
              }}
              onFocus={(e) => (e.target.style.borderColor = "rgb(255, 155, 74)")}
              onBlur={(e) => (e.target.style.borderColor = BORDER)}
            />
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: "13px 24px",
                background: loading ? "rgba(255,120,30,0.35)" : GRADIENT,
                color: "#fff",
                border: "none",
                borderRadius: 10,
                fontSize: 15,
                fontWeight: 600,
                cursor: loading ? "not-allowed" : "pointer",
                fontFamily: "inherit",
                transition: "opacity 0.2s",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              {loading ? (
                <>
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      border: "2px solid rgba(255,255,255,0.3)",
                      borderTopColor: "#fff",
                      borderRadius: "50%",
                      display: "inline-block",
                      animation: "spin 0.7s linear infinite",
                    }}
                  />
                  Procesando...
                </>
              ) : (
                "Analizar anuncios"
              )}
            </button>
          </form>
        </section>

        {/* Seed result */}
        {seed && (
          <section style={{ marginBottom: 32 }}>
            <h2
              style={{
                fontSize: 16,
                fontWeight: 600,
                marginBottom: 12,
                color: "#d1d5db",
                letterSpacing: "-0.01em",
              }}
            >
              Seed generado
            </h2>
            <pre
              style={{
                background: DARK_CARD,
                border: `1px solid ${BORDER}`,
                borderRadius: 12,
                padding: 16,
                overflow: "auto",
                fontSize: 13,
                color: "#9ca3af",
                margin: 0,
                fontFamily: "monospace",
              }}
            >
              {JSON.stringify(seed, null, 2)}
            </pre>
          </section>
        )}

        {/* Results */}
        {results.length > 0 && (
          <section>
            <h2
              style={{
                fontSize: 16,
                fontWeight: 600,
                marginBottom: 16,
                color: "#d1d5db",
                letterSpacing: "-0.01em",
              }}
            >
              Resultados —{" "}
              <span style={gradientText}>{results.length} anuncios</span>
            </h2>
            <div style={{ display: "grid", gap: 12 }}>
              {results.map((item) => (
                <article
                  key={item.meta_ad_id}
                  style={{
                    background: DARK_CARD,
                    border: `1px solid ${BORDER}`,
                    borderRadius: 14,
                    padding: "20px 22px",
                    display: "grid",
                    gap: 8,
                    transition: "border-color 0.2s",
                  }}
                  onMouseEnter={(e) =>
                    ((e.currentTarget as HTMLElement).style.borderColor =
                      "rgba(255,120,30,0.45)")
                  }
                  onMouseLeave={(e) =>
                    ((e.currentTarget as HTMLElement).style.borderColor = BORDER)
                  }
                >
                  <div style={{ fontWeight: 600, fontSize: 16 }}>{item.page_name}</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Tag label="País" value={item.origin_country} />
                  </div>
                  <div style={{ color: "#d1d5db", fontSize: 14, lineHeight: 1.5 }}>
                    <span style={{ color: MUTED, fontWeight: 500 }}>Ángulo: </span>
                    {item.suggested_angle}
                  </div>
                  <div style={{ color: "#d1d5db", fontSize: 14, lineHeight: 1.5 }}>
                    <span style={{ color: MUTED, fontWeight: 500 }}>Hook local: </span>
                    {item.localization_hook}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        * { box-sizing: border-box; }
      `}</style>
    </main>
  );
}

function Tag({ label, value }: { label: string; value: string }) {
  return (
    <span
      style={{
        fontSize: 12,
        fontWeight: 500,
        padding: "3px 10px",
        borderRadius: 6,
        background: "rgba(255,120,30,0.12)",
        color: "rgb(255, 155, 74)",
        border: "1px solid rgba(255,120,30,0.25)",
      }}
    >
      {label}: {value}
    </span>
  );
}
