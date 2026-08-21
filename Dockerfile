# syntax=docker/dockerfile:1

FROM node:24-alpine AS base
WORKDIR /app
ENV YARN_CACHE_FOLDER=/tmp/.yarn-cache

FROM base AS deps
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production && yarn cache clean

FROM base AS build
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN yarn build

FROM base AS dev
ENV NODE_ENV=development
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
CMD ["yarn", "dev"]

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache dumb-init

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./

USER node

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
