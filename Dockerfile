FROM debian:stable-slim

# Switch to the bash shell
SHELL ["/bin/bash", "-c"]

# Install dependencies
RUN apt update
RUN apt install -y curl unzip

# Create a user
RUN adduser --system --disabled-password --uid 727 --group --shell /bin/bash wysi
USER wysi

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash 
RUN source /home/wysi/.bashrc

# Create a working directory and copy the source code
WORKDIR /srv/wysibotbs
COPY . .

# Install dependencies
RUN bun install

# Build
RUN bun build --minify --target=bun src/index.ts --outfile=dist/index.js

# Run
CMD ["node", "dist/index.js"]