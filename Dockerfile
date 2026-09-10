# Pink Petal Closet on Cloud Run.
#
# The server has zero dependencies, so the build is a copy — there is no
# `npm install` step, no lockfile to drift, and no third-party code in the one
# process that holds the credential.
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# .gcloudignore keeps the test harness, the docs and the PowerShell dev scripts
# out of the build context, so this copies the app and nothing else.
COPY . .

# Cloud Run injects PORT and the server reads it; 8080 is what it uses, and the
# default here so the image also runs plainly with `docker run -p 8080:8080`.
ENV PORT=8080
EXPOSE 8080

# Nothing here needs to write to disk, so it does not run as root.
USER node

CMD ["node", "server/server.js"]
