FROM node:20-alpine

WORKDIR /app

COPY client/package*.json ./client/
RUN cd client && npm ci

COPY client ./client
RUN cd client && npm run build

COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

COPY server ./server

WORKDIR /app/server
EXPOSE 8081
CMD ["node", "index.js"]