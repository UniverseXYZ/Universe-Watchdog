FROM node:14 as builder
WORKDIR /workdir

COPY package.json package-lock.json ./
RUN npm install

COPY tsconfig.json tsconfig.build.json ormconfig.ts ./
COPY src ./src
COPY migrations ./migrations
RUN npm run build

# production images
FROM node:14-alpine

RUN apk add --no-cache tini
ENTRYPOINT ["/sbin/tini", "--", "node", "./dist/main.js"]

WORKDIR /workdir
COPY --from=builder /workdir .