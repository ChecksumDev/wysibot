FROM node:lts-alpine

# Create a user
RUN adduser --system --disabled-password --uid 727 --group --shell /bin/bash wysi
USER wysi

# Create a working directory and copy the source code
WORKDIR /srv/wysibotbs
COPY . .

# Run
CMD ["node", "dist/index.js"]