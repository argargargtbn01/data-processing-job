🔄 Luồng đẩy Document lên hệ thống MOS
1. Upload document từ Frontend (mos-fe)
Bước 1: Người dùng chọn file và gửi request từ giao diện mos-fe đến API /documents của mos-be.
Request bao gồm:

File dữ liệu

botId (bot liên kết)

Metadata khác

2. Xử lý trong Backend (mos-be)
Bước 2: DocumentController trong mos-be nhận request.

Bước 3: DocumentService trong mos-be không xử lý trực tiếp, mà chuyển tiếp request đến service data-processing-job.

3. Xử lý trong data-processing-job
Bước 4: DocumentController trong data-processing-job nhận request.

Bước 5: DocumentService lưu thông tin document vào database.

Bước 6: DocumentProcessingService xử lý document thông qua hàm processDocument().

4. Xử lý bất đồng bộ qua RabbitMQ
Bước 7: DocumentQueueService đưa job vào hàng đợi RabbitMQ.

Bước 8: Consumer lắng nghe và xử lý các message từ queue trong onModuleInit().

5. Xử lý job document
Bước 9: Gọi processDocumentJob() cho mỗi message.

Bước 10: EmbeddingService được gọi để tạo embeddings cho các text chunks.

Sử dụng mô hình Hugging Face:
sentence-transformers/all-MiniLM-L6-v2

6. Lưu trữ vào data-hub
Bước 11: Gọi saveChunkToDataHub() để gửi từng chunk văn bản và vector embedding tương ứng đến data-hub.

Bước 12: VectorStoreController → VectorStoreService lưu trữ chunk vào vector DB (dùng PostgreSQL + pgvector).

7. Cập nhật trạng thái document
Bước 13: DocumentProcessingService cập nhật trạng thái xử lý document.

Bước 14: Frontend gọi API mos-be để kiểm tra trạng thái document.

mos-be lại chuyển tiếp request đến data-processing-job để lấy trạng thái cập nhật.

✅ Tóm tắt luồng xử lý
Người dùng upload file từ mos-fe

mos-be nhận và chuyển tiếp đến data-processing-job

data-processing-job:

Lưu DB

Đẩy job vào RabbitMQ

Consumer:

Tải file từ S3

Trích xuất nội dung

Chunk văn bản

Tạo embeddings (Hugging Face)

Gửi dữ liệu đến data-hub

data-hub lưu vào vector DB (pgvector)

Cập nhật trạng thái là "Processed"

mos-fe gọi lại API để lấy trạng thái document