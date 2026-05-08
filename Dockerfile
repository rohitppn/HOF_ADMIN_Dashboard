FROM node:20-bookworm-slim

WORKDIR /app

# Install only production deps. Node 20 + glibc → better-sqlite3 prebuilt binary
# is downloaded directly, no native compile, no python/node-gyp needed.
COPY package*.json ./
RUN npm ci --omit=dev

# App source
COPY . .

# Persistent dirs (Railway volumes mount over these)
RUN mkdir -p auth data exports

EXPOSE 3001
CMD ["npm", "start"]
