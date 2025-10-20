# Mapeamento FOCO

Aplicação web em FastAPI (Python) com UI Tailwind (via CDN) para explorar e operar sobre a API do Salesforce FOCO:
- Listar sObjects (carregamento automático)
- Visualizar Describe (mapeamento de campos/parametrização)
- Executar queries SOQL
- Operações: Create / Update / Upsert / Composite / Composite SObjects
- Bulk API v2 (CSV)
- Auto-mapeamento de picklists (labels → values) com dependências e validação de JSON em tempo real

## Requisitos
- Windows/macOS/Linux com Python 3.10+

## Instalação
```powershell
# criar venv e instalar dependências
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

## Configuração (.env)
Crie seu `.env` a partir do `.env.example` (não versione o `.env`).

```powershell
Copy-Item .env.example .env
```

Em seguida, preencha as variáveis conforme seu ambiente FOCO/Salesforce:

```env
# Endpoints e versão
FOCO_BASE_URL=https://hlg-gateway.sebrae.com.br/foco-stg
FOCO_LOGIN_URL=https://hlg-gateway.sebrae.com.br/foco-stg/services/oauth2/token
FOCO_API_VERSION=62.0

# Credenciais (NÃO COMITAR)
FOCO_CLIENT_ID=<CLIENT_ID>
FOCO_CLIENT_SECRET=<CLIENT_SECRET>

# Fluxo OAuth2 (padrão: client_credentials)
FOCO_GRANT_TYPE=client_credentials

# Para fluxos que exigem usuário/senha (opcional)
FOCO_USERNAME=<USUARIO_SF>
FOCO_PASSWORD=<SENHA_SF>
# Opcional (caso necessário no fluxo password)
FOCO_SECURITY_TOKEN=

# Link da documentação exibido no topo e em Query (opcional)
FOCO_DOCS_URL=https://anypoint.mulesoft.com/exchange/portals/sebrae-2/a7bc5ec0-9afc-42bf-bc65-96a43cd68385/mapeamento-sas-x-foco/minor/1.0/console/summary/
```

- Nunca comite o arquivo `.env` (já está no `.gitignore`).
- Distribua somente o `.env.example` para terceiros.

## Segurança
- .env e .venv estão ignorados no repositório. Para garantir que não foram versionados no passado:
  - Remova do índice se necessário: `git rm --cached .env` e `git rm -r --cached .venv`.
- Se algum segredo já foi comitado, reescreva o histórico:
  - Com git filter-repo (recomendado): `pip install git-filter-repo` e `git filter-repo --path .env --invert-paths`.
  - Ou com BFG Repo-Cleaner: `bfg --delete-files .env`.
  - Depois faça `git push --force` para o remoto.
- Varra o histórico por termos sensíveis: `git grep -Ii -n -E "token|secret|client_id|client_secret|FOCO_CLIENT|FOCO_PASSWORD|FOCO_USERNAME|FOCO_SECURITY_TOKEN" $(git rev-list --all)`.
- Revogue/rotacione quaisquer credenciais que possam ter vazado e crie novas.


Observações:
- O cliente suporta `FOCO_GRANT_TYPE` `client_credentials` (padrão) e `password`.
- Ajuste `FOCO_DOCS_URL` para apontar à documentação desejada.

## Execução
```powershell
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --port 8000
```
Acesse: `http://localhost:8000/`

## Uso
- Autenticação: realizada automaticamente ao abrir a página (toast “Sessão ativa”).
- sObjects: a lista carrega automaticamente. Use o filtro para buscar e clique em um objeto para ver o Describe.
- Describe: visualize o JSON completo e copie com “Copiar JSON”.
- Query (SOQL): digite a SOQL, clique em “Executar” e veja o resultado JSON. O link “Docs” usa `FOCO_DOCS_URL`.
- Operações (Create/Update/Upsert/Composite):
  - Campos de payload têm validação de JSON em tempo real (bordas verde/vermelho e mensagem).
  - “Gerar payloads” cria exemplos a partir do Describe do objeto selecionado.
  - Picklists: habilite “Auto-mapear labels → values” e “Somente valores ativos”. Dependências de picklists são respeitadas.
  - “Ver picklists do objeto” exibe os valores label → value.
- Bulk API v2: crie o Job, envie o CSV, feche o Job e consulte status/resultados. A UI auxilia com geração de CSV básica.

## Notas de UI
- O botão “Configurações” e a mensagem inicial de sessão foram removidos da interface.
- O botão “Carregar” de sObjects não é necessário; o carregamento ocorre automaticamente.
- Para alterar endpoints/credenciais, edite o `.env` e reinicie o servidor.

## Stack
- Backend: FastAPI + httpx
- Frontend: HTML + Tailwind via CDN + JavaScript vanilla
- Execução local: Uvicorn