FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=10000

COPY Backend/package*.json ./

RUN npm ci --omit=dev && npm cache clean --force

COPY Backend/ ./

EXPOSE 10000

CMD ["npm", "start"]
