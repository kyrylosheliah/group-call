FROM ubuntu

RUN apt-get update && \
    apt-get install -y build-essential pip net-tools iputils-ping iproute2 curl

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
RUN apt-get install -y nodejs
RUN npm install -g watchify

WORKDIR /app
COPY /package*.json ./
RUN npm install

COPY . .
RUN mkdir -p uploads

EXPOSE 3000
EXPOSE 2000-2020
EXPOSE 10000-10100
CMD ["npm", "start"]
