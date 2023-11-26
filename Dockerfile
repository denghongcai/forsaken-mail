FROM node:lts-alpine
MAINTAINER Hongcai Deng <admin@dhchouse.com>,Ruiqian <admin@imgki.com>

RUN mkdir /forsaken-mail 

COPY . /forsaken-mail 

WORKDIR /forsaken-mail

RUN npm install --production \
    && npm cache clean --force

EXPOSE 25
EXPOSE 3000
CMD ["npm", "start"]

