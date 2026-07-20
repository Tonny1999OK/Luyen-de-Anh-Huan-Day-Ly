# Website luyện đề Vật lí THPT

Bản website tĩnh chạy trực tiếp trên trình duyệt, không cần cài Node.js.

## Tính năng

- Đề mô phỏng 50 phút theo cấu trúc mới:
  - Phần I: 18 câu trắc nghiệm nhiều lựa chọn, 0,25 điểm/câu.
  - Phần II: 4 câu Đúng/Sai, mỗi câu 4 ý; chấm 0,1 / 0,25 / 0,5 / 1 điểm tương ứng 1 / 2 / 3 / 4 ý đúng.
  - Phần III: 6 câu trả lời ngắn, 0,25 điểm/câu.
- Đồng hồ đếm ngược và tự động nộp khi hết giờ.
- Chấm điểm tự động, tách điểm từng phần.
- Xem lại đáp án và lời giải.
- Lưu nhiều lượt làm bài bằng LocalStorage.
- Bảng thống kê điểm trung bình, điểm cao nhất, tỉ lệ đạt, phổ điểm và điểm trung bình từng phần.
- Tìm kiếm theo tên, lọc lớp và xuất bảng điểm CSV.
- Giao diện responsive cho máy tính và điện thoại.

## Cách chạy

### Cách 1: Nhanh nhất

Mở file `index.html` bằng Google Chrome hoặc Microsoft Edge.

### Cách 2: Chạy bằng VS Code

1. Mở thư mục dự án bằng VS Code.
2. Cài extension **Live Server**.
3. Nhấp chuột phải vào `index.html`.
4. Chọn **Open with Live Server**.

## Dữ liệu điểm được lưu ở đâu?

Kết quả được lưu trong LocalStorage của trình duyệt đang sử dụng. Đây là bản demo chạy độc lập, phù hợp để thử giao diện và chức năng.

Để nhiều học sinh làm bài từ nhiều máy và giáo viên xem chung một bảng điểm, cần kết nối thêm cơ sở dữ liệu như Supabase/Firebase và hệ thống đăng nhập.

## Chỉnh câu hỏi

Mở file `data.js`. Các câu hỏi được chia thành:

- `mcq`: câu nhiều lựa chọn.
- `trueFalse`: câu Đúng/Sai.
- `shortAnswer`: câu trả lời ngắn.

Không đổi `id` trùng nhau giữa các câu hỏi.
