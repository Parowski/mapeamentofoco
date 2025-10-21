import os
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import JSONResponse
from starlette.requests import Request
from dotenv import load_dotenv
from pydantic import BaseModel

load_dotenv()

FOCO_BASE_URL = os.getenv("FOCO_BASE_URL", "https://hlg-gateway.sebrae.com.br/foco-stg")
FOCO_LOGIN_URL = os.getenv("FOCO_LOGIN_URL", "https://hlg-gateway.sebrae.com.br/foco-stg/services/oauth2/token")
FOCO_CLIENT_ID = os.getenv("FOCO_CLIENT_ID")
FOCO_CLIENT_SECRET = os.getenv("FOCO_CLIENT_SECRET")
FOCO_USERNAME = os.getenv("FOCO_USERNAME")
FOCO_PASSWORD = os.getenv("FOCO_PASSWORD")
FOCO_SECURITY_TOKEN = os.getenv("FOCO_SECURITY_TOKEN", "")
FOCO_API_VERSION = os.getenv("FOCO_API_VERSION", "62.0")
FOCO_GRANT_TYPE = os.getenv("FOCO_GRANT_TYPE", "client_credentials")
FOCO_DOCS_URL = os.getenv(
    "FOCO_DOCS_URL",
    "https://anypoint.mulesoft.com/exchange/portals/sebrae-2/a7bc5ec0-9afc-42bf-bc65-96a43cd68385/mapeamento-sas-x-foco/minor/1.0/console/summary/",
)

class ConfigUpdate(BaseModel):
    base_url: Optional[str] = None
    login_url: Optional[str] = None
    api_version: Optional[str] = None
    client_id: Optional[str] = None
    client_secret: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    security_token: Optional[str] = None
    grant_type: Optional[str] = None

