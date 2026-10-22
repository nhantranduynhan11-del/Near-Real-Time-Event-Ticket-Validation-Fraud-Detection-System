FROM node:20-alpine

# Alpine không có sẵn tzdata → cần cho TZ=Asia/Ho_Chi_Minh
RUN apk add --no-cache tzdata

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV TZ=Asia/Ho_Chi_Minh

EXPOSE 3000

CMD ["node", "src/index.js"]