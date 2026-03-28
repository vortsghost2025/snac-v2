# Security group / firewall examples

Use the following examples to open ports for the cockpit (recommended: open 80/443 only and proxy traffic).

UFW (Debian/Ubuntu):

```
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

DigitalOcean (firewall CLI):

```
doctl compute firewall create --name "snac-web" --inbound-rules "tcp:80:0.0.0.0/0" "tcp:443:0.0.0.0/0"
```

AWS (Security Group via AWS CLI example):

```
aws ec2 authorize-security-group-ingress --group-id sg-xxxxxxxx --protocol tcp --port 80 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id sg-xxxxxxxx --protocol tcp --port 443 --cidr 0.0.0.0/0
```

GCP (gcloud):

```
gcloud compute firewall-rules create allow-snac-web --allow tcp:80,tcp:443 --source-ranges=0.0.0.0/0 --target-tags=snac-web
```

Azure (az cli):

```
az network nsg rule create --resource-group MyRg --nsg-name MyNsg --name AllowHTTP --priority 1000 --direction Inbound --access Allow --protocol Tcp --destination-port-ranges 80
az network nsg rule create --resource-group MyRg --nsg-name MyNsg --name AllowHTTPS --priority 1001 --direction Inbound --access Allow --protocol Tcp --destination-port-ranges 443
```

Recommendation: restrict source CIDR to your office IPs if you must expose other ports (8000/8001) — otherwise use the nginx proxy pattern above.
