FROM node:22-alpine
RUN apk add --no-cache openssl libc6-compat

EXPOSE 3000

WORKDIR /app

# Use Node 22 + relax engine check in the image only (see `package.json` `engines` + `.npmrc` `engine-strict`).
ENV NPM_CONFIG_ENGINE_STRICT=false

COPY package.json package-lock.json* ./
COPY .npmrc ./

# Workspace paths must exist before `npm ci`.
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
