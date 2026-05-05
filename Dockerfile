FROM node:22-alpine
RUN apk add --no-cache openssl libc6-compat

EXPOSE 3000

WORKDIR /app

# Root `.npmrc` sets `engine-strict=true`. `node:20-alpine` is sometimes below 20.19, which
# fails `package.json` engines (see `engines` field). Use Node 22 + relax only for this image.
ENV NPM_CONFIG_ENGINE_STRICT=false

COPY package.json package-lock.json* ./
COPY .npmrc ./

# Workspace packages must exist before `npm ci` (see `package.json` → `workspaces`).
COPY extensions ./extensions

# DevDependencies (vite, typescript) are required for `react-router build`.
RUN npm ci && npm cache clean --force

COPY . .

ENV NODE_ENV=production

# Drop devDependencies after build. Second `npm ci` can still fail on some npm/workspace/Alpine
# combos; `npm install --omit=dev` is a compatible fallback that still honors the lockfile.
RUN npm run build \
  && rm -rf node_modules \
  && (npm ci --omit=dev || npm install --omit=dev) \
  && npx prisma generate \
  && npm cache clean --force

CMD ["npm", "run", "docker-start"]
