"use client";

import { useState } from "react";

type Winner = {
  meta_ad_id: string;
  page_name: string;
  origin_country: string;
  suggested_angle: string;
  localization_hook: string;
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
    <main style={{ maxWidth: 1000, margin: "40px auto", padding: 20, fontFamily: "Arial, sans-serif" }}>
      <h1>Meta Winner Finder</h1>
      <p>Pipeline completo: seed-generator → scraper-core → evaluator-agent</p>

      <form onSubmit={runPipeline} style={{ display: "grid", gap: 12, marginTop: 20 }}>
        <textarea
          rows={4}
          placeholder="Ej: gadgets para cocina, mascotas, o sorpréndeme"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ padding: 12 }}
        />
        <button type="submit" disabled={loading} style={{ padding: 12 }}>
          {loading ? "Procesando..." : "Ejecutar pipeline"}
        </button>
      </form>

      {seed && (
        <section style={{ marginTop: 24 }}>
          <h2>Seed generado</h2>
          <pre style={{ background: "#f5f5f5", padding: 12, overflow: "auto" }}>{JSON.stringify(seed, null, 2)}</pre>
        </section>
      )}

      <section style={{ marginTop: 24 }}>
        <h2>Resultados</h2>
        <div style={{ display: "grid", gap: 12 }}>
          {results.map((item) => (
            <div key={item.meta_ad_id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16 }}>
              <div><strong>{item.page_name}</strong></div>
              <div>País: {item.origin_country}</div>
              <div>Ángulo: {item.suggested_angle}</div>
              <div>Hook local: {item.localization_hook}</div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
