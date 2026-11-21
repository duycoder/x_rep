// Các nhóm lựa chọn của "Gợi ý bài đăng" (dùng chung cho bảng trên X và trang Cài đặt).
// key: tên trong postSel gửi cho AI · store: khoá lưu danh sách đã tick (mỗi dòng một mục)
// multi: cho chọn nhiều · more: nằm trong mục "Thêm tuỳ chọn" · none: nghĩa khi không chọn gì
(() => {
  const GROUPS = [
    {
      key: "persona", store: "postPersonas", label: "Con người tôi", multi: true, none: "chọn được nhiều; không chọn = hồ sơ trong Cài đặt",
      presets: ["dân văn phòng 28 tuổi", "mê cà phê", "hài hước, hay cà khịa", "đã có gia đình", "độc thân", "có con nhỏ", "nam, 30+", "hướng nội", "hướng ngoại"]
    },
    {
      key: "style", store: "postStyles", label: "Kiểu bài", none: "không chọn = trộn nhiều kiểu",
      presets: ["Life quote", "Triết lý", "Lời khuyên", "Câu hỏi tương tác", "Kể chuyện ngắn", "Hài hước", "Quan điểm (hot take)", "Danh sách 3 điều"]
    },
    {
      key: "topic", store: "postTopics", label: "Chủ đề", none: "không chọn = AI tự chọn theo ngữ cảnh",
      presets: ["ăn uống", "phim, nhạc", "gia đình", "tình yêu, các mối quan hệ", "đời sống hằng ngày", "tối thư giãn", "nghỉ ngơi, xả hơi",
        "công việc, sự nghiệp", "tiền bạc, tài chính", "công nghệ, AI", "phát triển bản thân", "hoạt động cuối tuần"]
    },
    {
      key: "place", store: "postPlaces", label: "Địa điểm", none: "không chọn = không nhắc nơi nào",
      presets: ["Hà Nội", "ở công ty", "quán cà phê", "quê nhà", "ở nhà", "trước màn hình máy tính", "ban công", "phố, ngõ nhỏ", "quán ăn, quán nhậu"]
    },
    {
      key: "when", store: "postTimes", label: "Thời điểm / hoàn cảnh", none: "không chọn = bây giờ",
      presets: ["sau giờ làm", "chiều muộn", "buổi tối", "9 giờ tối", "10 giờ tối", "nửa đêm", "sáng cuối tuần", "tối thứ Bảy", "chiều Chủ nhật", "ngày mưa", "trước khi đi ngủ"]
    },
    {
      key: "mood", store: "postMoods", label: "Tâm trạng", more: true, none: "không chọn = AI đoán theo giờ giấc",
      presets: ["vui", "bình yên", "hoài niệm", "cô đơn", "lạc quan", "mệt", "thư thái", "bực bội", "có động lực", "trầm ngâm"]
    },
    {
      key: "tone", store: "postTones", label: "Giọng viết", more: true, multi: true, none: "chọn được nhiều; không chọn = chân thật + trò chuyện",
      presets: ["chân thật", "hài hước", "sâu sắc", "cà khịa", "đời thường", "triết lý", "cảm xúc", "trò chuyện", "kể chuyện"]
    },
    {
      key: "goal", store: "postGoals", label: "Mục tiêu", more: true, none: "không chọn = tăng lượt trả lời",
      presets: ["tăng lượt trả lời", "khơi thảo luận", "để được chia sẻ lại", "xây thương hiệu cá nhân", "để người đọc thấy mình trong đó", "gợi tò mò", "để người đọc nêu quan điểm"]
    },
    {
      key: "hook", store: "postHooks", label: "Câu mở đầu", more: true, none: "không chọn = AI chọn theo ngữ cảnh",
      presets: ["câu hỏi", "hot take", "lời thú nhận", "câu bất ngờ", "bỏ lửng gây tò mò", "tình huống ai cũng gặp", "ý kiến gây tranh cãi"]
    },
    {
      key: "strategy", store: "postStrategies", label: "Cách kéo tương tác", more: true, multi: true, none: "chọn được nhiều; không chọn = AI chọn cách tự nhiên",
      presets: ["hỏi mở", "cho chọn A/B", "mời kể trải nghiệm", "phản biện điều ai cũng tin", "mời đồng ý / phản đối", "dùng hài hước", "dựng tình huống quen thuộc"]
    },
    {
      key: "cta", store: "postCtas", label: "Lời kêu gọi (CTA)", more: true, none: "không chọn = một câu hỏi tự nhiên",
      presets: ["không kêu gọi", "hỏi ý kiến", "mời kể chuyện riêng", "chọn A hay B", "tag một người bạn", "đồng ý hay không?"]
    },
    {
      key: "length", store: "postLengths", label: "Độ dài", more: true, none: "không chọn = ngắn hoặc vừa",
      presets: ["một câu", "ngắn (2–3 câu)", "vừa (4–6 câu)", "chuyện dài"]
    },
    {
      key: "lang", store: "postLangs", label: "Ngôn ngữ", more: true, none: "không chọn = tiếng Việt",
      presets: ["tiếng Việt", "tiếng Anh", "song ngữ Việt – Anh"]
    },
    {
      key: "image", store: "postImages", label: "Kiểu ảnh", more: true, none: "không chọn = AI chọn ảnh hợp bài",
      presets: ["không ảnh", "minh hoạ điện ảnh", "anime", "hoạt hình 3D", "ảnh chụp chân thực", "meme", "tranh tối giản"]
    }
  ];
  // Kiểu ảnh → mô tả tiếng Anh gắn vào prompt vẽ ảnh.
  const IMAGE_STYLE_EN = {
    "minh hoạ điện ảnh": "cinematic illustration, dramatic lighting",
    anime: "anime style illustration",
    "hoạt hình 3D": "3D cartoon render, Pixar-like",
    "ảnh chụp chân thực": "realistic photography, natural light",
    meme: "meme style image, expressive, funny",
    "tranh tối giản": "minimalist artwork, flat colors, lots of negative space"
  };
  self.XCSPostOpts = { GROUPS, IMAGE_STYLE_EN };
})();
