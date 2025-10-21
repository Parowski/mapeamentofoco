// Consolidated app.js: geração automática de exemplos e gerador de payloads

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// Toast
function showToast(message, type = "info") {
  const container = $("#toast");
  if (!container) return;
  const el = document.createElement("div");
  const color =
    type === "success"
      ? "bg-emerald-600"
      : type === "error"
      ? "bg-red-600"
      : "bg-slate-700";
  el.className = `${color} text-white px-3 py-2 rounded shadow text-sm`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function prettyJson(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch (e) {
    return String(obj);
  }
}

// HTTP helpers
async function apiGetJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function apiPostJson(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `HTTP ${res.status}`);
  }
  return res.json();
}

async function apiGetRaw(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text; // CSV ou texto
  }
}

// Sessão
async function doLogin() {
  try {
    await apiPostJson("/api/login", {});
    const el = $("#loginStatus");
    if (el) el.textContent = "Autenticado via .env";
    showToast("Sessão ativa", "success");
  } catch (e) {
    const el = $("#loginStatus");
    if (el) el.textContent = "Falha ao autenticar";
    showToast("Falha ao autenticar", "error");
  }
}

// Estado
let ALL_OBJECTS = [];
let CURRENT_OBJECT = null;
let CURRENT_DESCRIBE = null;
let CURRENT_PICKLISTS = null;

// sObjects
async function loadObjects() {
  try {
    const payload = await apiGetJson("/api/sobjects");
    const list = payload.sobjects || payload.sObjects || [];
    ALL_OBJECTS = list.sort((a, b) => (a.label || a.name).localeCompare(b.label || b.name));
    renderObjects(ALL_OBJECTS);
    showToast(`Carregado ${ALL_OBJECTS.length} objetos`, "success");
  } catch (e) {
    console.error(e);
    showToast("Erro ao carregar sObjects", "error");
  }
}

function renderObjects(list) {
  const ul = $("#objectsList");
  ul.innerHTML = "";
  list.forEach((o) => {
    const li = document.createElement("li");
    li.className = "px-2 py-1 hover:bg-slate-100 cursor-pointer rounded";
    li.textContent = `${o.label || o.name} (${o.name})`;
    li.addEventListener("click", () => onSelectObject(o.name));
    ul.appendChild(li);
  });
}

async function onSelectObject(objectName) {
  CURRENT_OBJECT = objectName;
  try {
    const d = await apiGetJson(`/api/describe/${encodeURIComponent(objectName)}`);
    CURRENT_DESCRIBE = d;
    CURRENT_PICKLISTS = buildPicklistData(d);
    $("#describeJson").textContent = prettyJson(d);
    generateExamplesFromDescribe(objectName, d);
    const ops = $("#opsPanel");
    if (ops) ops.classList.remove("hidden");
  } catch (e) {
    console.error(e);
    showToast("Erro no Describe", "error");
  }
}

// Geradores a partir do Describe
function buildSelectFields(fields) {
  const use = fields
    .filter((f) => !f.calculated && !f.deprecatedAndHidden)
    .slice(0, 8)
    .map((f) => f.name);
  return use.length ? use.join(", ") : "Id";
}

function buildMandatoryPayload(fields) {
  const required = fields.filter(
    (f) => f.nillable === false && !f.defaultedOnCreate && !f.calculated
  );
  const body = {};
  required.slice(0, 8).forEach((f) => {
    switch (f.type) {
      case "string":
      case "textarea":
      case "phone":
      case "email":
      case "url":
      case "picklist":
        body[f.name] = `${f.name}_exemplo`;
        break;
      case "boolean":
        body[f.name] = true;
        break;
      case "int":
      case "double":
      case "currency":
      case "percent":
        body[f.name] = 0;
        break;
      case "date":
        body[f.name] = "2025-01-01";
        break;
      case "datetime":
        body[f.name] = "2025-01-01T12:00:00Z";
        break;
      case "reference":
        body[f.name] = "001XXXXXXXXXXXX";
        break;
      default:
        body[f.name] = null;
    }
  });
  if (Object.keys(body).length === 0) body[fields[0]?.name || "Name"] = "Exemplo";
  return body;
}

