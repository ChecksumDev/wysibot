FROM oven/bun

# Create a working directory and copy the source code
WORKDIR /srv/wysibotbs
COPY . .

RUN bun install

RUN bun build --minify --target=bun src/index.ts --outfile=dist/index.js

# Run
CMD ["bun", "dist/index.js"]