class FOCOClient:
    def __init__(self, base_url: str, login_url: str, client_id: str, client_secret: str, username: str, password: str, security_token: str, api_version: str, grant_type: str = "password"):
        # Sanitiza e normaliza URLs e grant_type
        self.base_url = (base_url or "").strip().strip('`"').rstrip("/")
        _login = (login_url or "").strip().strip('`"')
        self.login_url = _login.rstrip("/")
        self.client_id = client_id
        self.client_secret = client_secret
        self.username = username
        self.password = password
        self.security_token = security_token
        self.api_version = api_version
        self.grant_type = (grant_type or "password").strip().lower()
        self.access_token: Optional[str] = None
        self.instance_url: Optional[str] = None

    async def login(self) -> str:
        if self.grant_type == "client_credentials":
            data = {
                "grant_type": "client_credentials",
                "client_id": self.client_id,
                "client_secret": self.client_secret,
            }
        else:
            data = {
                "grant_type": "password",
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "username": self.username,
                "password": f"{self.password}{self.security_token}",
            }
        async with httpx.AsyncClient(timeout=30) as client:
            # 1) POST com corpo x-www-form-urlencoded
            resp = await client.post(self.login_url, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"})
            # 2) Fallback: POST com querystring (alguns gateways exigem este formato)
            if resp.status_code >= 400:
                try:
                    resp = await client.post(self.login_url, params=data)
                except Exception:
                    pass
            # 3) Fallback final: GET com querystring
            if resp.status_code >= 400:
                try:
                    resp = await client.get(self.login_url, params=data)
                except Exception:
                    pass
            if resp.status_code >= 400:
                raise HTTPException(status_code=resp.status_code, detail=resp.text)
            body = resp.json()
            self.access_token = body.get("access_token")
            inst = body.get("instance_url")
            if isinstance(inst, str):
                inst_norm = inst.strip().strip('`"').strip()
                if inst_norm:
                    self.instance_url = inst_norm
            if not self.instance_url:
                self.instance_url = self.base_url
            return self.access_token or ""

    async def _auth_headers(self) -> dict:
        if not self.access_token:
            await self.login()
        return {"Authorization": f"Bearer {self.access_token}"}

    async def userinfo(self) -> dict:
        url = f"{self.base_url}/services/oauth2/userinfo"
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, headers=await self._auth_headers())
            if resp.status_code >= 400:
                raise HTTPException(status_code=resp.status_code, detail=resp.text)
            return resp.json()

    async def list_sobjects(self) -> dict:
        url = f"{self.base_url}/services/data/v{self.api_version}/sobjects"
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, headers=await self._auth_headers())
            if resp.status_code >= 400:
                raise HTTPException(status_code=resp.status_code, detail=resp.text)
            return resp.json()

    async def describe(self, object_name: str) -> dict:
        url = f"{self.base_url}/services/data/v{self.api_version}/sobjects/{object_name}/describe"
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, headers=await self._auth_headers())
            if resp.status_code >= 400:
                raise HTTPException(status_code=resp.status_code, detail=resp.text)
            return resp.json()

    async def query(self, soql: str) -> dict:
        url = f"{self.base_url}/services/data/v{self.api_version}/query"
        params = {"q": soql}
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.get(url, params=params, headers=await self._auth_headers())
            if resp.status_code >= 400:
                raise HTTPException(status_code=resp.status_code, detail=resp.text)
            return resp.json()

    def _data_base(self) -> str:
        return (self.instance_url or self.base_url).rstrip("/")

    async def create(self, object_name: str, payload: dict) -> dict:
        url = f"{self._data_base()}/services/data/v{self.api_version}/sobjects/{object_name}"
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, json=payload, headers={**(await self._auth_headers()), "Content-Type": "application/json"})
            if resp.status_code >= 400:
                try:
                    err = resp.json()
                    raise HTTPException(status_code=resp.status_code, detail=err)
                except Exception:
                    raise HTTPException(status_code=resp.status_code, detail=resp.text)
            return resp.json()

    async def update(self, object_name: str, record_id: str, payload: dict) -> dict:
        url = f"{self._data_base()}/services/data/v{self.api_version}/sobjects/{object_name}/{record_id}"
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.patch(url, json=payload, headers={**(await self._auth_headers()), "Content-Type": "application/json"})
            if resp.status_code >= 400:
                try:
                    err = resp.json()
                    raise HTTPException(status_code=resp.status_code, detail=err)
                except Exception:
                    raise HTTPException(status_code=resp.status_code, detail=resp.text)
            return {"success": True, "status": resp.status_code}

    async def upsert(self, object_name: str, external_field: str, external_value: str, payload: dict) -> dict:
        url = f"{self._data_base()}/services/data/v{self.api_version}/sobjects/{object_name}/{external_field}/{external_value}"
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.patch(url, json=payload, headers={**(await self._auth_headers()), "Content-Type": "application/json"})
            if resp.status_code >= 400:
                try:
                    err = resp.json()
                    raise HTTPException(status_code=resp.status_code, detail=err)
                except Exception:
                    raise HTTPException(status_code=resp.status_code, detail=resp.text)
            created = resp.status_code == 201
            body = None
            try:
                body = resp.json()
            except Exception:
                body = None
            return {"success": True, "created": created, "status": resp.status_code, "body": body}

    async def composite_sobjects(self, payload: dict) -> dict:
        url = f"{self._data_base()}/services/data/v{self.api_version}/composite/sobjects"
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(url, json=payload, headers={**(await self._auth_headers()), "Content-Type": "application/json"})
            if resp.status_code >= 400:
                try:
                    err = resp.json()
                    raise HTTPException(status_code=resp.status_code, detail=err)
                except Exception:
                    raise HTTPException(status_code=resp.status_code, detail=resp.text)
            return resp.json()

    async def composite(self, payload: dict) -> dict:
        url = f"{self._data_base()}/services/data/v{self.api_version}/composite"
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(url, json=payload, headers={**(await self._auth_headers()), "Content-Type": "application/json"})
            if resp.status_code >= 400:
                try:
                    err = resp.json()
                    raise HTTPException(status_code=resp.status_code, detail=err)
                except Exception:
                    raise HTTPException(status_code=resp.status_code, detail=resp.text)
            return resp.json()

    # -----------------------------
    # Bulk API v2 (Ingest)
    # -----------------------------
    async def bulk_create_job(self, payload: dict) -> dict:
        url = f"{self._data_base()}/services/data/v{self.api_version}/jobs/ingest"
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, json=payload, headers={**(await self._auth_headers()), "Content-Type": "application/json"})
            if resp.status_code >= 400:
                try:
                    err = resp.json()
                    raise HTTPException(status_code=resp.status_code, detail=err)
                except Exception:
                    raise HTTPException(status_code=resp.status_code, detail=resp.text)
            return resp.json()

    async def bulk_upload_batch(self, job_id: str, csv_data: bytes) -> dict:
        url = f"{self._data_base()}/services/data/v{self.api_version}/jobs/ingest/{job_id}/batches"
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.put(url, content=csv_data, headers={**(await self._auth_headers()), "Content-Type": "text/csv"})
            if resp.status_code >= 400:
                raise HTTPException(status_code=resp.status_code, detail=resp.text)
            try:
                return resp.json()
            except Exception:
                return {"status": resp.status_code}

    async def bulk_close_job(self, job_id: str, state: str = "UploadComplete") -> dict:
        url = f"{self._data_base()}/services/data/v{self.api_version}/jobs/ingest/{job_id}"
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.patch(url, json={"state": state}, headers={**(await self._auth_headers()), "Content-Type": "application/json"})
            if resp.status_code >= 400:
                raise HTTPException(status_code=resp.status_code, detail=resp.text)
            return resp.json()

    async def bulk_job_status(self, job_id: str) -> dict:
        url = f"{self._data_base()}/services/data/v{self.api_version}/jobs/ingest/{job_id}"
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, headers=await self._auth_headers())
            if resp.status_code >= 400:
                raise HTTPException(status_code=resp.status_code, detail=resp.text)
            return resp.json()

    async def bulk_results(self, job_id: str, kind: str) -> str:
        url = f"{self._data_base()}/services/data/v{self.api_version}/jobs/ingest/{job_id}/{kind}"
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.get(url, headers=await self._auth_headers())
            if resp.status_code >= 400:
                raise HTTPException(status_code=resp.status_code, detail=resp.text)
            return resp.text

