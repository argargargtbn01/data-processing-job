🧠 Kiến trúc & Luồng Hỏi Đáp RAG trong hệ thống MOS
🧾 1. Người dùng đặt câu hỏi qua giao diện mos-fe
Sử dụng component DocumentQuery để hiển thị giao diện nhập câu hỏi.

Khi người dùng nhập câu hỏi, frontend gửi request đến endpoint:

POST /documents/query
(Trên mos-be)

🛠️ 2. Xử lý tại mos-be (Backend chính)
DocumentQueryController nhận câu hỏi.

Chuyển yêu cầu sang DocumentQueryService.

DocumentQueryService tiếp tục gửi câu hỏi đến data-hub để xử lý truy vấn RAG.

🧠 3. Xử lý tại data-hub (Hệ thống tìm kiếm ngữ nghĩa)
RagController nhận request.

Gọi RagService để xử lý câu hỏi với các bước:

📌 Các bước trong RagService:
Tạo embedding vector từ câu hỏi bằng mô hình embedding.

Truy vấn vector store để tìm các chunks tài liệu tương đồng nhất (semantic search).

Kết hợp các chunks thành đoạn context đầy đủ.

Tạo prompt từ context + câu hỏi.

Gửi prompt đến Language Model (LLM).

Nhận câu trả lời từ LLM và trả về.

🔁 4. Trả kết quả về giao diện
mos-fe nhận kết quả trả về từ API /documents/query.

DocumentQuery hiển thị:

✅ Câu trả lời

📚 Nguồn tài liệu tham chiếu

📈 Mức độ liên quan (similarity score) (nếu có)



✅ Tóm tắt tổng quan luồng RAG
Sao chép
Chỉnh sửa
mos-fe (DocumentQuery)
   ↓
POST /documents/query (mos-be)
   ↓
DocumentQueryService
   ↓
data-hub (RagController → RagService)
   ↓
→ Tạo embedding câu hỏi
→ Semantic search các chunks liên quan
→ Gộp context + tạo prompt
→ Gửi prompt đến LLM
→ Trả về câu trả lời
   ↓
mos-fe hiển thị kết quả + nguồn trích dẫn