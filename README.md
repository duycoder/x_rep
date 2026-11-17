# X Gợi Ý Bình Luận (extension cho Chrome / Brave)

Thêm nút **💬 Gợi ý** dưới mỗi bài trên x.com. Bấm vào sẽ hiện 3 đến 5 câu bình luận gợi ý, viết theo bối cảnh bài và theo giọng của bạn.
Bạn sửa nếu muốn, bấm **Điền vào trả lời**: extension mở ô trả lời và điền chữ sẵn.
Bạn tự đọc lại, tự bấm **Trả lời** và tự thả tim.

## Tính năng
- Nhiều nhà cung cấp AI: **Groq**, **Gemini** (miễn phí), **Claude** (trả phí), **Ollama** (chạy trên máy), hoặc chế độ **Kết hợp**.
- Bên chính hết lượt hay lỗi thì tự chuyển sang bên khác. Bên nào hết lượt thì nhớ giờ hồi lượt và bỏ qua tới giờ đó.
- Xem ảnh trong bài (Gemini, Claude, model Groq có 📷).
- Bắt chước cách gõ của bạn từ câu mẫu bạn dán vào và từ các câu bạn đã đăng qua extension.
- Tuỳ chọn viết hoa đầu câu, gắn emoji lặp lại ở cuối câu (vd 😂😂😂).
- Xuất dữ liệu để huấn luyện model Ollama riêng nói giống bạn. Model có tên bắt đầu bằng `xcs-` sẽ được dùng với prompt ngắn.

## Cài đặt (Load unpacked)
1. Tải code về (Code → Download ZIP) và giải nén, hoặc `git clone`.
2. Mở `chrome://extensions` (Brave: `brave://extensions`).
3. Bật **Developer mode** (góc trên bên phải).
4. Bấm **Load unpacked** và chọn thư mục có file `manifest.json`.
5. Bấm biểu tượng extension → **Cài đặt**, chọn nhà cung cấp AI, dán key, bấm **Lưu**:
   - **Groq (miễn phí, rất nhanh):** console.groq.com → API Keys.
   - **Gemini (miễn phí):** aistudio.google.com → Get API key.
   - **Claude (trả phí):** console.anthropic.com → API Keys.
   - **Ollama (trên máy):** cài Ollama, đặt biến môi trường `OLLAMA_ORIGINS=chrome-extension://*`, rồi `ollama pull gemma3:4b`.
   Không có key thì extension vẫn chạy bằng câu mẫu có sẵn.
6. Tải lại tab x.com (mỗi lần cập nhật extension cũng cần F5 trang X).

Key chỉ lưu trong `chrome.storage.local` trên máy bạn.

## Phím tắt trên x.com
- `Alt+J` / `Alt+K`: cuộn tới bài sau / bài trước
- `Alt+G`: mở gợi ý cho bài đang ở đầu màn hình
- `Esc`: đóng bảng gợi ý

## Đóng gói
```
npm install
npm run build   # tạo file zip trong release/
```

## Lưu ý
- Extension cố ý **không** tự thả tim, tự đăng hay tự cuộn liên tục. X khoá tài khoản dùng bot tương tác,
  và tài khoản bị gắn cờ spam sẽ mất quyền nhận tiền. Hãy đọc lại từng câu trước khi đăng.
- Khi X đổi giao diện, nút có thể không hiện. Cần sửa bộ chọn trong `content.js`.