function buildPicklistData(describe) {
  const picklistData = {};
  if (!describe || !describe.fields) return picklistData;
  
  describe.fields.forEach(field => {
    if (field.type === 'picklist' || field.type === 'multipicklist') {
      const fieldName = field.name;
      picklistData[fieldName] = {
        type: field.type,
        values: field.picklistValues || [],
        controllerName: field.controllerName || null,
        dependentPicklist: field.dependentPicklist || false,
        validFor: field.picklistValues ? field.picklistValues.map(pv => pv.validFor) : []
      };
    }
  });
  
  return picklistData;
}

function listPicklistValuesText(picklistData) {
  if (!picklistData || Object.keys(picklistData).length === 0) {
    return "No picklist fields found for this object.";
  }
  
  let text = "";
  Object.keys(picklistData).forEach(fieldName => {
    const field = picklistData[fieldName];
    text += `\n${fieldName} (${field.type}):\n`;
    if (field.values && field.values.length > 0) {
      field.values.forEach(pv => {
        const activeText = pv.active ? "" : " [INACTIVE]";
        text += `  - ${pv.label} → ${pv.value}${activeText}\n`;
      });
    } else {
      text += "  (No values available)\n";
    }
    if (field.dependentPicklist && field.controllerName) {
      text += `  Dependencies: controlled by ${field.controllerName}\n`;
    }
    text += "\n";
  });
  
  return text.trim();
}

function isBitSetBase64(base64String, bitIndex) {
  if (!base64String || bitIndex < 0) return false;
  try {
    const bytes = atob(base64String);
    const byteIndex = Math.floor(bitIndex / 8);
    const bitOffset = bitIndex % 8;
    if (byteIndex >= bytes.length) return false;
    const byte = bytes.charCodeAt(byteIndex);
    return (byte & (1 << bitOffset)) !== 0;
  } catch (e) {
    return false;
  }
}

function maybeMapPicklistsForObject(payload, picklistData, controllerValues = {}) {
  if (!payload || !picklistData || typeof payload !== 'object') {
    return payload;
  }
  
  const autoMap = document.getElementById('picklistAutoMap')?.checked !== false;
  const activeOnly = document.getElementById('picklistActiveOnly')?.checked !== false;
  
  if (!autoMap) return payload;
  
  const mappedPayload = Array.isArray(payload) ? [...payload] : { ...payload };
  
  function mapSingleRecord(record) {
    if (!record || typeof record !== 'object') return record;
    
    const mappedRecord = { ...record };
    
    Object.keys(picklistData).forEach(fieldName => {
      if (!(fieldName in mappedRecord)) return;
      
      const fieldValue = mappedRecord[fieldName];
      if (fieldValue === null || fieldValue === undefined || fieldValue === '') return;
      
      const field = picklistData[fieldName];
      let availableValues = field.values || [];
      
      // Filter by dependency if applicable
      if (field.dependentPicklist && field.controllerName && controllerValues[field.controllerName] !== undefined) {
        const controllerValue = controllerValues[field.controllerName];
        const controllerPicklist = picklistData[field.controllerName];
        if (controllerPicklist && controllerPicklist.values) {
          const controllerEntry = controllerPicklist.values.find(pv => pv.value === controllerValue);
          if (controllerEntry && controllerEntry.validFor) {
            availableValues = field.values.filter((pv, index) => {
              return isBitSetBase64(controllerEntry.validFor, index);
            });
          }
        }
      }
      
      // Filter by active status
      if (activeOnly) {
        availableValues = availableValues.filter(pv => pv.active !== false);
      }
      
      // Handle multipicklist (semicolon-separated)
      if (field.type === 'multipicklist' && typeof fieldValue === 'string') {
        const labels = fieldValue.split(';').map(s => s.trim()).filter(s => s);
        const mappedValues = labels.map(label => {
          const entry = availableValues.find(pv => pv.label === label);
          return entry ? entry.value : label;
        });
        mappedRecord[fieldName] = mappedValues.join(';');
      } else if (typeof fieldValue === 'string') {
        // Single picklist
        const entry = availableValues.find(pv => pv.label === fieldValue);
        if (entry) {
          mappedRecord[fieldName] = entry.value;
        }
      }
    });
    
    return mappedRecord;
  }
  
  if (Array.isArray(mappedPayload)) {
    return mappedPayload.map(mapSingleRecord);
  } else {
    return mapSingleRecord(mappedPayload);
  }
}

