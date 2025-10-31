# TempMail - Nhận OTP miễn phí

Ứng dụng web full-stack cho phép đăng ký/đăng nhập, tạo email tạm thời (1secmail) và nhận thư/OTP từ nhiều dịch vụ.

## Tính năng
- Đăng ký / Đăng nhập (JWT)
- Tạo email tạm thời, làm mới để lấy email khác
- Xem danh sách thư, mở nội dung thư
- Giao diện đơn giản, gọn nhẹ

## Yêu cầu
- Node.js 18+

## Cài đặt & chạy
```bash
cd backend
npm install
# cấu hình env (tùy chọn)
# tạo file .env (tham khảo .env.example)
# JWT_SECRET=chuoi_bi_mat
# PORT=4000
npm run start
```

Sau đó mở trình duyệt: http://localhost:4000

## Ghi chú
- Email tạm thời sử dụng API công khai của 1secmail. Một số dịch vụ có thể chặn domain email tạm.
- Ứng dụng lưu người dùng vào SQLite file `backend/app.db`.
