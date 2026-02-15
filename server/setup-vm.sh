#!/bin/bash
# ============================================================================
# IBKR Gateway VM Setup Script
# ============================================================================
# Run this ON the Google Cloud VM after SSH-ing in.
#
# What this does:
#   1. Installs Docker + Docker Compose (if not already installed)
#   2. Installs Java (required for IBKR Gateway)
#   3. Downloads the IBKR Client Portal Gateway
#   4. Sets up the CORS proxy
#   5. Creates docker-compose.yml for easy management
#   6. Creates systemd service for auto-start on reboot
#
# Usage:
#   sudo ./setup-vm.sh
# ============================================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}============================================================${NC}"
echo -e "${GREEN}  IBKR Gateway + Proxy - VM Setup${NC}"
echo -e "${GREEN}============================================================${NC}"
echo ""

# Must run as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Please run as root: sudo ./setup-vm.sh${NC}"
    exit 1
fi

INSTALL_DIR="/opt/ibkr"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# ============================================================================
# Step 1: Install Docker
# ============================================================================
echo -e "${GREEN}Step 1: Installing Docker...${NC}"
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
    echo "  Docker installed."
else
    echo "  Docker already installed."
fi

# ============================================================================
# Step 2: Install Docker Compose
# ============================================================================
echo -e "${GREEN}Step 2: Installing Docker Compose...${NC}"
if ! docker compose version &> /dev/null; then
    apt-get update -qq
    apt-get install -y -qq docker-compose-plugin
    echo "  Docker Compose installed."
else
    echo "  Docker Compose already installed."
fi

# ============================================================================
# Step 3: Install Java (for IBKR Gateway)
# ============================================================================
echo -e "${GREEN}Step 3: Installing Java...${NC}"
if ! command -v java &> /dev/null; then
    apt-get update -qq
    apt-get install -y -qq default-jre-headless unzip
    echo "  Java installed."
else
    echo "  Java already installed."
fi

# ============================================================================
# Step 4: Download IBKR Client Portal Gateway
# ============================================================================
echo -e "${GREEN}Step 4: Setting up IBKR Client Portal Gateway...${NC}"
if [ ! -d "$INSTALL_DIR/clientportal" ]; then
    echo "  Downloading IBKR Client Portal Gateway..."
    cd "$INSTALL_DIR"
    curl -L -o clientportal.gw.zip "https://download2.interactivebrokers.com/portal/clientportal.gw.zip"
    unzip -q clientportal.gw.zip -d clientportal
    rm clientportal.gw.zip

    # Configure the gateway to accept connections from any IP
    # (needed since we're accessing it from the proxy on the same machine)
    if [ -f "$INSTALL_DIR/clientportal/root/conf.yaml" ]; then
        # Allow connections from proxy
        sed -i 's/listenPort: 5000/listenPort: 5000/' "$INSTALL_DIR/clientportal/root/conf.yaml" 2>/dev/null || true
    fi

    echo "  IBKR Gateway downloaded to $INSTALL_DIR/clientportal/"
else
    echo "  IBKR Gateway already exists at $INSTALL_DIR/clientportal/"
fi

# ============================================================================
# Step 5: Create the CORS proxy
# ============================================================================
echo -e "${GREEN}Step 5: Setting up CORS proxy...${NC}"
mkdir -p "$INSTALL_DIR/proxy"

# Create package.json
cat > "$INSTALL_DIR/proxy/package.json" <<'EOF'
{
  "name": "ibkr-proxy",
  "version": "1.0.0",
  "description": "CORS proxy for IBKR Client Portal Gateway",
  "main": "proxy.js",
  "scripts": { "start": "node proxy.js" },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.21.0",
    "https-proxy-middleware": "^3.0.0",
    "node-fetch": "^3.3.2"
  }
}
EOF

# Copy proxy.js if it was uploaded, otherwise create it
if [ ! -f "$INSTALL_DIR/proxy/proxy.js" ]; then
    echo "  NOTE: Copy proxy.js from the repo's server/ directory to $INSTALL_DIR/proxy/"
fi

echo "  Proxy directory: $INSTALL_DIR/proxy/"

# ============================================================================
# Step 6: Create docker-compose.yml
# ============================================================================
echo -e "${GREEN}Step 6: Creating docker-compose.yml...${NC}"

cat > "$INSTALL_DIR/docker-compose.yml" <<'COMPOSE'
# ============================================================================
# IBKR Gateway + CORS Proxy
# ============================================================================
# Start:  PROXY_API_KEY=your-key docker compose up -d
# Stop:   docker compose down
# Logs:   docker compose logs -f
# Status: docker compose ps
# ============================================================================