function inferExternalIdField(fields) {
  const candidates = fields.filter((f) => f.externalId);
  if (candidates.length) return candidates[0].name;
  const byName = fields.find((f) => /external|codigo|code|identifier/i.test(f.name));
  return byName ? byName.name : null;
}

function generateExamplesFromDescribe(objectName, describe) {
  const fields = describe.fields || [];

  // SOQL
  const selectFields = buildSelectFields(fields);
  const soql = `SELECT ${selectFields} FROM ${objectName} LIMIT 10`;
  $("#queryInput").value = soql;

  // Create
  const createBody = buildMandatoryPayload(fields);
  $("#opCreateObject").value = objectName;
  $("#opCreatePayload").value = JSON.stringify(createBody, null, 2);

  // Update
  $("#opUpdateObject").value = objectName;
  $("#opUpdateId").value = "a0AXXXXXXXXXXXX";
  $("#opUpdatePayload").value = JSON.stringify({ ...createBody }, null, 2);

  // Upsert
  $("#opUpsertObject").value = objectName;
  $("#opUpsertExternalField").value = inferExternalIdField(fields) || "ExternalId__c";
  $("#opUpsertExternalValue").value = "EXT-0001";
  $("#opUpsertPayload").value = JSON.stringify({ ...createBody }, null, 2);

  // Composite SObjects
  const compositeRecords = {
    allOrNone: false,
    records: [{ attributes: { type: objectName }, ...createBody }],
  };
  $("#opCompositeSObjects").value = JSON.stringify(compositeRecords, null, 2);

  // Composite
  const apiVersionMatch = $(`header .text-sm span`)?.textContent?.match(/v(\d+)/);
  const apiVersion = apiVersionMatch ? apiVersionMatch[1] : "61";
  const compositeReq = {
    allOrNone: false,
    compositeRequest: [
      {
        method: "POST",
        url: `/services/data/v${apiVersion}.0/sobjects/${objectName}`,
        referenceId: "ref1",
        body: createBody,
      },
    ],
  };
  $("#opComposite").value = JSON.stringify(compositeReq, null, 2);

  // Bulk CSV (insert)
  $("#bulkObject").value = objectName;
  const csvHeaders = Object.keys(createBody).join(",");
  const csvValues = Object.values(createBody)
    .map((v) => (typeof v === "string" ? `"${v}"` : v))
    .join(",");
  $("#bulkCsv").value = `${csvHeaders}\n${csvValues}`;
}

// Query
async function runQuery() {
  const q = $("#queryInput").value.trim();
  if (!q) return showToast("Informe uma SOQL", "info");
  try {
    // Tenta POST moderno
    const data = await apiPostJson("/api/query", { query: q });
    $("#queryResult").textContent = prettyJson(data);
  } catch (e1) {
    try {
      // Fallback GET
      const data = await apiGetJson(`/api/query?q=${encodeURIComponent(q)}`);
      $("#queryResult").textContent = prettyJson(data);
    } catch (e2) {
      $("#queryResult").textContent = String(e2);
    }
  }
}

// Operações
function getTextareaJson(id, errId) {
  const el = $("#" + id);
  const err = $("#" + errId);
  try {
    const v = el.value.trim();
    return v ? JSON.parse(v) : {};
  } catch (e) {
    if (err) {
      err.classList.remove("hidden");
      setTimeout(() => err.classList.add("hidden"), 2200);
    }
    throw e;
  }
}

function attachJsonValidator(textareaId, errorId) {
  const textarea = document.getElementById(textareaId);
  const errorEl = document.getElementById(errorId);
  
  if (!textarea || !errorEl) return;
  
  textarea.addEventListener('input', () => {
    const value = textarea.value.trim();
    if (!value) {
      errorEl.classList.add('hidden');
      textarea.style.borderColor = '';
      return;
    }
    
    try {
      JSON.parse(value);
      errorEl.classList.add('hidden');
      textarea.style.borderColor = '#10b981'; // green
    } catch (e) {
      errorEl.textContent = `Invalid JSON: ${e.message}`;
      errorEl.classList.remove('hidden');
      textarea.style.borderColor = '#ef4444'; // red
    }
  });
}