app = FastAPI(title="Mapeamento FOCO", version="0.1.0")

# Static & Templates
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# Singleton FOCO client
foco_client = FOCOClient(
    base_url=FOCO_BASE_URL,
    login_url=FOCO_LOGIN_URL,
    client_id=FOCO_CLIENT_ID or "",
    client_secret=FOCO_CLIENT_SECRET or "",
    username=FOCO_USERNAME or "",
    password=FOCO_PASSWORD or "",
    security_token=FOCO_SECURITY_TOKEN or "",
    api_version=FOCO_API_VERSION,
    grant_type=FOCO_GRANT_TYPE,
)

@app.get("/")
async def index(request: Request):
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "api_version": foco_client.api_version,
            "base_url": foco_client.base_url,
            "docs_url": FOCO_DOCS_URL,
        },
    )

@app.get("/api/health")
async def health():
    return {"status": "ok"}

@app.post("/api/login")
async def login():
    token = await foco_client.login()
    return {"access_token": token}

@app.get("/api/whoami")
async def whoami():
    data = await foco_client.userinfo()
    return JSONResponse(content=data)

@app.get("/api/sobjects")
async def sobjects():
    data = await foco_client.list_sobjects()
    return JSONResponse(content=data)

@app.get("/api/describe/{object_name}")
async def describe(object_name: str):
    data = await foco_client.describe(object_name)
    return JSONResponse(content=data)

@app.get("/api/query")
async def run_query(q: str = Query(..., description="SOQL query string")):
    data = await foco_client.query(q)
    return JSONResponse(content=data)

@app.post("/api/sobjects/{object_name}")
async def create_object(object_name: str, payload: dict):
    data = await foco_client.create(object_name, payload)
    return JSONResponse(content=data)

@app.patch("/api/sobjects/{object_name}/{record_id}")
async def update_object(object_name: str, record_id: str, payload: dict):
    data = await foco_client.update(object_name, record_id, payload)
    return JSONResponse(content=data)

@app.patch("/api/upsert/{object_name}/{external_field}/{external_value}")
async def upsert_object(object_name: str, external_field: str, external_value: str, payload: dict):
    data = await foco_client.upsert(object_name, external_field, external_value, payload)
    return JSONResponse(content=data)

@app.post("/api/composite/sobjects")
async def composite_sobjects(payload: dict):
    data = await foco_client.composite_sobjects(payload)
    return JSONResponse(content=data)

@app.post("/api/composite")
async def composite(payload: dict):
    data = await foco_client.composite(payload)
    return JSONResponse(content=data)

# -----------------------------
# API: Bulk API v2 proxy endpoints
# -----------------------------
class BulkJobRequest(BaseModel):
    object: str
    operation: str
    contentType: Optional[str] = "CSV"
    lineEnding: Optional[str] = "LF"
    externalIdFieldName: Optional[str] = None

@app.post("/api/bulk/job")
async def bulk_create_job(payload: BulkJobRequest):
    body = payload.dict(exclude_none=True)
    data = await foco_client.bulk_create_job(body)
    return JSONResponse(content=data)