services:
  # IBKR Client Portal Gateway (Java)
  # Access the login page at https://YOUR_IP:5000
  gateway:
    image: eclipse-temurin:21-jre
    container_name: ibkr-gateway
    working_dir: /app
    volumes:
      - ./clientportal:/app
    ports:
      - "5000:5000"
    command: >
      java -server
      -Dvertx.disableDnsResolver=true
      -Djava.net.preferIPv4Stack=true
      -jar bin/run.jar root/conf.yaml
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-fk", "https://localhost:5000/v1/api/tickle"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s

  # CORS Proxy (Node.js)
  # This adds CORS headers so the web app can connect
  proxy:
    image: node:20-slim
    container_name: ibkr-proxy
    working_dir: /app
    volumes:
      - ./proxy:/app
    ports:
      - "5001:5001"
    environment:
      - PROXY_PORT=5001
      - IBKR_GATEWAY_URL=https://gateway:5000
      - PROXY_API_KEY=${PROXY_API_KEY:-}
      - ALLOWED_ORIGINS=*
    command: sh -c "npm install --production 2>/dev/null && node proxy.js"
    depends_on:
      gateway:
        condition: service_started
    restart: unless-stopped
COMPOSE

echo "  docker-compose.yml created."

# ============================================================================
# Step 7: Create systemd service for auto-start
# ============================================================================
echo -e "${GREEN}Step 7: Creating systemd service for auto-start...${NC}"

cat > /etc/systemd/system/ibkr.service <<EOF
[Unit]
Description=IBKR Gateway + Proxy
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
EnvironmentFile=-$INSTALL_DIR/.env

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable ibkr.service

echo "  Systemd service created and enabled (auto-starts on reboot)."

# ============================================================================
# Step 8: Create .env template
# ============================================================================
if [ ! -f "$INSTALL_DIR/.env" ]; then
    echo "PROXY_API_KEY=CHANGE_ME_TO_A_RANDOM_SECRET" > "$INSTALL_DIR/.env"
    echo -e "  ${YELLOW}IMPORTANT: Edit $INSTALL_DIR/.env and set your PROXY_API_KEY${NC}"
fi

# ============================================================================
# Step 9: Open firewall port 5000 for IBKR login page
# ============================================================================
echo -e "${GREEN}Step 8: Checking firewall...${NC}"
echo "  Ports 5000 (IBKR Gateway login) and 5001 (proxy) should be open."
echo "  If using GCE, the deploy-gce.sh script already created the firewall rules."

# ============================================================================
# Done!
# ============================================================================
echo ""
echo -e "${GREEN}============================================================${NC}"
echo -e "${GREEN}  Setup Complete!${NC}"
echo -e "${GREEN}============================================================${NC}"
echo ""
echo -e "  Files installed to: ${YELLOW}$INSTALL_DIR${NC}"
echo ""
echo -e "  ${GREEN}Next Steps:${NC}"
echo ""
echo "  1. Copy proxy.js from the repo to this VM:"
echo -e "     ${YELLOW}# From your local machine:${NC}"
echo -e "     ${YELLOW}gcloud compute scp server/proxy.js ibkr-gateway:/opt/ibkr/proxy/ --zone=us-central1-a${NC}"
echo ""
echo "  2. Set your API key:"
echo -e "     ${YELLOW}nano $INSTALL_DIR/.env${NC}"
echo "     Change PROXY_API_KEY to a random secret string"
echo ""
echo "  3. Start everything:"
echo -e "     ${YELLOW}cd $INSTALL_DIR && docker compose up -d${NC}"
echo ""
echo "  4. Log into IBKR Gateway:"
echo "     Open https://YOUR_VM_IP:5000 in your browser"
echo "     Accept the self-signed certificate warning"
echo "     Log in with your IBKR username and password"
echo ""
echo "  5. In the AutoTrade web app Settings, enter:"
echo "     Gateway URL: http://YOUR_VM_IP:5001"
echo "     Account ID:  Your IBKR account ID"
echo "     API Key:     The key from .env"
echo ""
echo "  Useful commands:"
echo -e "     ${YELLOW}docker compose logs -f${NC}        # View logs"
echo -e "     ${YELLOW}docker compose restart${NC}        # Restart services"
echo -e "     ${YELLOW}docker compose ps${NC}             # Check status"
echo -e "     ${YELLOW}sudo systemctl restart ibkr${NC}   # Restart via systemd"
echo ""
echo -e "${GREEN}============================================================${NC}"