async function doCreate() {
  try {
    const sobject = $("#opCreateObject").value.trim();
    let payload = getTextareaJson("opCreatePayload", "errCreatePayload");
    payload = maybeMapPicklistsForObject(payload, CURRENT_PICKLISTS);
    const res = await apiPostJson(`/api/sobjects/${encodeURIComponent(sobject)}`, payload);
    $("#opsOutput").textContent = prettyJson(res);
  } catch (e) {
    $("#opsOutput").textContent = String(e);
  }
}

async function doUpdate() {
  try {
    const sobject = $("#opUpdateObject").value.trim();
    const recordId = $("#opUpdateId").value.trim();
    let payload = getTextareaJson("opUpdatePayload", "errUpdatePayload");
    payload = maybeMapPicklistsForObject(payload, CURRENT_PICKLISTS);
    const res = await apiPostJson(
      `/api/sobjects/${encodeURIComponent(sobject)}/${encodeURIComponent(recordId)}`,
      payload
    );
    $("#opsOutput").textContent = prettyJson(res);
  } catch (e) {
    $("#opsOutput").textContent = String(e);
  }
}

async function requestUpsert(objectName, extField, extValue, payload) {
  // Tenta endpoint dedicado /api/upsert
  try {
    return await apiPostJson(
      `/api/upsert/${encodeURIComponent(objectName)}/${encodeURIComponent(extField)}/${encodeURIComponent(extValue)}`,
      payload
    );
  } catch (e1) {
    // Fallback: rota por sobject
    return await apiPostJson(
      `/api/sobjects/${encodeURIComponent(objectName)}/${encodeURIComponent(extField)}/${encodeURIComponent(extValue)}`,
      payload
    );
  }
}

async function doUpsert() {
  try {
    const sobject = $("#opUpsertObject").value.trim();
    const extField = $("#opUpsertExternalField").value.trim();
    const extValue = $("#opUpsertExternalValue").value.trim();
    let payload = getTextareaJson("opUpsertPayload", "errUpsertPayload");
    payload = maybeMapPicklistsForObject(payload, CURRENT_PICKLISTS);
    const res = await requestUpsert(sobject, extField, extValue, payload);
    $("#opsOutput").textContent = prettyJson(res);
  } catch (e) {
    $("#opsOutput").textContent = String(e);
  }
}

async function doCompositeSObjects() {
  try {
    let body = getTextareaJson("opCompositeSObjects", "errCompositeSObjects");
    if (body.records && Array.isArray(body.records)) {
      body.records = maybeMapPicklistsForObject(body.records, CURRENT_PICKLISTS);
    }
    const res = await apiPostJson(`/api/composite/sobjects`, body);
    $("#opsOutput").textContent = prettyJson(res);
  } catch (e) {
    $("#opsOutput").textContent = String(e);
  }
}

async function doComposite() {
  try {
    let body = getTextareaJson("opComposite", "errComposite");
    if (body.compositeRequest && Array.isArray(body.compositeRequest)) {
      body.compositeRequest.forEach(req => {
        if (req.body && typeof req.body === 'object') {
          req.body = maybeMapPicklistsForObject(req.body, CURRENT_PICKLISTS);
        }
      });
    }
    const res = await apiPostJson(`/api/composite`, body);
    $("#opsOutput").textContent = prettyJson(res);
  } catch (e) {
    $("#opsOutput").textContent = String(e);
  }
}

function copyPre(id) {
  const pre = $("#" + id);
  const text = pre.innerText || pre.textContent || "";
  navigator.clipboard.writeText(text);
  showToast("Copiado para a área de transferência", "success");
}

// Bulk API v2 (com fallback de rotas)
async function bulkCreateJob() {
  try {
    const sobject = $("#bulkObject").value.trim();
    const operation = $("#bulkOperation").value;
    const externalId = $("#bulkExternalId").value.trim();
    const lineEnding = $("#bulkLineEnding").value;
    const body = {
      object: sobject,
      operation,
      lineEnding,
    };
    if (operation === "upsert" && externalId) body.externalIdFieldName = externalId;

    // Tenta plural
    let res;
    try {
      res = await apiPostJson(`/api/bulk/jobs`, body);
    } catch (e1) {
      res = await apiPostJson(`/api/bulk/job`, body);
    }
    $("#bulkJobId").value = res.id || res.jobId || "";
    $("#bulkOutput").textContent = prettyJson(res);
  } catch (e) {
    $("#bulkOutput").textContent = String(e);
  }
}

