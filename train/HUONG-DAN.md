# Huấn luyện model riêng (xcs-me) trên Google Colab

Một model làm cả 3 việc:

| Việc | Học từ |
|---|---|
| Trả lời bài người khác trên X | Câu bạn đã đăng qua extension |
| Đáp bình luận dưới bài của bạn | Câu bạn đáp trên bài của mình |
| Viết bài theo phong cách page Facebook | Bài page đã duyệt vào train |

Máy bạn (GTX 1050 Ti 4 GB) không đủ để huấn luyện, nên ta huấn luyện miễn phí trên Google Colab (GPU T4), rồi chạy model trên máy bằng Ollama.
Tổng thời gian khoảng 40–60 phút.

## Bước 1: Xuất dữ liệu (trong extension)

1. Tải lại extension ở `brave://extensions`.
2. Mở **Cài đặt**, vào tab **💾 Dữ liệu & train**.
3. Xem các số đếm ở phần **Dữ liệu huấn luyện**:
   - Trả lời trên X: nên có từ 200 câu.
   - Bài page Facebook đã duyệt vào train: nên có từ 300 bài. Ít thì bấm **📋 Xem / duyệt bài Facebook**, chạy 🔍 Kiểm tra trùng, rồi duyệt thêm.
4. Ở **Xuất những gì** chọn:
   - **Tất cả**: một model làm hết (nên dùng). Ra file `xcs-train.jsonl`.
   - **Chỉ bài page Facebook**: model riêng chỉ để viết bài. Ra file `xcs-train-fb.jsonl`.
5. Bấm **⬇ Xuất dữ liệu huấn luyện**.

Chỉ bài đã bấm **"Đưa vào dữ liệu train"** trong trang 📋 mới được xuất. Bài chờ duyệt, trùng hay bỏ qua thì không.

## Bước 2: Mở notebook trên Colab

1. Vào https://colab.research.google.com và đăng nhập Google.
2. Chọn **File → Upload notebook**, rồi chọn file `train/xcs_train_colab.ipynb` (trong thư mục extension).
3. Chọn **Runtime → Change runtime type**, chọn **T4 GPU**, rồi bấm **Save**.

## Bước 3: Chạy

1. Chọn **Runtime → Run all**. Nếu Colab cảnh báo notebook không phải của Google, bấm **Run anyway**.
2. Các ô chạy lần lượt:

| Ô | Việc | Thời gian |
|---|---|---|
| 1 | Cài thư viện | 2–4 phút |
| 2 | Bấm **Choose Files**, chọn file `.jsonl` vừa xuất. Nó in ra kiểu "600 dòng, dùng 590 dòng" | |
| 3 | Tải model gốc. Để `gemma-3-4b-it` và `EPOCHS = 3` | |
| 4 | Huấn luyện. Số `loss` phải giảm dần | 10–20 phút |
| 5 | **Thử nhanh**, xem phần dưới | |
| 6 | Xuất file và tự tải về `xcs-me.gguf` (~2.5 GB). Để tab mở tới khi tải xong | 10–15 phút |

Ở ô 5 (Thử nhanh):
- Mấy câu ngắn là trả lời trên X: phải nghe giống bạn.
- 3 đoạn cuối là bài đăng viết từ ý "Người trưởng thành là người biết im lặng đúng lúc": phải đọc giống page.

Nếu kết quả ở ô 5 chưa ổn, sửa `EPOCHS` ở ô 3 rồi chạy lại **Runtime → Run all** (ô 2 sẽ hỏi lại file):

| Hiện tượng | Sửa |
|---|---|
| Chép gần nguyên câu hoặc bài cũ | `EPOCHS = 2` |
| Còn chung chung, chưa ra giọng | `EPOCHS = 4` |

Colab miễn phí có thể ngắt nếu tab để không quá lâu: giữ tab mở và thỉnh thoảng xem.

### Colab không cho GPU (kẹt "Connecting", báo hết lượt): dùng Kaggle

Kaggle miễn phí khoảng 30 giờ GPU mỗi tuần. Dùng notebook `train/xcs_train_kaggle.ipynb`:

1. Vào https://www.kaggle.com, đăng nhập, bấm **Create → New Notebook**, rồi **File → Import Notebook** và chọn `xcs_train_kaggle.ipynb`.
2. Bên phải chọn **Settings → Accelerator → GPU T4 x2** và **Internet → On**. Lần đầu Kaggle bắt xác minh số điện thoại.
3. Bên phải chọn **Input → Upload → New Dataset**, thêm file `xcs-train.jsonl`, rồi bấm **Create**.
4. Bấm **Run All**, hoặc **Save Version → Save & Run All** để chạy ngầm (tắt trình duyệt cũng được).
5. Chạy xong, tải `xcs-me.gguf` ở mục **Output** bên phải (⋮ → Download), rồi làm tiếp Bước 4.

Còn một cách khác là thuê GPU theo giờ (RunPod, Vast.ai): khoảng 0.2–0.5 USD/giờ, một lần huấn luyện chưa tới 1 USD.

## Bước 4: Đưa vào Ollama (trên máy)

1. Chép `xcs-me.gguf` vào thư mục `train/` (cạnh `Modelfile`), ghi đè bản cũ.
2. Mở PowerShell tại thư mục đó và chạy:

   ```
   ollama create xcs-me -f Modelfile
   ```

3. Thử từng kiểu:

   ```
   ollama run xcs-me "Viết 1 bình luận trả lời bài X này theo giọng của tôi.`nTác giả: ai đó`nBài: Sáng nay đi biển nắng đẹp quá"
   ollama run xcs-me "Đáp lại bình luận dưới bài của tôi theo giọng của tôi.`nBài của tôi: Cuối tuần mọi người ăn gì?`nNgười bình luận: ai đó`nBình luận: lẩu nóng hổi cho ấm bụng"
   ollama run xcs-me "Viết bài đăng mạng xã hội theo phong cách page viết hay.`nÝ mở đầu: Tiền bạc không mua được lòng người"
   ```

4. Nếu xuất **Chỉ bài page Facebook** thì đặt tên khác để không ghi đè model trả lời: `ollama create xcs-fb -f Modelfile`.

Tên model **phải bắt đầu bằng `xcs-`**: extension nhận ra và dùng prompt ngắn giống lúc huấn luyện.

## Bước 5: Dùng trong extension

1. Vào **Cài đặt → 🤖 AI**, chọn nhà cung cấp **Ollama** (hoặc **Kết hợp**).
2. Bấm **Kiểm tra kết nối & tải danh sách**, chọn `xcs-me`, rồi bấm **Lưu**.
3. Bấm F5 trang x.com. Gợi ý trả lời dùng model mới ngay.

Chế độ **📘 Phong cách page Facebook** trong ✍️ Gợi ý bài hiện vẫn dùng AI thường kèm bài mẫu, chưa dùng `xcs-me`.

## Huấn luyện lại

Cứ có thêm vài trăm câu trả lời hoặc bài page đã duyệt thì làm lại Bước 1–4 với cùng tên `xcs-me` (`ollama create` ghi đè bản cũ).
Model mới học lại từ toàn bộ dữ liệu, không cần giữ bản cũ.
