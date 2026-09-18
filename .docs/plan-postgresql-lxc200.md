# Cài PostgreSQL Server lên LXC200 + trỏ BE_Dashboard-VTF sang đó thay vì Render

## Context

BE_Dashboard-VTF hiện dùng PostgreSQL managed trên Render (`DB_HOST` dạng
`dpg-xxx.singapore-postgres.render.com`, xem `.env`/`DEPLOY.md` mục 6.1). File
`.sql/backuphost.io.sql` là **bản dump PostgreSQL thật** (`pg_dump` version 17.10, chụp
2026-09-18 10:52) của đúng database đang chạy trên Render — 12 bảng, 1 function `plpgsql`
(`tao_ma_tu_dong`, sinh mã tự động kiểu `container_001`, `chi_tiet_001`... dựa trên 6 SEQUENCE),
đầy đủ PK/FK/UNIQUE, và **dữ liệu vận hành thật** (đơn hàng, 3 tài khoản user thật, lịch sử
`thong_bao`/`user_activity_logs`).

Yêu cầu ban đầu ("triển khai lên máy chủ mariadb") đã làm rõ qua trao đổi: **không** phải chuyển
engine sang MariaDB (sẽ phải viết lại toàn bộ code — 6 file trong `src/services/` dùng cú pháp
Postgres thuần: `RETURNING`, `ON CONFLICT ... EXCLUDED`, `pg_advisory_xact_lock`, placeholder
`$1,$2`, không có tương đương native trong MariaDB). Quyết định thật: **cài PostgreSQL Server lên
cùng LXC200** (con LXC đang chạy MariaDB + MSSQL Express, gọi quen là "máy chủ mariadb") — tức
thêm PostgreSQL làm engine DB thứ 3 trên máy đó, giữ nguyên `pg_dump` để restore thẳng (không cần
convert schema/data), giữ nguyên 100% code Node (`pg` driver, mọi câu query) — "thay database
connector" ở đây nghĩa là **đổi đích kết nối** (`DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/
`DB_SSL` trong `.env` + Environment variables của stack Portainer `be-xnk`, id 98), không đổi code.

Lý do đây là lựa chọn đúng: rủi ro thấp hơn hẳn (0 dòng code đổi, dump restore thẳng không cần
convert tay dễ sai sót với 1 function plpgsql + sequence), và tận dụng hạ tầng nội bộ đã backup
sẵn — LXC200 đã nằm trong danh sách VMID được PBS vzdump backup hằng đêm (xem
`BACKUP-STRATEGY.md` mục 3 trong repo `homelab-IaC`), nên dữ liệu Postgres mới cũng tự động được
cuốn theo, không cần dựng cơ chế backup riêng.

Đã hỏi và chốt 2 điểm với user:
1. **Cắt hẳn sang Postgres tự host (LXC200) ngay**, không chạy song song với Render — sau khi
   test kỹ, đổi thẳng `.env`/Portainer env, không cần đồng bộ 2 chiều.
2. **Import luôn toàn bộ dữ liệu thật** trong `.sql/backuphost.io.sql` (không dựng schema rỗng
   trước) — đây là bản chụp gần nhất, import ngay để không mất dữ liệu vận hành khi cắt DB.

Rào cản kỹ thuật duy nhất đáng kể: **`RETURNING`/`ON CONFLICT`/advisory lock** trong code chỉ
hoạt động đúng nếu server đích thật sự là PostgreSQL — nên KHÔNG được nhầm sang cài
"PostgreSQL-compatible" thứ khác (vd MariaDB không tương thích các cú pháp này dù cùng SQL).
Ngoài ra dump dùng `pg_dump` bản 17.10 — nên cài PostgreSQL Server bản 17.x trên LXC200 để chắc
chắn tương thích cú pháp dump (Debian 12 mặc định chỉ có bản 15 trong repo gốc, cần thêm PGDG apt
repo để lấy bản 17).

## Kiến trúc

```
LXC200 (10.0.1.20, DatabaseNet 10.0.1.0/24) — hiện có: MariaDB (vetecodb), MSSQL Express
 └─ (mới) PostgreSQL Server 17.x, cài qua PGDG apt repo
     ├─ Database mới (đề xuất giữ tên "dashboard_bhlm" để khớp .env cũ, có thể đổi nếu user muốn)
     ├─ Role "dashboard_user" (mật khẩu mới — KHÔNG dùng lại password Render cũ)
     ├─ Restore thẳng .sql/backuphost.io.sql qua `psql` (dump đã có sẵn function, sequence,
     │   constraint, data — không cần convert gì)
     ├─ postgresql.conf: listen_addresses phải cho phép kết nối từ mạng khác (không chỉ localhost)
     └─ pg_hba.conf: thêm rule cho phép 10.0.0.51 (VM300, nơi chạy container be-xnk-api) kết nối

VM300 (10.0.0.51, LAN 10.0.0.0/24)
 └─ container be-xnk-api (stack Portainer "be-xnk", id 98) — đổi Environment variables:
     DB_HOST=10.0.1.20, DB_PORT=5432, DB_USER=dashboard_user, DB_PASSWORD=<mới>,
     DB_NAME=dashboard_bhlm, DB_SSL=false (LAN nội bộ, không cần SSL như Render)
     — KHÔNG đổi code (src/config/database.js vẫn dùng `pg`, mọi query trong src/services/ giữ
     nguyên 100%)
```

**Điểm cần xác minh trước khi làm** (mạng nhà đang mất kết nối lúc lập kế hoạch này — SSH
`root@10.0.0.50` timeout, cần thử lại khi có mạng):
- LXC200 có đang route được giữa `DatabaseNet` (10.0.1.0/24) và LAN chính (10.0.0.0/24) cho VM300
  không (kiểm tra bằng cách xem OPNsense có rule cho phép, hoặc test thử kết nối TCP thật).
