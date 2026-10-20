FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run typecheck && npm run build
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DEMO_MODE=false
COPY package*.json ./
RUN npm ci --omit=dev && mkdir -p /app/data && chown node:node /app/data
COPY --from=build /app/dist ./dist
COPY --from=build /app/backend ./backend
COPY --from=build /app/server.js ./server.js
USER node
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "server.js"]