@app.put("/api/bulk/job/{job_id}/batches")
async def bulk_upload_batch(job_id: str, request: Request):
    # Aceita 'text/csv' puro ou JSON {"csv": "..."}
    content_type = request.headers.get("content-type", "")
    if "text/csv" in content_type:
        csv_bytes = await request.body()
    else:
        try:
            body = await request.json()
            csv_text = body.get("csv", "")
            if not isinstance(csv_text, str):
                raise ValueError("csv deve ser string")
            csv_bytes = csv_text.encode("utf-8")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"CSV inválido: {e}")
    data = await foco_client.bulk_upload_batch(job_id, csv_bytes)
    return JSONResponse(content=data)

class BulkCloseRequest(BaseModel):
    state: Optional[str] = "UploadComplete"

@app.patch("/api/bulk/job/{job_id}")
async def bulk_close(job_id: str, payload: BulkCloseRequest):
    data = await foco_client.bulk_close_job(job_id, state=payload.state or "UploadComplete")
    return JSONResponse(content=data)

@app.get("/api/bulk/job/{job_id}")
async def bulk_status(job_id: str):
    data = await foco_client.bulk_job_status(job_id)
    return JSONResponse(content=data)

from fastapi.responses import PlainTextResponse

@app.get("/api/bulk/job/{job_id}/successfulResults")
async def bulk_success(job_id: str):
    text = await foco_client.bulk_results(job_id, "successfulResults")
    return PlainTextResponse(text, media_type="text/csv")

@app.get("/api/bulk/job/{job_id}/failedResults")
async def bulk_failed(job_id: str):
    text = await foco_client.bulk_results(job_id, "failedResults")
    return PlainTextResponse(text, media_type="text/csv")

@app.get("/api/bulk/job/{job_id}/unprocessedrecords")
async def bulk_unprocessed(job_id: str):
    text = await foco_client.bulk_results(job_id, "unprocessedrecords")
    return PlainTextResponse(text, media_type="text/csv")

@app.get("/api/config")
async def get_config():
    def mask(s: Optional[str]) -> str:
        if not s:
            return ""
        if len(s) <= 6:
            return "***"
        return s[:3] + "***" + s[-3:]
    return {
        "base_url": foco_client.base_url,
        "login_url": foco_client.login_url,
        "api_version": foco_client.api_version,
        "client_id": mask(foco_client.client_id),
        "client_secret": mask(foco_client.client_secret),
        "username": mask(foco_client.username),
        "password": "***",
        "security_token": "***",
        "grant_type": foco_client.grant_type,
    }

@app.post("/api/config")
async def set_config(cfg: ConfigUpdate):
    data = cfg.model_dump(exclude_none=True)
    # Atualiza client in-memory
    foco_client.base_url = data.get("base_url", foco_client.base_url).rstrip("/")
    foco_client.login_url = data.get("login_url", foco_client.login_url)
    foco_client.api_version = data.get("api_version", foco_client.api_version)
    foco_client.client_id = data.get("client_id", foco_client.client_id)
    foco_client.client_secret = data.get("client_secret", foco_client.client_secret)
    foco_client.username = data.get("username", foco_client.username)
    foco_client.password = data.get("password", foco_client.password)
    foco_client.security_token = data.get("security_token", foco_client.security_token)
    foco_client.grant_type = (data.get("grant_type", foco_client.grant_type) or "password").lower()
    # Zera token/instância para forçar novo login com config atualizada
    foco_client.access_token = None
    foco_client.instance_url = None
    # Atualiza variáveis de ambiente para persistir durante o processo
    os.environ["FOCO_BASE_URL"] = foco_client.base_url
    os.environ["FOCO_LOGIN_URL"] = foco_client.login_url
    os.environ["FOCO_API_VERSION"] = foco_client.api_version
    os.environ["FOCO_CLIENT_ID"] = foco_client.client_id
    os.environ["FOCO_CLIENT_SECRET"] = foco_client.client_secret
    os.environ["FOCO_USERNAME"] = foco_client.username
    os.environ["FOCO_PASSWORD"] = foco_client.password
    os.environ["FOCO_SECURITY_TOKEN"] = foco_client.security_token
    os.environ["FOCO_GRANT_TYPE"] = foco_client.grant_type
    return {"status": "ok"}


class LogoutResponse(BaseModel):
    status: str

# Add logout endpoint
@app.post("/api/logout")
async def logout():
    try:
        # Basic stateless logout: clear cached token in memory if any
        # If FOCOClient stores token, reset it
        global fococlient
        if 'fococlient' in globals() and hasattr(fococlient, 'access_token'):
            fococlient.access_token = None
            fococlient.instance_url = None
        return {"status": "logged_out"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))