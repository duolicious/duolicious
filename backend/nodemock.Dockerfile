FROM node:22

ARG MOCK

WORKDIR /usr/src/app

COPY test/${MOCK} ./

RUN npm install

CMD ["node", "index.js"]
