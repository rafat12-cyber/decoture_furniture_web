# Decoture store: one Node process, no packages to install. Data lives in /data (mount a volume).
FROM node:22-alpine
WORKDIR /app
COPY . .
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "server/server.mjs"]
