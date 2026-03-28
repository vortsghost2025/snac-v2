# SNAC v2 Deployment Guide

This document provides instructions for deploying SNAC v2 to your Hostinger VPS and other cloud platforms.

## Prerequisites

- A VPS (Hostinger, Oracle Cloud, etc.) with SSH access
- Git installed on your VPS
- Docker and Docker Compose installed
- Node.js (v18+) and npm installed
- Python 3.11+ with pip

## Creating a Git Repository

Since the remote repository doesn't exist yet, you need to create it first:

1. Go to GitHub.com (or your preferred Git hosting platform)
2. Click "New repository"
3. Name it "snac-v2" 
4. Choose public or private (as needed)
5. Don't initialize with README or .gitignore (we already have these)
6. Click "Create repository"

Then run these commands to push your code:

```bash
# Set the correct remote URL
git remote set-url origin https://github.com/YOUR_GITHUB_USERNAME/snac-v2.git

# Push the code
git push -u origin main
```

## VPS Setup

### 1. Connect to Your VPS

```bash
ssh username@your-vps-ip-address
```

### 2. Install Dependencies

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install Git
sudo apt install git -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Install Node.js and npm
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Python 3.11
sudo apt install software-properties-common
sudo add-apt-repository ppa:deadsnakes/ppa
sudo apt update
sudo apt install python3.11 python3.11-venv python3.11-dev -y
```

### 3. Clone and Prepare SNAC v2

```bash
# Clone the repository
git clone https://github.com/YOUR_GITHUB_USERNAME/snac-v2.git
cd snac-v2/backend

# Create environment file
cp .env.example .env
# Edit .env with your specific configuration
nano .env
```

### 4. Configure Environment Variables

Edit the `.env` file with your specific values:

```bash
# Server configuration
PORT=8000
NODE_ENV=production

# Paths
KILO_WORKSPACE=/home/username/snac-v2/backend

# External services
REDIS_URL=redis://localhost:6379
QDRANT_HOST=localhost
QDRANT_PORT=6333
MLFLOW_URL=http://localhost:5000

# Security
JWT_SECRET=your-super-secret-jwt-key-here
BLIP_SECRET=your-blip-secret-for-authentication
PCM_BLIP_SECRET=another-secret-for-pcm-auth
```

### 5. Deploy Using Docker Compose

```bash
# Build and start all services
docker-compose up -d --build

# Check that all services are running
docker-compose ps
```

## Azure Deployment

### Using Azure Container Instances

```bash
# Create a resource group
az group create --name snacv2-rg --location eastus

# Create an Azure Container Registry
az acr create --resource-group snacv2-rg --name snacv2registry --sku Basic

# Login to registry
az acr login --name snacv2registry

# Tag and push your images
docker tag snac-api snacv2registry.azurecr.io/snac-api
docker push snacv2registry.azurecr.io/snac-api

# Deploy to ACI
az container create \
  --resource-group snacv2-rg \
  --name snacv2-app \
  --image snacv2registry.azurecr.io/snac-api \
  --dns-name-label snacv2-app \
  --ports 8000
```

## Oracle Cloud Deployment

### Using Oracle Cloud Infrastructure (OCI) Compute

1. Create a VM instance with Ubuntu 22.04
2. Follow the VPS setup instructions above
3. Deploy using Docker Compose

## Hostinger VPS Specific Instructions

### Initial Setup

1. Access your Hostinger control panel
2. Create or configure your VPS
3. Note down the IP address and root credentials
4. SSH into your VPS using the credentials

### Firewall Configuration

```bash
# Allow necessary ports
sudo ufw allow ssh
sudo ufw allow 80
sudo ufw allow 443
sudo ufw allow 8000
sudo ufw allow 3001
sudo ufw enable
```

### SSL Certificate Setup with Let's Encrypt

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx -y

# Get SSL certificate (replace with your domain)
sudo certbot --nginx -d yourdomain.com
```

### Running SNAC v2 as a Service

Create a systemd service file:

```bash
sudo nano /etc/systemd/system/snacv2.service
```

Add the following content:

```ini
[Unit]
Description=SNAC v2 Backend Service
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/username/snac-v2/backend
ExecStart=/usr/local/bin/docker-compose up -d
ExecStop=/usr/local/bin/docker-compose down
User=root

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable snacv2
sudo systemctl start snacv2
```

## Monitoring and Maintenance

### Checking Logs

```bash
# Check all service logs
docker-compose logs

# Check specific service logs
docker-compose logs snac-api
docker-compose logs redis
docker-compose logs qdrant
```

### Backup Strategy

```bash
# Backup volumes regularly
docker run --rm -v redis_data:/data -v $(pwd)/backups:/backup alpine tar czf /backup/redis-backup-$(date +%Y%m%d).tar.gz -C /data .
docker run --rm -v qdrant_data:/data -v $(pwd)/backups:/backup alpine tar czf /backup/qdrant-backup-$(date +%Y%m%d).tar.gz -C /data .
```

### Updating SNAC v2

```bash
# Pull latest changes
git pull origin main

# Rebuild and restart services
docker-compose down
docker-compose build
docker-compose up -d
```

## Troubleshooting

### Common Issues

1. **Port Already in Use**: Check if required ports are already occupied:
   ```bash
   sudo netstat -tulpn | grep :8000
   ```

2. **Docker Permission Denied**: Add user to docker group:
   ```bash
   sudo usermod -aG docker $USER
   # Log out and back in
   ```

3. **Insufficient Disk Space**: Check available space:
   ```bash
   df -h
   ```

4. **Docker Images Not Building**: Check Dockerfile and ensure all dependencies are available

5. **GPU Resources Not Available**: In docker-compose, remove or adjust GPU reservation if running on CPU-only servers

## Security Considerations

- Regularly update system packages
- Use strong passwords and SSH keys
- Limit SSH access to specific IPs if possible
- Keep secrets in environment variables, not in code
- Regularly rotate JWT secrets
- Monitor logs for suspicious activity
- Use SSL/TLS for all external communications