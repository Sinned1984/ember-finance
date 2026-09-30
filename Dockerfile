FROM node:24-alpine AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN npm install --global pnpm@11.19.0

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
# The standalone tracer bundles app imports, not dependencies of the separate CLI.
# Dereference pnpm's link and keep this zero-dependency package beside the script.
RUN mkdir -p /auth-runtime/node_modules && cp -RL node_modules/bcryptjs /auth-runtime/node_modules/bcryptjs

FROM base AS builder
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public && pnpm build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
RUN addgroup --system --gid 1001 ember && adduser --system --uid 1001 --ingroup ember ember
RUN mkdir -p /var/lib/ember-auth && chown ember:ember /var/lib/ember-auth && chmod 700 /var/lib/ember-auth
COPY --from=builder --chown=ember:ember /app/.next/standalone ./
COPY --from=builder --chown=ember:ember /app/.next/static ./.next/static
COPY --from=builder --chown=ember:ember /app/public ./public
COPY --from=builder --chown=ember:ember /app/scripts ./scripts
COPY --from=dependencies --chown=ember:ember /auth-runtime/node_modules ./scripts/node_modules
COPY --from=builder --chown=ember:ember /app/src/lib/config-validation.ts ./src/lib/config-validation.ts
COPY --from=builder --chown=ember:ember /app/src/lib/deployment-config.ts ./src/lib/deployment-config.ts
COPY --from=builder --chown=ember:ember /app/src/lib/auth/config.ts ./src/lib/auth/config.ts
COPY --from=builder --chown=ember:ember /app/src/lib/auth/auth-state.ts ./src/lib/auth/auth-state.ts
USER ember
# Exercise CLI module resolution in the final image without retaining generated secrets.
RUN node scripts/auth-config.mjs secret > /dev/null && test -f scripts/totp-admin.mjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["node", "scripts/healthcheck.mjs"]
CMD ["node", "scripts/start.mjs"]
