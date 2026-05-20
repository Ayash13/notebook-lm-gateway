FROM node:20-slim

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

RUN npx playwright install --with-deps chromium

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# Don't copy auth-state.json - use secrets instead
COPY src ./src
COPY public ./public
COPY index.js .

EXPOSE 3005

CMD ["node", "index.js"]