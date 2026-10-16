FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/cloudspend.db

COPY package*.json ./
# better-sqlite3 ships prebuilt binaries for linux x64/arm64; no compiler needed.
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public
COPY views ./views

# Persistent database location (mount a volume here).
RUN mkdir /data && chown node:node /data
VOLUME /data

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
