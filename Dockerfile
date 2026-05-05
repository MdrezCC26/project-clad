FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

COPY package.json package-lock.json* ./

# Workspace packages must exist before `npm ci` (see `package.json` → `workspaces`).
COPY extensions ./extensions

# DevDependencies (vite, typescript) are required for `react-router build`.
RUN npm ci && npm cache clean --force

COPY . .

ENV NODE_ENV=production

# `npm prune --omit=dev` frequently exits non‑zero under npm workspaces — reinstall prod-only tree instead.
RUN npm run build \
  && rm -rf node_modules \
  && npm ci --omit=dev \
  && npx prisma generate \
  && npm cache clean --force

CMD ["npm", "run", "docker-start"]
