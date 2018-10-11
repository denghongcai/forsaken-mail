FROM node:latest
MAINTAINER Hongcai Deng <admin@dhchouse.com>

RUN apt-get clean all
RUN apt-get update
RUN apt-get -y install git
RUN git clone https://github.com/denghongcai/forsaken-mail.git /forsaken-mail

WORKDIR /forsaken-mail

RUN npm install

EXPOSE 25
EXPOSE 3000
CMD npm start
