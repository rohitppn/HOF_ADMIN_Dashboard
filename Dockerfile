FROM node:22-bookworm-slim

WORKDIR /app

# Root prod deps first — layer caches well when only source files change.
COPY package*.json ./
RUN npm ci --omit=dev

# Dashboard build deps (dev deps needed for Vite).
# npm install (not npm ci) so this works before a package-lock.json is committed.
COPY dashboard/package*.json ./dashboard/
RUN cd dashboard && npm install

# App source.
COPY . .

# Build the dashboard SPA, then delete build-only node_modules to shrink image.
RUN cd dashboard && npm run build && rm -rf node_modules

# Persistent dirs (Railway volumes mount over these). data/ is legacy — kept for reference.
RUN mkdir -p auth exports

EXPOSE 3001
CMD ["npm", "start"]
