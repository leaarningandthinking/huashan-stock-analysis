FROM node:20-alpine

WORKDIR /app

# 国内镜像（开源项目用户友好）
RUN npm config set registry https://registry.npmmirror.com

COPY package.json package-lock.json* ./

RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]
