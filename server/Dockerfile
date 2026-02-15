# ============================================================================
# Dockerfile for IBKR CORS Proxy
# ============================================================================
# Build and run:
#   docker build -t ibkr-proxy ./server
#   docker run -d -p 5001:5001 \
#     -e PROXY_API_KEY=your-secret-key \
#     -e IBKR_GATEWAY_URL=https://host.docker.internal:5000 \
#     -e ALLOWED_ORIGINS=https://your-app.web.app \
#     --name ibkr-proxy \
#     ibkr-proxy
#
# Note: Use host.docker.internal to reach the IBKR Gateway running on
# the host machine. On Linux, add --add-host=host.docker.internal:host-gateway
# ============================================================================

FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY proxy.js ./

ENV PROXY_PORT=5001
ENV IBKR_GATEWAY_URL=https://host.docker.internal:5000
ENV PROXY_API_KEY=""
ENV ALLOWED_ORIGINS="*"

EXPOSE 5001

CMD ["node", "proxy.js"]
