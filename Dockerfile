FROM node:lts-alpine

# Create a working directory and copy the source code
WORKDIR /srv/wysibotbs
COPY . .

# Run
CMD ["node", "dist/index.js"]