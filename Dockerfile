# Path B production image. TLS terminates at App Runner / ALB — this process
# speaks HTTP on PORT and sets trust proxy in production.
# Build: docker build -t chiro-kpi .
# Do not bake .env or backups into the image.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY tsconfig.json vite.config.ts postcss.config.js tailwind.config.ts ./
COPY client ./client
COPY shared ./shared
COPY server ./server
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5000
RUN addgroup -S app && adduser -S app -G app
COPY package.json package-lock.json tsconfig.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
USER app
EXPOSE 5000
CMD ["./node_modules/.bin/tsx", "server/index.ts"]
