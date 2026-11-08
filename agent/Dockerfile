FROM node:22-alpine
WORKDIR /app
COPY server.mjs ./
# Maritime mounts /data and injects PORT; 8080 is only the local default.
# Runs as root on purpose: Maritime mounts /data at boot and its owner is not
# documented, so a non-root user could fail to save teacher feedback. The agent
# runs alone in its own micro-VM.
RUN mkdir -p /data
ENV NODE_ENV=production
EXPOSE 8080
# Absolute path: the micro-VM init re-runs CMD as one flat string.
CMD ["node", "/app/server.mjs"]
