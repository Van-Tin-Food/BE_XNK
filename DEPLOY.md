# Hướng dẫn deploy BE_XNK bằng Docker (quản lý qua Portainer)

Tài liệu này mô tả cách đóng gói và chạy backend XNK trên một VPS/server Linux
bằng Docker Compose, quản lý qua Portainer.

Hệ thống gồm **2 service**:

| Service | Nội dung | Port | Expose ra ngoài |
|---------|----------|------|-----------------|
| `api`   | Node.js + Express (REST API) | 5000 | Có |
| `ocr`   | Python + Tesseract (OCR chứng từ) | 8001 | Không (chỉ nội bộ) |

PostgreSQL **không** nằm trong stack này — xem [mục 6](#6-kết-nối-postgresql) để cấu hình kết nối.

---

## Mục lục

1. [Yêu cầu](#1-yêu-cầu)
2. [Chuẩn bị repo](#2-chuẩn-bị-repo)
3. [Các file Docker](#3-các-file-docker)
4. [Biến môi trường](#4-biến-môi-trường)
5. [Deploy bằng Portainer](#5-deploy-bằng-portainer)
6. [Kết nối PostgreSQL](#6-kết-nối-postgresql)
7. [Kiểm tra sau khi deploy](#7-kiểm-tra-sau-khi-deploy)
8. [Cập nhật phiên bản mới](#8-cập-nhật-phiên-bản-mới)
9. [Reverse proxy & HTTPS](#9-reverse-proxy--https)
10. [Xử lý sự cố](#10-xử-lý-sự-cố)
11. [Hạn chế đã biết](#11-hạn-chế-đã-biết)

---

## 1. Yêu cầu

**Trên server:**

- Docker Engine 24+ và Docker Compose v2
- Portainer CE 2.19+
- RAM tối thiểu **2 GB**, khuyến nghị **4 GB** (OCR xử lý ảnh độ phân giải cao khá tốn RAM)
- Dung lượng trống >= 5 GB

**Thông tin cần chuẩn bị trước:**

- Thông tin kết nối PostgreSQL (host, port, database, user, password)
- URL Google Apps Script (`APPSCRIPT_URL`)
- API key OpenRouter (dùng cho bước phân tích chứng từ bằng AI)
- Một chuỗi ngẫu nhiên đủ mạnh làm `JWT_SECRET`

---

## 2. Chuẩn bị repo

### 2.1. Gỡ thư mục `.venv` khỏi Git

Repo hiện đang commit nhầm thư mục `.venv` (~94 MB, 2116 file). Đây là virtualenv
của Windows (Python 3.10 trên `C:\Users\Admin\...`), **hoàn toàn không dùng được**
trong container Linux, nhưng vẫn bị copy vào image làm image phình to và build chậm.

```bash
git rm -r --cached .venv
git commit -m "chore: remove .venv from version control"
```

`.gitignore` đã có sẵn dòng `.venv` nên sau bước này Git sẽ tự bỏ qua nó.

### 2.2. Các file Docker

Bốn file sau **đã có sẵn trong repo**, không cần tạo thủ công:

| File | Mục đích |
|------|----------|
| `.dockerignore` | Ngăn copy rác (và file `.env`) vào image |
| `Dockerfile.api` | Image cho service Node |
| `Dockerfile.ocr` | Image cho service Python OCR |
| `docker-compose.yml` | Định nghĩa stack |

Nội dung và giải thích từng file ở [mục 3](#3-các-file-docker).

Việc duy nhất phải làm thủ công là tạo file `.env` — xem [mục 4.3](#43-file-env-cho-stack).

> **Lưu ý:** `Dockerfile` cũ ở thư mục gốc (chạy cả Node lẫn Python trong một
> container) **không nên dùng nữa** — xem [mục 11.5](#115-không-dùng-dockerfile-gốc).

---

## 3. Các file Docker

Bốn file dưới đây đã có sẵn trong repo. Phần này giải thích những quyết định
không hiển nhiên trong đó, để khi cần sửa thì biết đang đụng vào cái gì.

### 3.1. `.dockerignore`

Quan trọng nhất trong bốn file. Nếu thiếu, `COPY` sẽ nhét cả `.git` (35 MB),
`.venv` (94 MB) và — nguy hiểm nhất — file `.env` chứa mật khẩu vào image.

Ngoài rác thông thường, file này còn loại trừ `update_funtions/` (mã Apps Script
của dự án Dashboard, không thuộc backend này) và các file credential Firebase.

### 3.2. `Dockerfile.api`

Base `node:22-bookworm-slim`. Ba điểm đáng chú ý:

- **`npm ci` chứ không phải `npm install`** — cài đúng theo `package-lock.json`,
  mọi lần build ra cùng một bộ thư viện.
- **Copy `package*.json` trước, `src/` sau** — đổi code mà không đổi dependency
  thì Docker dùng lại layer đã cache, build nhanh hơn nhiều.
- **`USER node`** — image `node` có sẵn user uid 1000, không chạy bằng root.

Không còn cài Chromium hay thư viện đồ hoạ: phần tracking đã bỏ Playwright
([mục 11.1](#111-tra-cứu-hãng-tàu-không-còn-phụ-thuộc-trình-duyệt)).

### 3.3. `Dockerfile.ocr`

Base `python:3.12-slim-bookworm` + `tesseract-ocr` + `tesseract-ocr-vie`.

Gói `vie` là bắt buộc với chứng từ tiếng Việt: `ocr_server.py` tự dùng `eng+vie`
nếu phát hiện có gói này, không có thì lùi về `eng` và mất dấu.

`PYTHON_OCR_HOST` được đặt `0.0.0.0` ngay trong image. Mặc định trong code là
`127.0.0.1`, để nguyên thì container `api` không gọi sang được.

Healthcheck kiểm tra ở mức TCP thay vì HTTP, vì `ocr_server.py` chỉ định nghĩa
`do_POST` nên mọi GET đều trả `501` — dùng HTTP client sẽ phải bắt lỗi rồi coi đó
là "sống", vòng vo và dễ sai. Đổi lại, cách này không phát hiện được trường hợp
tiến trình treo mà cổng vẫn mở.

### 3.4. `docker-compose.yml`

Hai service, chỉ `api` mở cổng ra ngoài. Service `ocr` dùng `expose` thay vì
`ports` vì **nó không có bất kỳ cơ chế xác thực nào** — để lộ ra internet là mở
cửa cho người lạ dùng hạn mức OpenRouter của bạn.

- **`init: true`** — chạy tini làm PID 1 để chuyển tiếp `SIGTERM` cho Node (app
  có xử lý graceful shutdown) và dọn tiến trình zombie. Bỏ dòng này thì phần xử
  lý `SIGTERM` trong `src/app.js` trở nên vô nghĩa.
- **`mem_limit: 2g`** cho `ocr` — xem [mục 10.5](#105-container-ocr-bị-kill-đột-ngột-exit-code-137) nếu gặp exit code 137.
- **`PYTHON_OCR_URL: http://ocr:8001`** — gọi qua DNS nội bộ của Compose.
- **`logging`** giới hạn 10 MB × 3 file mỗi service, tránh log ăn hết ổ đĩa.

Cổng mở ra host đổi được bằng `API_PORT` trong `.env` mà không phải sửa compose.

---

## 4. Biến môi trường

### 4.1. Bảng biến

**Service `api`:**

| Biến | Bắt buộc | Mặc định | Ghi chú |
|------|:--------:|----------|---------|
| `PORT` | Không | `5000` | Port Express lắng nghe bên trong container |
| `API_PORT` | Không | `5000` | Cổng mở ra host (chỉ Compose dùng) |
| `NODE_ENV` | Không | — | Đặt `production` để ẩn chi tiết lỗi khỏi response |
| `JSON_BODY_LIMIT` | Không | `25mb` | Giới hạn body JSON |
| `DB_HOST` | **Có** | — | Host PostgreSQL |
| `DB_PORT` | **Có** | — | Thường là `5432` |
| `DB_NAME` | **Có** | — | Tên database |
| `DB_USER` | **Có** | — | User PostgreSQL |
| `DB_PASSWORD` | **Có** | — | Mật khẩu |
| `DB_SSL` | Không | `false` | Đặt `true` với DB managed (Render/Supabase/RDS) |
| `JWT_SECRET` | **Có** | — | Chuỗi ngẫu nhiên, **không dùng giá trị mẫu** |
| `JWT_EXPIRES_IN` | Không | `7d` | Hạn token |
| `APPSCRIPT_URL` | **Có** | — | URL Google Apps Script |
| `APPS_SCRIPT_TIMEOUT` | Không | `120000` | ms |
| `PYTHON_OCR_URL` | **Có** | `http://127.0.0.1:8001` | Phải đổi thành `http://ocr:8001` |
| `CARRIER_FETCH_TIMEOUT` | Không | `30000` | Timeout (ms) khi gọi endpoint hãng tàu |

**Service `ocr`:**

| Biến | Bắt buộc | Mặc định | Ghi chú |
|------|:--------:|----------|---------|
| `PYTHON_OCR_HOST` | **Có** | `127.0.0.1` | **Phải đặt `0.0.0.0`** |
| `PYTHON_OCR_PORT` | Không | `8001` | |
| `open_router_key` | **Có** | — | API key OpenRouter (chữ thường, đúng như trong code) |
| `OPENROUTER_MODEL_OCR` | Không | `openai/gpt-4o-mini` | Model dùng để bóc tách chứng từ |
| `appscript_key` | Không | — | Hiện được đọc nhưng chưa sử dụng |
| `tesseract_cmd` | Không | — | Không cần đặt; trong image đã có sẵn trong `PATH` |

> **Lưu ý về cách đặt tên:** phía Python dùng tên biến **chữ thường**
> (`open_router_key`, `appscript_key`), khác với phía Node dùng chữ hoa. Đây
> không phải lỗi đánh máy — hãy giữ đúng như bảng trên.

### 4.2. Tạo `JWT_SECRET`

`.env.example` để trống giá trị này. **Không dùng lại giá trị mẫu cũ `123456789`**
— đoán được trong vài giây, ai cũng có thể tự ký token với `role` tuỳ ý. Sinh chuỗi mới:

```bash
openssl rand -base64 48
```

### 4.3. File `.env` cho stack

Tạo file `.env` đặt cạnh `docker-compose.yml`. File này **không** được commit lên Git
(đã có trong `.gitignore`). Dùng `.env.example` trong repo làm khuôn:

```bash
cp .env.example .env
```

Rồi điền giá trị thật:

```dotenv
# ---------- Node API ----------
NODE_ENV=production
PORT=5000
JSON_BODY_LIMIT=25mb

# ---------- Google Apps Script ----------
APPSCRIPT_URL=https://script.google.com/macros/s/<deployment-id>/exec
APPS_SCRIPT_TIMEOUT=120000

# ---------- OCR (Python) ----------
open_router_key=sk-or-v1-<openrouter-api-key>
OPENROUTER_MODEL_OCR=openai/gpt-4o-mini
appscript_key=https://script.google.com/macros/s/<deployment-id>/exec
PYTHON_OCR_URL=http://ocr:8001
PYTHON_OCR_HOST=0.0.0.0
PYTHON_OCR_PORT=8001

# ---------- Tra cứu hãng tàu ----------
CARRIER_FETCH_TIMEOUT=30000

# ---------- JWT ----------
JWT_SECRET=<chuỗi-sinh-từ-openssl>
JWT_EXPIRES_IN=1d

# ---------- PostgreSQL ----------
DB_HOST=<db-host>
DB_PORT=5432
DB_NAME=<db-name>
DB_USER=<db-user>
DB_PASSWORD=<db-password>
DB_SSL=false
```

> Một file `.env` duy nhất phục vụ cả hai mục đích: Docker Compose dùng nó để
> thay thế các biến `${...}`, còn khi chạy trực tiếp bằng `npm start` thì
> `dotenv` đọc cùng file này. Vì vậy tên biến phải giữ nguyên cách viết hoa/thường
> như trên.

---

## 5. Deploy bằng Portainer

Có hai cách. Cách A phù hợp khi muốn kiểm soát từng bước và xem log build trực
tiếp; cách B tiện hơn khi cần deploy lặp lại nhiều lần.

### Cách A — Build trên server, quản lý qua Portainer

**Bước 1.** SSH vào server, clone repo:

```bash
cd /opt
git clone https://github.com/Van-Tin-Food/BE_XNK.git be-xnk
cd be-xnk
```

**Bước 2.** Tạo file `.env` theo [mục 4.3](#43-file-env-cho-stack). Các file Docker đã có sẵn trong repo.

**Bước 3.** Build và chạy. Dùng CLI ở lần đầu để thấy log lỗi rõ ràng:

```bash
docker compose build
docker compose up -d
docker compose ps
```

**Bước 4.** Vào Portainer → **Stacks**. Stack `be-xnk` sẽ tự xuất hiện trong mục
*External stacks*. Từ đây có thể xem log, restart, theo dõi tài nguyên của từng
container.

### Cách B — Portainer Stack từ Git

**Bước 1.** Commit 4 file Docker lên repo.

**Bước 2.** Portainer → **Stacks** → **Add stack** → chọn **Repository**:

| Trường | Giá trị |
|--------|---------|
| Name | `be-xnk` |
| Repository URL | `https://github.com/Van-Tin-Food/BE_XNK.git` |
| Repository reference | `refs/heads/master` |
| Compose path | `docker-compose.yml` |
| Authentication | Bật, dùng GitHub Personal Access Token nếu repo là private |

**Bước 3.** Kéo xuống phần **Environment variables**, thêm từng biến trong
[mục 4.3](#43-file-env-cho-stack). Với các giá trị nhạy cảm (mật khẩu DB,
`JWT_SECRET`, `OPEN_ROUTER_KEY`), bấm biểu tượng con mắt để ẩn giá trị.

**Bước 4.** Bấm **Deploy the stack**. Lần đầu sẽ mất vài phút vì phải build image
và tải Tesseract.

> **Gợi ý:** bật **GitOps updates** trong Portainer để stack tự pull và redeploy
> khi có commit mới trên `master`.

---

## 6. Kết nối PostgreSQL

### 6.1. PostgreSQL trên máy khác hoặc dịch vụ managed

Điền thẳng host vào `DB_HOST`. Nếu là dịch vụ managed (Render, Supabase, RDS,
Neon...), phần lớn **bắt buộc dùng SSL**. Code hiện tại chưa cấu hình SSL cho
`pg` — xem [mục 10.4](#104-lỗi-ssl-khi-kết-nối-postgresql-managed).

> **Riêng với Render:** mỗi database có hai hostname khác nhau.
>
> | Loại | Dạng | Dùng được ở đâu |
> |------|------|-----------------|
> | Internal | `dpg-xxxxxxxx-a` | Chỉ bên trong mạng Render |
> | External | `dpg-xxxxxxxx-a.<region>-postgres.render.com` | Mọi nơi, **bắt buộc SSL** |
>
> Nếu deploy Docker trên VPS riêng mà vẫn dùng hostname internal, container sẽ
> báo `getaddrinfo ENOTFOUND` vì tên đó không phân giải được ngoài Render. Phải
> lấy **External Database URL** trong dashboard Render và đặt `DB_SSL=true`.

### 6.2. PostgreSQL chạy ngay trên server (ngoài Docker)

Container không hiểu `localhost` của host. Thêm vào service `api` trong
`docker-compose.yml`:

```yaml
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

rồi đặt `DB_HOST=host.docker.internal`.

Ngoài ra, PostgreSQL phải lắng nghe trên interface của Docker:

- `postgresql.conf`: `listen_addresses = '*'`
- `pg_hba.conf`: cho phép dải `172.16.0.0/12`

### 6.3. PostgreSQL chạy trong cùng stack

Thêm service sau vào `docker-compose.yml` và đặt `DB_HOST=db`:

```yaml
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${DB_NAME}
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER} -d ${DB_NAME}"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
```

Và sửa `depends_on` của `api` thành:

```yaml
    depends_on:
      db:
        condition: service_healthy
      ocr:
        condition: service_started
```

> Nếu chọn cách này, **bắt buộc** phải có phương án backup volume `pgdata`.

---

## 7. Kiểm tra sau khi deploy

**Container đang chạy:**

```bash
docker compose ps
```

Cả `api` và `ocr` phải ở trạng thái `running`.

**Health check** — đây là lệnh đáng chạy đầu tiên, nó kiểm tra luôn cả database và OCR:

```bash
curl -s http://localhost:5000/health
# {"status":"ok","checks":{"database":"ok","ocr":"ok"},"uptime":12}
```

`"database":"fail: ..."` → xem [mục 10.3](#103-container-api-không-kết-nối-được-database).
`"ocr":"fail: ..."` → xem [mục 10.2](#102-api-báo-lỗi-gọi-ocr--econnrefused).

**API phản hồi.** Kết quả 404 dạng JSON là đúng — nó chứng tỏ Express đã nhận được request:

```bash
curl -i http://localhost:5000/api/khong-ton-tai
# HTTP/1.1 404 Not Found
# {"success":false,"message":"Route not found"}
```

**Tra cứu hãng tàu** (không cần database, kiểm tra nhanh được):

```bash
curl -s http://localhost:5000/api/tracking/carriers

curl -s -X POST http://localhost:5000/api/tracking/carriers/link \
  -H "Content-Type: application/json" \
  -d '{"carrier":"MAERSK","trackingNumber":"123456789"}'
```

**Đăng nhập thử** để kiểm tra kết nối database:

```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"<user>","password":"<pass>"}'
```

Nếu trả về lỗi kết nối PostgreSQL, xem [mục 10.3](#103-container-api-không-kết-nối-được-database).

**Service OCR sống và chỉ nghe nội bộ:**

```bash
# Từ trong container api - phải thấy phản hồi
docker compose exec api node -e "fetch('http://ocr:8001/ocr/analyze',{method:'POST',body:'{}'}).then(r=>console.log(r.status))"

# Từ ngoài internet - phải KHÔNG kết nối được
curl http://<ip-server>:8001/
```

**Xem log:**

```bash
docker compose logs -f api
docker compose logs -f ocr
```

Trong Portainer: **Containers** → chọn container → **Logs**.

---

## 8. Cập nhật phiên bản mới

**Cách A (build trên server):**

```bash
cd /opt/be-xnk
git pull
docker compose build
docker compose up -d
docker image prune -f
```

**Cách B (stack từ Git):** Portainer → **Stacks** → `be-xnk` → **Pull and redeploy**.

Quá trình này có downtime vài giây. Service `api` xử lý `SIGTERM` nên request
đang chạy dở được hoàn tất trước khi thoát ([mục 11.3](#113-graceful-shutdown)).

Service `ocr` thì **không** — một request OCR có thể kéo dài tới 180 giây và sẽ
bị cắt ngang. Nên chọn thời điểm không có ai đang chạy OCR.

---

## 9. Reverse proxy & HTTPS

Không nên để `api` lộ trực tiếp port 5000 ra internet. Đặt Nginx Proxy Manager
hoặc Caddy phía trước để có HTTPS.

Nếu dùng reverse proxy, sửa service `api`: bỏ `ports` và thay bằng `expose`, rồi
cho hai container chung một network với proxy.

Cấu hình Nginx tối thiểu:

```nginx
server {
    listen 443 ssl;
    server_name api.tenmien.com;

    # Upload chứng từ OCR tối đa 15MB, body JSON tối đa 25MB
    client_max_body_size 30m;

    location / {
        proxy_pass http://api:5000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # OCR có thể chạy tới 180s
        proxy_read_timeout 200s;
        proxy_send_timeout 200s;
    }
}
```

Hai giá trị `client_max_body_size` và `proxy_read_timeout` rất hay bị bỏ sót —
thiếu chúng thì OCR file lớn sẽ lỗi `413` hoặc `504`.

---

## 10. Xử lý sự cố

### 10.1. Build lỗi ở bước cài `bcrypt`

`bcrypt` là native module. Trên `node:22-bookworm-slim` thường có sẵn bản biên
dịch trước cho linux/amd64. Nếu server dùng kiến trúc ARM hoặc không tải được
bản dựng sẵn, thêm công cụ build vào `Dockerfile.api` trước lệnh `npm ci`:

```dockerfile
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*
```

### 10.2. `api` báo lỗi gọi OCR / `ECONNREFUSED`

Ba nguyên nhân thường gặp, kiểm tra theo thứ tự:

1. `PYTHON_OCR_URL` chưa trỏ tới `http://ocr:8001`. Mặc định trong code là
   `127.0.0.1`, trong container sẽ trỏ ngược về chính container `api`.
2. `PYTHON_OCR_HOST` của service `ocr` chưa đặt `0.0.0.0`.
3. Container `ocr` đã chết — kiểm tra `docker compose logs ocr`.

### 10.3. Container `api` không kết nối được database

```bash
docker compose exec api node -e "require('/app/src/config/database').query('select 1').then(r=>console.log('OK',r.rows)).catch(e=>console.error('FAIL',e.message))"
```

- `ENOTFOUND` → hostname không phân giải được. Hay gặp nhất là dùng hostname
  internal của Render (`dpg-xxxx-a`) ở ngoài Render — xem [mục 6.1](#61-postgresql-trên-máy-khác-hoặc-dịch-vụ-managed)
- `ECONNREFUSED` → sai `DB_HOST`/`DB_PORT`, hoặc PostgreSQL không nghe trên interface Docker
- `password authentication failed` → sai thông tin đăng nhập
- `no pg_hba.conf entry` → chưa cho phép dải IP của Docker trong `pg_hba.conf`

### 10.4. Lỗi SSL khi kết nối PostgreSQL managed

Triệu chứng: `connection requires SSL`, hoặc `read ECONNRESET` ngay khi vừa kết nối.

`src/config/database.js` đã hỗ trợ sẵn qua biến `DB_SSL`. Chỉ cần đặt:

```dotenv
DB_SSL=true
```

Khi bật, kết nối dùng `rejectUnauthorized: false` vì Render và phần lớn dịch vụ
managed cấp chứng chỉ self-signed, không xác thực được theo chuỗi CA gốc.

Kiểm tra nhanh kết nối:

```bash
node -e "require('dotenv').config();require('./src/config/database').query('select current_user,current_database()').then(r=>console.log(r.rows[0])).catch(e=>console.error(e.message))"
```

### 10.5. Container `ocr` bị kill đột ngột (exit code 137)

Đây là OOM — hết RAM. OCR xử lý ảnh tới 8 triệu pixel và render PDF ở 200 DPI,
nhiều request song song sẽ cộng dồn bộ nhớ. Cách xử lý:

- Nâng `mem_limit` của service `ocr`, nếu server còn RAM trống
- Giảm `PDF_OCR_DPI` và `MAX_OCR_PIXELS` trong `python/ocr_server.py`
- Giới hạn số request OCR đồng thời từ phía frontend

### 10.6. OCR trả kết quả sai dấu hoặc không nhận tiếng Việt

Kiểm tra gói ngôn ngữ đã được cài trong image:

```bash
docker compose exec ocr tesseract --list-langs
```

Danh sách phải có `vie`. Nếu không, bước `apt-get install tesseract-ocr-vie`
trong `Dockerfile.ocr` đã thất bại — build lại với `--no-cache`.

### 10.7. Frontend bị chặn CORS

Code đang dùng `app.use(cors())`, tức mở cho mọi origin. Vì vậy lỗi CORS gần như
luôn đến từ reverse proxy chứ không phải từ Express. Kiểm tra proxy có nuốt mất
request `OPTIONS` hoặc tự thêm header `Access-Control-Allow-Origin` trùng lặp không.

---

## 11. Hạn chế đã biết

Những điểm sau **không** cản trở việc deploy, nhưng cần biết trước để không mất
thời gian debug nhầm chỗ.

### 11.1. Tra cứu hãng tàu: không còn phụ thuộc trình duyệt

Trước đây `POST /api/tracking/ckline` mở Chromium qua Playwright với
`headless: false`. Cách đó không chạy được trong container (không có display
server) và rò rỉ một tiến trình Chromium mỗi lượt gọi thành công.

Nay toàn bộ phần tracking chuyển sang gọi HTTP trực tiếp từ server, theo đúng cơ
chế của `update_funtions/Service_TrackingTest.js`. Playwright đã được gỡ khỏi
`package.json`, trong `src/` không còn tham chiếu nào tới `chromium`.

Registry hãng tàu nằm ở `src/config/trackingCarriers.js`, gồm 9 hãng: MSC, COSCO,
Yang Ming, Hapag-Lloyd, Maersk, PIL, ONE, CMA và CK Line. Thêm hãng mới chỉ cần
thêm một entry với `label` + `buildRequest(trackingNumber)`.

| Route | Công dụng |
|-------|-----------|
| `GET /api/tracking/carriers` | Danh sách hãng được hỗ trợ |
| `POST /api/tracking/carriers/link` | Trả link tra cứu để frontend mở trong trình duyệt người dùng |
| `POST /api/tracking/carriers/lookup` | Gọi endpoint của hãng từ server, trả nguyên phản hồi |
| `POST /api/tracking/ckline` | Giữ nguyên để tương thích ngược, nay trả link thay vì mở browser |
| `POST /api/tracking/evergreen/launch` | Không đổi |

**Hai đặc điểm cần biết khi dùng `/carriers/lookup`:**

Nhiều hãng (MSC, Hapag-Lloyd, Maersk, CMA) có bot protection chặn request tự
động, và kết quả chặn phụ thuộc IP gọi đi — cùng một đoạn code có thể chạy được
từ máy này nhưng bị 403 từ máy khác. Ngoài ra Yang Ming, PIL, ONE là SPA nên HTML
trả về chỉ là khung trang, dữ liệu thật do JS tải sau.

Vì vậy `lookup` trả về nguyên trạng những gì nhận được (`status`, `isJson`,
`json`, `raw`) thay vì cố vượt rào hay bịa dữ liệu. Response luôn kèm trường
`url` để frontend mở trang tra cứu trong trình duyệt người dùng khi server bị
chặn — đó là đường đi dùng được với mọi hãng.

**Riêng CK Line** dùng framework WebSquare: ô nhập và endpoint tra cứu
(`sup.WESSUP411.WESSUP411R01`) đều do JS dựng sau khi trang load, không có trong
HTML gốc, nên không dựng được request hợp lệ từ server. Hãng này chỉ trả deep
link kèm `autoFill: false` — người dùng mở trang rồi tự nhập B/L.

### 11.2. Health endpoint

`GET /health` kiểm tra kết nối database và service OCR:

```json
{
  "status": "ok",
  "checks": { "database": "ok", "ocr": "ok" },
  "uptime": 7
}
```

Quy ước status code: **chỉ database quyết định** kết quả. DB hỏng → `503`, Docker
sẽ đánh dấu container unhealthy. OCR chết chỉ hiện trong `checks.ocr` nhưng vẫn
trả `200`, vì phần lớn API không phụ thuộc OCR — để OCR làm cả API bị restart thì
thiệt hơn lợi.

Kiểm tra OCR coi mọi phản hồi HTTP là còn sống, kể cả `501`, vì `ocr_server.py`
chỉ định nghĩa `do_POST` nên trả `501` với mọi request GET.

### 11.3. Graceful shutdown

`src/app.js` bắt `SIGTERM`/`SIGINT`, đóng server rồi đóng connection pool trước
khi thoát, kèm chốt chặn 15 giây phòng trường hợp còn kết nối treo. Nhờ đó
`docker compose restart` không cắt ngang request đang xử lý.

Cần giữ `init: true` trong compose: nếu PID 1 là shell thì tín hiệu không tới
được tiến trình Node và mọi xử lý trên đều vô nghĩa.

### 11.4. Service OCR dùng HTTP server của thư viện chuẩn

`python/ocr_server.py` chạy bằng `ThreadingHTTPServer` — không giới hạn số luồng,
không có cơ chế chặn quá tải. Mỗi request tạo một thread mới, nên nhiều file lớn
gửi cùng lúc sẽ dẫn tới OOM ([mục 10.5](#105-container-ocr-bị-kill-đột-ngột-exit-code-137)).

Chấp nhận được với lượng người dùng nội bộ nhỏ. Nếu tải tăng, cần chuyển sang
WSGI/ASGI framework (FastAPI + Uvicorn) và giới hạn số worker.

### 11.5. Không dùng `Dockerfile` gốc

`Dockerfile` ở thư mục gốc chạy `CMD python3 python/ocr_server.py & node src/app.js`.
Cách này có ba vấn đề: PID 1 là shell nên không chuyển tiếp `SIGTERM`; nếu tiến
trình Python chết thì container vẫn được coi là khoẻ mạnh vì Node còn sống, khiến
OCR hỏng âm thầm; và không có cơ chế dọn tiến trình zombie.

Bố cục hai service trong tài liệu này thay thế cho nó. Có thể xoá `Dockerfile` cũ
sau khi stack mới chạy ổn định.

### 11.6. File `.env` từng bị commit lên Git

Lịch sử repo có 6 commit chứa file `.env`. Nội dung bị lộ chỉ gồm `APPSCRIPT_URL`
và `PORT` — không có mật khẩu database hay API key. Dù vậy, nếu URL Apps Script
đó là endpoint không yêu cầu xác thực, nên deploy lại một bản Apps Script mới để
lấy URL khác.