async function bulkUpload() {
  try {
    const jobId = $("#bulkJobId").value.trim();
    const csv = $("#bulkCsv").value;
    let res;
    try {
      res = await apiPostJson(`/api/bulk/jobs/${encodeURIComponent(jobId)}/batches`, { csv });
    } catch (e1) {
      res = await apiPostJson(`/api/bulk/job/${encodeURIComponent(jobId)}/batches`, { csv });
    }
    $("#bulkOutput").textContent = prettyJson(res);
  } catch (e) {
    $("#bulkOutput").textContent = String(e);
  }
}

async function bulkClose() {
  try {
    const jobId = $("#bulkJobId").value.trim();
    let res;
    try {
      res = await apiPostJson(`/api/bulk/jobs/${encodeURIComponent(jobId)}/close`, {});
    } catch (e1) {
      // Fallback PATCH-like
      res = await apiPostJson(`/api/bulk/job/${encodeURIComponent(jobId)}`, { state: "UploadComplete" });
    }
    $("#bulkOutput").textContent = prettyJson(res);
  } catch (e) {
    $("#bulkOutput").textContent = String(e);
  }
}

async function bulkStatus() {
  try {
    const jobId = $("#bulkJobId").value.trim();
    let res;
    try {
      res = await apiGetJson(`/api/bulk/jobs/${encodeURIComponent(jobId)}`);
    } catch (e1) {
      res = await apiGetJson(`/api/bulk/job/${encodeURIComponent(jobId)}`);
    }
    $("#bulkOutput").textContent = prettyJson(res);
  } catch (e) {
    $("#bulkOutput").textContent = String(e);
  }
}

async function bulkResults(kind) {
  try {
    const jobId = $("#bulkJobId").value.trim();
    const norm = kind === "unprocessed" ? "unprocessedRecords" : kind;
    let res;
    try {
      res = await apiGetRaw(`/api/bulk/jobs/${encodeURIComponent(jobId)}/${norm}`);
    } catch (e1) {
      const alt = norm === "unprocessedRecords" ? "unprocessedrecords" : norm;
      res = await apiGetRaw(`/api/bulk/job/${encodeURIComponent(jobId)}/${alt}`);
    }
    $("#bulkOutput").textContent = typeof res === "string" ? res : prettyJson(res);
  } catch (e) {
    $("#bulkOutput").textContent = String(e);
  }
}

// Ajuda/Config
function toggle(id) {
  const el = $("#" + id);
  if (!el) return;
  el.classList.toggle("hidden");
}

async function loadConfig() {
  try {
    const cfg = await apiGetJson("/api/config");
    $("#cfg_base_url").value = cfg.base_url || "";
    $("#cfg_login_url").value = cfg.login_url || "";
    $("#cfg_api_version").value = cfg.api_version || "";
    $("#cfg_grant_type").value = cfg.grant_type || "password";
    $("#cfg_client_id").value = "";
    $("#cfg_client_secret").value = "";
    $("#cfg_username").value = cfg.username || "";
    $("#cfg_password").value = "";
    $("#cfg_security_token").value = "";
  } catch (e) {
    console.warn("Falha ao carregar config", e);
  }
}

async function saveConfig() {
  const payload = {
    base_url: $("#cfg_base_url").value.trim() || undefined,
    login_url: $("#cfg_login_url").value.trim() || undefined,
    api_version: $("#cfg_api_version").value.trim() || undefined,
    grant_type: $("#cfg_grant_type").value || undefined,
    client_id: $("#cfg_client_id").value.trim() || undefined,
    client_secret: $("#cfg_client_secret").value.trim() || undefined,
    username: $("#cfg_username").value.trim() || undefined,
    password: $("#cfg_password").value.trim() || undefined,
    security_token: $("#cfg_security_token").value.trim() || undefined,
  };
  try {
    await apiPostJson("/api/config", payload);
    showToast("Configurações salvas", "success");
  } catch (e) {
    showToast("Falha ao salvar configurações", "error");
  }
}

