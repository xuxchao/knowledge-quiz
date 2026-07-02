FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY pnpm-lock.yaml ./

RUN npm install -g pnpm && pnpm install --prod

COPY . .

RUN pnpm run build

EXPOSE 3001

CMD ["pnpm", "run", "start:prod"]
