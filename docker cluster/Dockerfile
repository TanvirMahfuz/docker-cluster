FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000

ENV REDIS_URL=redis://redis:6379
ENV MONGO_URI='mongodb://mongodb:27017/mydatabase'

CMD ["node", "index.js"]