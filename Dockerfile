FROM oven/bun:1.3

WORKDIR /app
COPY . .
RUN bun install
RUN bun run build

ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000
CMD ["bun", ".output/server/index.mjs"]
