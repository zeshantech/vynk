FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production MCP_HTTP_PORT=3100
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3100/mcp/health || exit 1
CMD ["node", "src/index.js"]
