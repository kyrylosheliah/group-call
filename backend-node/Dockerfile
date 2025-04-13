FROM node:18

# Install required build tools for mediasoup
RUN apt-get update && apt-get install -y python3-pip

WORKDIR /app
COPY /package*.json ./
RUN npm install

COPY . .
RUN mkdir -p uploads

EXPOSE 3000
CMD ["npm", "start"]
