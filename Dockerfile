# Minimal image: workspaces paths, relax engine.strict in Docker, reproducible prod node_modules.

FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NPM_CONFIG_ENGINE_STRICT=false

COPY package.json package-lock.json* ./
COPY .npmrc ./
COPY extensions ./extensions

RUN npm ci && npm cache clean --force

COPY . .

ENV NODE_ENV=production

RUN npm run build \
  && rm -rf node_modules \
  && (npm ci --omit=dev || npm install --omit=dev) \
  && npx prisma generate \
  && npm cache clean --force

CMD ["npm", "run", "docker-start"]
