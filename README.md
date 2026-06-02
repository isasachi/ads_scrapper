# Deployable stack: OpenClaw + FastAPI + Supabase + Next.js

## Qué incluye

- `runner/` → servicio Node que usa `@openclaw/sdk` para ejecutar agentes OpenClaw
- `backend/` → FastAPI que orquesta el pipeline y guarda en Supabase
- `frontend/` → Next.js para lanzar búsquedas y ver resultados
- `docker-compose.yml` → stack local o VPS

## Flujo

1. El usuario escribe una consulta en Next.js.
2. Next.js llama a `POST /api/research/run` en FastAPI.
3. FastAPI llama al runner Node.
4. El runner ejecuta en OpenClaw:
   - `seed-generator`
   - `scraper-core`
   - `evaluator-agent`
5. FastAPI persiste en Supabase.
6. Next.js muestra resultados.

---

## Despliegue local rápido

### 1) Requisitos
- Docker + Docker Compose
- OpenClaw corriendo en la misma máquina
- Supabase project creado
- Los 3 agentes ya configurados en OpenClaw

### 2) Variables de entorno
```bash
cd deployable
cp .env.example .env
```

Edita `.env` con:
- `OPENCLAW_GATEWAY_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### 3) Crear tablas en Supabase
Ejecuta el SQL de:
- `../integration/supabase_schema.sql`

### 4) Levantar stack
```bash
docker compose up --build -d
```

### 5) Abrir servicios
- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8000/docs`
- Runner: `http://localhost:3001/health`

---

## Despliegue en VPS

### Opción simple
En una VM Ubuntu:

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin
sudo usermod -aG docker $USER
# relogin
```

Clona tu repo, configura `.env`, y luego:

```bash
docker compose up --build -d
```

### Reverse proxy con Nginx
Ejemplo:
- `app.tudominio.com` -> frontend:3000
- `api.tudominio.com` -> backend:8000

### Nginx sample
```nginx
server {
  server_name app.tudominio.com;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}

server {
  server_name api.tudominio.com;
  location / {
    proxy_pass http://127.0.0.1:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

Luego HTTPS con Let's Encrypt.

---

## Despliegue por piezas

### Frontend -> Vercel
Puedes subir `frontend/` a Vercel.
Configura:
- `NEXT_PUBLIC_API_BASE=https://api.tudominio.com`

### Backend -> Railway / Render / Fly.io / VPS
Sube `backend/` como servicio Python.
Necesita acceso a:
- `RUNNER_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### Runner -> VPS o mismo host que OpenClaw
Este servicio debe tener acceso al Gateway de OpenClaw.
Por eso conviene deployarlo en la misma máquina donde corre OpenClaw.

---

## Recomendación real de producción

- **OpenClaw + runner Node**: mismo host
- **FastAPI**: mismo host o contenedor vecino
- **Frontend Next.js**: Vercel o contenedor
- **Supabase**: gestionado

Así reduces latencia y evitas problemas de red contra el Gateway.

---

## Variables importantes

### Runner
- `OPENCLAW_GATEWAY_URL`
- `OPENCLAW_GATEWAY_TOKEN`

### Backend
- `RUNNER_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CORS_ORIGINS`

### Frontend
- `NEXT_PUBLIC_API_BASE`

---

## Cómo probar

### Healthchecks
```bash
curl http://localhost:3001/health
curl http://localhost:8000/health
```

### Pipeline completo
```bash
curl -X POST http://localhost:8000/api/research/run \
  -H 'Content-Type: application/json' \
  -d '{"query":"gadgets para cocina"}'
```

---

## Siguiente mejora que te recomiendo

1. agregar auth para usuarios
2. separar corridas síncronas vs asíncronas
3. guardar logs por etapa
4. meter cola (Redis / QStash / Celery)
5. agregar polling o websockets en frontend
