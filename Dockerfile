FROM node:20-slim

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

RUN npx playwright install --with-deps chromium

WORKDIR /app

RUN mkdir -p data

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3005

CMD ["node", "index.js"]
