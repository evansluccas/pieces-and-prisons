# Pieces & Prisons — one container: the game server, which also serves the built app.
# Built from the repository root (the app needs ../assets for its sprites).

FROM node:24-slim AS build
WORKDIR /repo/app
COPY app/package.json app/package-lock.json ./
RUN npm ci
COPY assets /repo/assets
COPY app ./
# type-check, build the web app into dist/, then drop the development tools
RUN npm run build && npm prune --omit=dev

FROM node:24-slim
ENV NODE_ENV=production PORT=8080 DB_PATH=/data/pieces.db
WORKDIR /repo/app
COPY --from=build /repo/app/package.json ./
COPY --from=build /repo/app/node_modules ./node_modules
COPY --from=build /repo/app/dist ./dist
COPY --from=build /repo/app/server ./server
COPY --from=build /repo/app/src ./src
EXPOSE 8080
# The database volume is mounted owned by root: hand it to the unprivileged
# "node" user, then run the server as that user.
CMD ["sh", "-c", "mkdir -p /data && chown -R node:node /data && exec setpriv --reuid=node --regid=node --init-groups node_modules/.bin/tsx server/index.ts"]
