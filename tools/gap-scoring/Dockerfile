FROM node:20-alpine AS root-builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
COPY src ./src

RUN npm ci
RUN npm run build

FROM node:20-alpine AS app-builder
WORKDIR /app

COPY --from=root-builder /app /app
COPY tools/gap-scoring/package.json tools/gap-scoring/package-lock.json ./tools/gap-scoring/

WORKDIR /app/tools/gap-scoring
RUN npm install

WORKDIR /app
COPY tools/gap-scoring ./tools/gap-scoring

WORKDIR /app/tools/gap-scoring
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=app-builder /app/tools/gap-scoring/.next/standalone ./
COPY --from=app-builder /app/tools/gap-scoring/.next/static ./tools/gap-scoring/.next/static
COPY --from=app-builder /app/tools/gap-scoring/public ./tools/gap-scoring/public

EXPOSE 3000

CMD ["node", "tools/gap-scoring/server.js"]
