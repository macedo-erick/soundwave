# syntax=docker/dockerfile:1

# The bot never handles audio, so this image needs no ffmpeg, no yt-dlp and no
# Python — Lavalink does all extraction and streaming in its own container.

FROM node:24-alpine AS base
WORKDIR /app
ENV YARN_CACHE_FOLDER=/tmp/.yarn-cache

# --- deps: production dependencies only, copied into the final image ---------
FROM base AS deps
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production && yarn cache clean

# --- build: full dependency set, compiles TypeScript to dist/ ----------------
FROM base AS build
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN yarn build

# --- dev: hot reload, used by compose.override.yaml -------------------------
FROM base AS dev
ENV NODE_ENV=development
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
CMD ["yarn", "dev"]

# --- runtime: production image ----------------------------------------------
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# dumb-init as PID 1 so SIGTERM reaches Node and shutdown stays graceful.
RUN apk add --no-cache dumb-init

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./

USER node

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
