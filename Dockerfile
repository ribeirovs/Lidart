# ─── build ───────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npx vite build \
 && npx esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist

# ─── runtime ─────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Python + pypdf p/ o parser de briefings (docx/pptx/pdf)
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates \
 && pip3 install --no-cache-dir --break-system-packages pypdf \
 && rm -rf /var/lib/apt/lists/*
ENV PYTHON_CMD=python3

# Dependências de runtime (o bundle do servidor é --packages=external)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# Artefatos buildados + o que o runtime precisa
COPY --from=build /app/dist ./dist
COPY server/parse_file.py ./server/parse_file.py
COPY scratch/pptx_extracted_media ./scratch/pptx_extracted_media

# Storage PERSISTENTE — monte um volume do host aqui (senão arquivos somem no deploy)
ENV LOCAL_STORAGE_DIR=/data/storage
RUN mkdir -p /data/storage

EXPOSE 3000
CMD ["node", "dist/index.js"]
