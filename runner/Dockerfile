FROM node:22-alpine

WORKDIR /app
COPY package.json .
RUN npm install
COPY server.js .
COPY gateway.js .
EXPOSE 3001
CMD ["npm", "start"]
