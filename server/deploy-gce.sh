#!/bin/bash
# ============================================================================
# Deploy IBKR Proxy to Google Cloud Free-Tier VM
# ============================================================================
# This script creates a free-forever Google Compute Engine e2-micro VM
# that runs the IBKR Client Portal Gateway + CORS proxy.
#
# Google Cloud Free Tier includes:
#   - 1 e2-micro VM (always free in us-central1, us-west1, or us-east1)
#   - 30 GB standard persistent disk
#   - 1 GB outbound network per month
#
# Prerequisites:
#   1. Google Cloud account (same one used for Firebase)
#   2. gcloud CLI installed: https://cloud.google.com/sdk/docs/install
#   3. Logged in: gcloud auth login
#   4. Project set: gcloud config set project YOUR_PROJECT_ID
#
# Usage:
#   chmod +x deploy-gce.sh
#   ./deploy-gce.sh
# ============================================================================

set -e

# Configuration - edit these
VM_NAME="ibkr-gateway"
ZONE="us-central1-a"           # Free tier zones: us-central1, us-west1, us-east1
MACHINE_TYPE="e2-micro"         # Free tier machine type
DISK_SIZE="30"                  # GB (free tier allows 30GB)
IMAGE_FAMILY="debian-12"
IMAGE_PROJECT="debian-cloud"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}============================================================${NC}"
echo -e "${GREEN}  IBKR Gateway - Google Cloud Free VM Deployment${NC}"
echo -e "${GREEN}============================================================${NC}"
echo ""

# Check gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}Error: gcloud CLI not installed${NC}"
    echo "Install it from: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Check logged in
PROJECT=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJECT" ] || [ "$PROJECT" = "(unset)" ]; then
    echo -e "${RED}Error: No Google Cloud project set${NC}"
    echo "Run: gcloud config set project YOUR_PROJECT_ID"
    echo "(Use the same project as your Firebase app)"
    exit 1
fi

echo -e "  Project:      ${YELLOW}${PROJECT}${NC}"
echo -e "  VM Name:      ${YELLOW}${VM_NAME}${NC}"
echo -e "  Zone:         ${YELLOW}${ZONE}${NC}"
echo -e "  Machine Type: ${YELLOW}${MACHINE_TYPE}${NC} (free tier)"
echo -e "  Disk:         ${YELLOW}${DISK_SIZE}GB${NC} (free tier)"
echo ""

# Generate a random API key
API_KEY=$(openssl rand -hex 24)
echo -e "  Generated API Key: ${YELLOW}${API_KEY}${NC}"
echo -e "  ${RED}SAVE THIS KEY - you'll need it in the web app Settings${NC}"
echo ""

read -p "Proceed? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo -e "${GREEN}Step 1: Creating firewall rules...${NC}"
gcloud compute firewall-rules create allow-ibkr-proxy \
    --allow tcp:5001 \
    --target-tags ibkr-proxy \
    --description "Allow traffic to IBKR CORS proxy" \
    2>/dev/null || echo "  (Proxy firewall rule already exists, skipping)"

gcloud compute firewall-rules create allow-ibkr-gateway-login \
    --allow tcp:5000 \
    --target-tags ibkr-proxy \
    --description "Allow IBKR Gateway login page access" \
    2>/dev/null || echo "  (Gateway firewall rule already exists, skipping)"

echo ""
echo -e "${GREEN}Step 2: Creating VM...${NC}"

# Create the startup script
STARTUP_SCRIPT=$(cat <<'STARTUP'
#!/bin/bash
# Install Docker
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    usermod -aG docker $USER
fi

# Install Docker Compose
if ! command -v docker-compose &> /dev/null; then
    apt-get update
    apt-get install -y docker-compose-plugin
fi

# Create app directory
mkdir -p /opt/ibkr
echo "VM startup complete. SSH in and run setup-vm.sh to finish." > /opt/ibkr/status.txt
STARTUP
)

gcloud compute instances create "$VM_NAME" \
    --zone="$ZONE" \
    --machine-type="$MACHINE_TYPE" \
    --image-family="$IMAGE_FAMILY" \
    --image-project="$IMAGE_PROJECT" \
    --boot-disk-size="${DISK_SIZE}GB" \
    --boot-disk-type="pd-standard" \
    --tags="ibkr-proxy" \
    --metadata=startup-script="$STARTUP_SCRIPT"

echo ""
echo -e "${GREEN}Step 3: Waiting for VM to start...${NC}"
sleep 15

# Get the external IP
EXTERNAL_IP=$(gcloud compute instances describe "$VM_NAME" \
    --zone="$ZONE" \
    --format='get(networkInterfaces[0].accessConfigs[0].natIP)')

echo ""
echo -e "${GREEN}============================================================${NC}"
echo -e "${GREEN}  VM Created Successfully!${NC}"
echo -e "${GREEN}============================================================${NC}"
echo ""
echo -e "  External IP:    ${YELLOW}${EXTERNAL_IP}${NC}"
echo -e "  Proxy URL:      ${YELLOW}http://${EXTERNAL_IP}:5001${NC}"
echo -e "  API Key:        ${YELLOW}${API_KEY}${NC}"
echo ""
echo -e "${GREEN}  Next Steps:${NC}"
echo ""
echo "  1. SSH into the VM:"
echo -e "     ${YELLOW}gcloud compute ssh ${VM_NAME} --zone=${ZONE}${NC}"
echo ""
echo "  2. Copy setup-vm.sh to the VM:"
echo -e "     ${YELLOW}gcloud compute scp server/setup-vm.sh ${VM_NAME}:/opt/ibkr/ --zone=${ZONE}${NC}"
echo ""
echo "  3. Run the setup script on the VM:"
echo -e "     ${YELLOW}cd /opt/ibkr && chmod +x setup-vm.sh && sudo ./setup-vm.sh${NC}"
echo ""
echo "  4. Download IBKR Gateway on the VM:"
echo -e "     The setup script will guide you through this."
echo ""
echo "  5. Start everything:"
echo -e "     ${YELLOW}cd /opt/ibkr && PROXY_API_KEY=${API_KEY} docker compose up -d${NC}"
echo ""
echo "  6. Log into IBKR Gateway:"
echo -e "     Visit ${YELLOW}https://${EXTERNAL_IP}:5000${NC} in your browser"
echo -e "     Accept the self-signed certificate warning"
echo -e "     Log in with your IBKR credentials"
echo ""
echo "  7. In your web app Settings, enter:"
echo -e "     Gateway URL:  ${YELLOW}http://${EXTERNAL_IP}:5001${NC}"
echo -e "     Account ID:   ${YELLOW}Your IBKR account ID${NC}"
echo -e "     API Key:      ${YELLOW}${API_KEY}${NC}"
echo ""
echo -e "${GREEN}============================================================${NC}"

# Save config for later reference
cat > /tmp/ibkr-vm-config.txt <<EOF
IBKR Gateway VM Configuration
==============================
VM Name:     ${VM_NAME}
Zone:        ${ZONE}
External IP: ${EXTERNAL_IP}
Proxy URL:   http://${EXTERNAL_IP}:5001
API Key:     ${API_KEY}

SSH:         gcloud compute ssh ${VM_NAME} --zone=${ZONE}
SCP:         gcloud compute scp FILE ${VM_NAME}:/opt/ibkr/ --zone=${ZONE}

Web App Settings:
  Gateway URL: http://${EXTERNAL_IP}:5001
  API Key:     ${API_KEY}
EOF

echo ""
echo -e "  Config saved to: ${YELLOW}/tmp/ibkr-vm-config.txt${NC}"