// Bindings
function bindUI() {
  // sObjects
  const btnLoadObjects = $("#btnLoadObjects");
  if (btnLoadObjects) btnLoadObjects.addEventListener("click", loadObjects);
  const filter = $("#filterInput");
  filter.addEventListener("input", () => {
    const q = filter.value.toLowerCase();
    const filtered = ALL_OBJECTS.filter(
      (o) => (o.name || "").toLowerCase().includes(q) || (o.label || "").toLowerCase().includes(q)
    );
    renderObjects(filtered);
  });

  // Ajuda / Config
  $("#btnHelp").addEventListener("click", () => toggle("helpPanel"));
  const btnConfig = $("#btnConfig");
  if (btnConfig) {
    btnConfig.addEventListener("click", async () => {
      const el = $("#configPanel");
      const willShow = el.classList.contains("hidden");
      toggle("configPanel");
      if (willShow) await loadConfig();
    });
  }
  const btnSaveConfig = $("#btnSaveConfig");
  if (btnSaveConfig) btnSaveConfig.addEventListener("click", saveConfig);

  // Query
  $("#btnRunQuery").addEventListener("click", runQuery);
  $("#btnCopyQuery").addEventListener("click", () => copyPre("queryResult"));

  // Operações
  $("#btnOps").addEventListener("click", () => toggle("opsPanel"));
  const btnGen = $("#btnGeneratePayloads");
  if (btnGen)
    btnGen.addEventListener("click", () => {
      if (CURRENT_OBJECT && CURRENT_DESCRIBE) {
        generateExamplesFromDescribe(CURRENT_OBJECT, CURRENT_DESCRIBE);
        showToast("Exemplos regenerados a partir do Describe", "success");
      } else {
        showToast("Selecione um objeto primeiro", "info");
      }
    });

  $("#btnCreate").addEventListener("click", doCreate);
  $("#btnUpdate").addEventListener("click", doUpdate);
  $("#btnUpsert").addEventListener("click", doUpsert);
  $("#btnCompositeSObjects").addEventListener("click", doCompositeSObjects);
  $("#btnComposite").addEventListener("click", doComposite);
  $("#btnCopyOps").addEventListener("click", () => copyPre("opsOutput"));
  $("#btnCopyDescribe").addEventListener("click", () => copyPre("describeJson"));

  // Picklist viewer
  const btnViewPicklists = $("#btnViewPicklists");
  if (btnViewPicklists) {
    btnViewPicklists.addEventListener("click", () => {
      if (!CURRENT_PICKLISTS || Object.keys(CURRENT_PICKLISTS).length === 0) {
        showToast("No picklist fields found for this object", "info");
        return;
      }
      const text = listPicklistValuesText(CURRENT_PICKLISTS);
      $("#opsOutput").textContent = text;
    });
  }

  // JSON validation for operation text areas
  attachJsonValidator("opCreatePayload", "errCreatePayload");
  attachJsonValidator("opUpdatePayload", "errUpdatePayload");
  attachJsonValidator("opUpsertPayload", "errUpsertPayload");
  attachJsonValidator("opCompositeSObjects", "errCompositeSObjects");
  attachJsonValidator("opComposite", "errComposite");

  // Bulk
  $("#btnBulkCreateJob").addEventListener("click", bulkCreateJob);
  $("#btnBulkUpload").addEventListener("click", bulkUpload);
  $("#btnBulkClose").addEventListener("click", bulkClose);
  $("#btnBulkStatus").addEventListener("click", bulkStatus);
  $("#btnBulkSuccess").addEventListener("click", () => bulkResults("successfulResults"));
  $("#btnBulkFailed").addEventListener("click", () => bulkResults("failedResults"));
  $("#btnBulkUnprocessed").addEventListener("click", () => bulkResults("unprocessed"));
  $("#btnCopyBulk").addEventListener("click", () => copyPre("bulkOutput"));
}

// Init
async function initApp() {
  await doLogin().catch(() => {});
  bindUI();
  loadObjects(); // deixa mais dinâmico para iniciantes
}

window.addEventListener("DOMContentLoaded", initApp);