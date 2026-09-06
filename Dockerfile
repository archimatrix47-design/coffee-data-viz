# The processed data is committed, so the image needs no build step and no network access
# beyond npm install. Running the pipeline here instead would mean a 420MB FAOSTAT download
# on every build, to produce a file that only changes when FAOSTAT publishes.

FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

# Dependencies first, so a code change does not reinstall them.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY server ./server
COPY pipeline ./pipeline
COPY web ./web
COPY data/processed ./data/processed

# NODE_ENV=production already switches the dev routes and the local-save endpoint off;
# this is here so the intent survives someone overriding NODE_ENV.
ENV ALLOW_DEV_ROUTES=0

# The server reads PORT, so a platform that assigns one is respected.
ENV PORT=3200
EXPOSE 3200

# Fail the container rather than serve errors if the data did not come along.
HEALTHCHECK --interval=30s --timeout=4s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3200)+'/api/meta').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# node directly, not npm: npm swallows signals, so the container would ignore SIGTERM
# and take the platform's full kill timeout to stop.
CMD ["node", "server/index.mjs"]