- Tài nguyên LXC200 còn đủ RAM/disk để chạy thêm 1 DB engine nữa (đã có MariaDB + MSSQL Express)
  — `pct exec 200 -- free -h && df -h`.
- Chưa có mật khẩu root MariaDB lẫn thông tin đăng nhập hệ điều hành LXC200 ghi trong `.env`
  (`LXC200_MYSQL_ROOT_PASSWORD` để trống) — cần quyền root qua `pct exec 200` từ Proxmox host
  (đã xác nhận dùng được `ssh root@10.0.0.50` + `pct exec 200 -- <cmd>`, giống cách đã thao tác
  với VM300/VM101 trong phiên làm việc trước) nên không cần thêm credential mới cho bước cài đặt.

## Việc cần làm

1. **Xác minh hạ tầng** (mục trên) khi mạng homelab kết nối lại.

2. **Cài PostgreSQL 17 trên LXC200** (`pct exec 200 -- <cmd>`, giống cách đã cài
   `proxmox-backup-server`/các package khác trong repo `homelab-IaC`):
   - Thêm PGDG apt repo (`apt.postgresql.org/pub/repos/apt`), `apt-get install postgresql-17`.
   - Tạo role `dashboard_user` (mật khẩu mới, sinh bằng `openssl rand -base64 24` giống pattern
     `JWT_SECRET`/`BE_XNK_API_BEARER_TOKEN` đã dùng trước đó) + database `dashboard_bhlm` owner =
     role đó.
   - Sửa `listen_addresses = '*'` (hoặc IP cụ thể) trong `postgresql.conf`, thêm dòng
     `host dashboard_bhlm dashboard_user 10.0.0.51/32 scram-sha-256` vào `pg_hba.conf`, restart
     service.

3. **Restore dữ liệu thật:**
   - Copy `.sql/backuphost.io.sql` lên LXC200 (qua `pct push` hoặc scp qua Proxmox host).
   - `psql -U dashboard_user -d dashboard_bhlm -f backuphost.io.sql` — kiểm tra restore sạch,
     không lỗi (dump đã tự chứa `CREATE FUNCTION`, `CREATE SEQUENCE`, `ALTER TABLE ... ADD
     CONSTRAINT`, nên chạy 1 lệnh là đủ, không cần script chuyển đổi nào).
   - Đối chiếu row count từng bảng (12 bảng) giữa Postgres Render cũ và bản mới trên LXC200 để
     chắc chắn restore đủ, không thiếu (nhất là `users`, `chung_tu_drive`, `thong_bao` — dữ liệu
     vận hành thật).

4. **Test kết nối thật từ VM300 trước khi đổi Portainer** — dùng `psql`/`node -e` test riêng từ
   container hoặc từ VM300 tới `10.0.1.20:5432` để xác nhận network + auth đều thông trước khi
   động vào stack đang chạy.

5. **Đổi env + redeploy stack `be-xnk`** (Portainer API, id 98 — đã có `PORTAINER_API_TOKEN`
   trong `homelab-IaC/.env`, đúng cách đã làm khi tạo stack ban đầu):
   - Update Environment variables của stack: `DB_HOST`, `DB_PORT=5432`, `DB_USER`, `DB_PASSWORD`,
     `DB_NAME`, `DB_SSL=false`.
   - Redeploy container `be-xnk-api` (không cần rebuild image — chỉ đổi env + restart).
   - Cập nhật luôn `.env` local trong `D:\VTF_AppScripts\BE_Dashboard-VTF\.env` cho khớp (dùng khi
     chạy `docker compose` local sau này).

6. **Cập nhật tài liệu:**
   - `DEPLOY.md` mục 6.1: thay phần "Render — External Database URL" bằng hướng dẫn PostgreSQL
     tự host trên LXC200 (không cần SSL, dùng IP nội bộ).
   - `homelab-IaC/.env` + `.env.example`: thêm block PostgreSQL LXC200 (giống pattern
     `LXC200_MYSQL_ROOT_PASSWORD` hiện có), ghi chú rõ đây là DB engine thứ 3 trên LXC200 (sau
     MariaDB, MSSQL Express).
   - `inventory/current-state/vms-and-storage.md` mục LXC200: thêm PostgreSQL vào danh sách
     service đang chạy trên container này.

## Verification
- `curl -s https://api-xnk.victor.io.vn/health` (kèm bearer token đã cấu hình trước đó) →
  `"database":"ok"` — xác nhận app thật đã kết nối được DB mới qua toàn bộ đường đi (NPM + tunnel
  + container), không chỉ test nội bộ.
- Test đăng nhập thật (`POST /api/auth/login`) bằng 1 trong 3 tài khoản thật đã restore (tin/duc/
  trang) — xác nhận bcrypt hash + dữ liệu user restore đúng.
- Gọi thử 1 vài endpoint CRUD generic (vd `GET /api/xnk`, `GET /api/container`) — đối chiếu dữ
  liệu trả về khớp với dump gốc.
- Test riêng luồng có advisory lock (`saveUploadedDocument` — upload chứng từ) để chắc chắn
  `pg_advisory_xact_lock` hoạt động bình thường trên instance mới (không có gì đặc biệt vì vẫn là
  Postgres thật, nhưng nên test vì đây là điểm nhạy cảm nhất về race-condition).
- Sau khi ổn định vài ngày: xác nhận LXC200 tiếp tục được PBS vzdump backup nguyên trạng (đã có
  sẵn trong job — không cần thêm gì), không cần dựng cơ chế backup riêng cho Postgres mới.
