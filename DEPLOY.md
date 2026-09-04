# Deploy — inventory.acronix.in (VPS: Nginx + PM2 + SSL)

Same pattern as the existing WhatsApp project on this server. Single domain:
- `https://inventory.acronix.in`        → **frontend** (Next.js, port **3030**)
- `https://inventory.acronix.in/api`    → **backend**  (Express, port **3031**)
- **Postgres** stays on the same box, reached over **localhost** (so 5432 never faces the internet).

> Ports 3000/4000 are taken by the WhatsApp app, so this app uses **3030 (web)** and **3031 (api)**.
> These ports appear in `backend/.env` (PORT), the PM2 config, and the Nginx `proxy_pass` lines below.

---

## 0. DNS (once)
Point an **A record** for `inventory.acronix.in` → this server's IP (`147.93.19.105`).
Verify: `dig +short inventory.acronix.in` returns the IP.

## 1. Get the code
```bash
cd /var/www            # or wherever the WhatsApp project lives
git clone https://github.com/AjayPrasadVerma/inventory.git
cd inventory
```

## 2. Backend — env, install, migrate, seed
Create `backend/.env` (NOT committed):
```bash
cat > backend/.env <<'EOF'
DATABASE_URL=postgres://acronix:YOUR_DB_PASSWORD@localhost:5432/inventory
JWT_SECRET=PASTE_A_LONG_RANDOM_STRING     # generate: openssl rand -hex 48
PORT=3031
NODE_ENV=production
CORS_ORIGIN=https://inventory.acronix.in
SEED_OWNER_NAME=Owner
SEED_OWNER_MOBILE=7635097382
SEED_OWNER_PASSWORD=SET_A_STRONG_PASSWORD
EOF
```
Notes:
- Use **localhost** in DATABASE_URL — backend and DB are on the same box, so traffic never leaves it (no TLS needed, and we firewall 5432 below).
- `SEED_OWNER_PASSWORD` is **required** (no insecure default) — set a real one.
- **No `JWT_EXPIRES_IN` line.** Access tokens default to 15 minutes and both clients renew silently through `POST /api/auth/refresh`. An existing `.env` carrying `JWT_EXPIRES_IN=7d` keeps seven-day access tokens — that name is still read, after `ACCESS_TOKEN_TTL` — so **delete that line** to pick the short default up. The running server reads its env from `/opt/inventory/.env.api`, not from this file.
- Migrations are **not** run by the deploy. Apply them by hand (`npm run migrate`) before the code that needs them ships — see CLAUDE.md §4.

Install (tsx is a devDependency and is needed to run — do a **full** install, not `--omit=dev`):
```bash
cd backend
npm install
npm run migrate      # applies all migrations incl. 004_indexes.sql
npm run seed         # creates the owner login (skips if it already exists)
cd ..
```

## 3. Frontend — env, install, build
`NEXT_PUBLIC_API_URL` is baked in at **build time**, so set it before building:
```bash
cd frontend
cat > .env.production <<'EOF'
NEXT_PUBLIC_API_URL=https://inventory.acronix.in/api
EOF
npm install
npm run build
cd ..
```

## 4. Run both with PM2
Create `ecosystem.config.js` in the repo root:
```js
module.exports = {
  apps: [
    {
      name: 'inventory-api',
      cwd: './backend',
      script: 'npm',
      args: 'start',                 // tsx src/index.ts
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'inventory-web',
      cwd: './frontend',
      script: 'npm',
      args: 'start -- -p 3030',      // next start on port 3030
      env: { NODE_ENV: 'production' },
    },
  ],
};
```
Start + persist:
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup        # run the line it prints, so PM2 revives on reboot
```
Check: `pm2 status` (both online), `curl -s localhost:3031/api/health` → `{"ok":true,...}`.

## 5. Nginx — reverse proxy
`/etc/nginx/sites-available/inventory.acronix.in`:
```nginx
server {
    listen 80;
    server_name inventory.acronix.in;

    # API → backend
    location /api/ {
        proxy_pass http://127.0.0.1:3031;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Everything else → Next.js frontend
    location / {
        proxy_pass http://127.0.0.1:3030;
        proxy_http_version 1.1;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        'upgrade';
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
Enable + reload:
```bash
ln -s /etc/nginx/sites-available/inventory.acronix.in /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```
> `X-Forwarded-For` above + `trust proxy` in the app = the login rate-limiter sees real client IPs.

## 6. HTTPS (Let's Encrypt)
```bash
certbot --nginx -d inventory.acronix.in
```
Certbot rewrites the vhost to 443 + auto-renews. After this, `https://inventory.acronix.in` is live.

## 7. Firewall — close the DB to the world (important)
```bash
ufw allow 22
ufw allow 80
ufw allow 443
ufw deny 5432        # Postgres only reachable via localhost now
ufw enable
```
(If Postgres also listens on the public IP, bind it to localhost in `postgresql.conf`:
`listen_addresses = 'localhost'`, then `systemctl restart postgresql`.)

---

## First login
`https://inventory.acronix.in` → mobile `7635097382` + the `SEED_OWNER_PASSWORD` you set. Change it after login.

## Updating later (after `git push`)
```bash
cd /var/www/inventory && git pull
cd backend  && npm install && npm run migrate && cd ..
cd frontend && npm install && npm run build && cd ..
pm2 restart inventory-api inventory-web
```

## Quick checks if something breaks
- `pm2 logs inventory-api` / `pm2 logs inventory-web`
- `curl -s localhost:3031/api/health`
- `nginx -t`, `tail -f /var/log/nginx/error.log`
- 502 = the Node app on 3030/3031 isn't running (check `pm2 status`).
