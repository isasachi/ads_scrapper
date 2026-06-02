from __future__ import annotations

import json
import os
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import Client, create_client

RUNNER_URL = os.getenv("RUNNER_URL", "http://runner:3001")
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
CORS_ORIGINS = [x.strip().rstrip("/") for x in os.getenv("CORS_ORIGINS", "*").split(",") if x.strip()]

app = FastAPI(title="Research Pipeline API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS if CORS_ORIGINS != ["*"] else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

supabase: Client | None = None
if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


class QueryRequest(BaseModel):
    query: str = ""


class SeedRequest(BaseModel):
    keywords: list[str]
    countries: list[str]


class EvaluateRequest(BaseModel):
    ads: list[dict[str, Any]]


async def run_agent(agent_id: str, payload: Any) -> Any:
    async with httpx.AsyncClient(timeout=180) as client:
        res = await client.post(
            f"{RUNNER_URL}/run-agent",
            json={"agentId": agent_id, "input": payload},
        )
        res.raise_for_status()
        body = res.json()
        if not body.get("ok"):
            raise HTTPException(status_code=500, detail=body)
        return body["data"]


@app.get("/health")
async def health() -> dict[str, str]:
    return {"ok": "true"}


@app.post("/api/research/seed")
async def research_seed(req: QueryRequest) -> dict[str, Any]:
    data = await run_agent("seed-generator", req.query)
    return {"ok": True, "data": data}


@app.post("/api/research/scrape")
async def research_scrape(req: SeedRequest) -> dict[str, Any]:
    data = await run_agent("scraper-core", req.model_dump())
    return {"ok": True, "data": data}


@app.post("/api/research/evaluate")
async def research_evaluate(req: EvaluateRequest) -> dict[str, Any]:
    data = await run_agent("evaluator-agent", req.ads)
    return {"ok": True, "data": data}


@app.post("/api/research/run")
async def research_run(req: QueryRequest) -> dict[str, Any]:
    seed = await run_agent("seed-generator", req.query)
    scraped = await run_agent("scraper-core", seed)
    evaluated = await run_agent("evaluator-agent", scraped)

    run_id = None
    if supabase:
        inserted = supabase.table("research_runs").insert({
            "query": req.query,
            "seed_output": seed,
            "scraper_output": scraped,
            "evaluator_output": evaluated,
            "status": "completed",
        }).execute()
        rows = inserted.data or []
        if rows:
            run_id = rows[0]["id"]

        for ad in scraped:
            supabase.table("ads_raw").upsert({
                "meta_ad_id": ad["meta_ad_id"],
                "payload": ad,
                "origin_country": ad.get("origin_country"),
                "ad_start_date": ad.get("ad_start_date"),
            }).execute()

        for winner in evaluated:
            supabase.table("ads_winners").upsert({**winner, "run_id": run_id}).execute()

    return {
        "ok": True,
        "run_id": run_id,
        "seed": seed,
        "scraped_count": len(scraped),
        "evaluated_count": len(evaluated),
        "results": evaluated,
    }


@app.get("/api/research/results")
async def research_results() -> dict[str, Any]:
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase no configurado")
    rows = supabase.table("ads_winners").select("*").order("created_at", desc=True).execute()
    return {"ok": True, "data": rows.data}


@app.get("/api/research/runs/{run_id}")
async def research_run_detail(run_id: str) -> dict[str, Any]:
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase no configurado")
    rows = supabase.table("research_runs").select("*").eq("id", run_id).limit(1).execute()
    if not rows.data:
        raise HTTPException(status_code=404, detail="Run no encontrado")
    return {"ok": True, "data": rows.data[0]}
