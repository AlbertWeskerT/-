FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
COPY desktop-client/package.json desktop-client/package-lock.json ./desktop-client/
COPY signaling-server/package.json signaling-server/package-lock.json ./signaling-server/
RUN npm ci

COPY shared ./shared
COPY desktop-client ./desktop-client
COPY signaling-server ./signaling-server
COPY scripts ./scripts
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
EXPOSE 8787
CMD ["npm", "run", "start", "--workspace", "signaling-server"]
