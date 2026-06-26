# Deploy — Lídart Proposals (Kallas)

App Node (Express + Vite buildado) + Python (parser). Banco já é TiDB Cloud.
Provado: builda e roda em produção (`NODE_ENV=production node dist/index.js`).

## 1. Variáveis de ambiente (setar no host)

| Variável | O que é |
|---|---|
| `DATABASE_URL` | TiDB Cloud (mesma de hoje) |
| `JWT_SECRET` | segredo que assina a sessão — **fixo e secreto** |
| `ANTHROPIC_API_KEY` | **chave da Kallas** (custo de IA = Kallas) |
| `GEMINI_API_KEY` | **chave da Kallas** (mockups) |
| `OWNER_OPEN_ID` | openId do admin/dono |
| `VITE_APP_ID` | id do app (usado no token de sessão) |
| `PORT` | o host normalmente seta sozinho |
| `LOCAL_STORAGE_DIR` | `/data/storage` (já no Dockerfile) |
| `PYTHON_CMD` | `python3` (já no Dockerfile) |

## 2. Storage = VOLUME PERSISTENTE (crítico)

O storage é em disco (`/data/storage`). Em PaaS o disco é efêmero → **monte um volume**
do host em `/data/storage`, senão a tabela de preços, as fotos de mockup e os
arquivos gerados **somem a cada deploy**.

Depois do 1º deploy, **semear no volume**:
- a tabela de preços (`pricing-*.xlsx`),
- as fotos do `mockup_inventory/`.
(ou re-subir pela tela de Recursos do app.)

## 3. Antes de abrir pra produção

- **Remover/gatear o `/api/auth/dev-login`** (é backdoor de bootstrap — não pode ficar em produção aberta).
- Conferir no boot o log `[Config IA — quem paga]` → as fingerprints têm que ser as **chaves da Kallas**, não as suas.

## 4. Host sugerido

Railway ou Render (aceitam Docker + volume persistente, fáceis). ~US$ 5–20/mês.
Passos: criar conta → novo serviço a partir deste repo/Dockerfile → adicionar
volume em `/data/storage` → setar as variáveis acima → deploy.
