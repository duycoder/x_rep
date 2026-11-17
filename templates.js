// Mẫu bình luận dự phòng khi chưa có API key hoặc gọi API lỗi.
// Dùng chung cho content script (window) và background (importScripts).
(function (root) {
  const VI = {
    question: [
      "Câu hỏi hay đấy, mình cũng đang thắc mắc giống bạn.",
      "Theo mình thì còn tuỳ hoàn cảnh, bạn đang nghiêng về hướng nào?",
      "Mình từng gặp chuyện tương tự, cuối cùng chọn cách đơn giản nhất mà ổn.",
      "Hóng câu trả lời của mọi người ghê.",
      "Câu này mà hỏi dân trong nghề chắc mỗi người một ý luôn."
    ],
    photo: [
      "Ảnh có không khí ghê, góc này chọn khéo.",
      "Màu ảnh đẹp thật, chụp bằng gì vậy bạn?",
      "Nhìn ảnh là thấy năng lượng tích cực rồi.",
      "Bố cục gọn mà vẫn có điểm nhấn, thích.",
      "Ảnh này để làm hình nền cũng hợp đấy."
    ],
    tech: [
      "Góc nhìn này hợp lý, mình thấy đúng khi làm thực tế.",
      "Cái này mà áp dụng sớm thì đỡ được bao nhiêu thời gian.",
      "Bạn có so sánh với cách làm cũ chưa, chênh nhiều không?",
      "Lưu lại để thử cuối tuần này.",
      "Đồng ý phần đầu, phần sau mình nghĩ còn tuỳ quy mô dự án."
    ],
    money: [
      "Quan trọng nhất vẫn là kỷ luật, đọc mà thấm.",
      "Chia sẻ thực tế ghê, ít ai nói thẳng như vậy.",
      "Mình thì chọn đi chậm mà chắc, nhưng góc nhìn này cũng đáng suy nghĩ.",
      "Bạn tính giữ chiến lược này trong bao lâu?",
      "Lưu lại đọc kỹ, cảm ơn bạn đã chia sẻ."
    ],
    general: [
      "Đọc xong thấy đúng thật sự.",
      "Chia sẻ hay quá, cảm ơn bạn.",
      "Góc nhìn thú vị, trước giờ mình chưa nghĩ theo hướng này.",
      "Đồng ý, nhất là đoạn cuối.",
      "Cái này mình cũng từng trải qua, nhớ ghê.",
      "Ngắn mà đủ ý, thích cách bạn viết."
    ]
  };

  const EN = {
    question: [
      "Good question, I've been wondering the same.",
      "Depends on the situation, which way are you leaning?",
      "Curious to see what others say here.",
      "Had the same dilemma once, ended up picking the simplest option."
    ],
    photo: [
      "Great shot, the light is really nice here.",
      "Love the colors in this one.",
      "This has such a calm vibe.",
      "Nice composition, what did you shoot it on?"
    ],
    tech: [
      "This matches what I've seen in real projects.",
      "Saving this to try over the weekend.",
      "Did you compare it with the old approach? Curious about the difference.",
      "Agree with the first part, the second depends on scale I think."
    ],
    money: [
      "Discipline really is the whole game.",
      "Refreshingly honest take.",
      "How long do you plan to stick with this strategy?",
      "Saving this, thanks for sharing."
    ],
    general: [
      "This is so true.",
      "Great point, thanks for sharing.",
      "Interesting take, never thought about it this way.",
      "Agree, especially the last part.",
      "Short and to the point, love it."
    ]
  };

  const KEYWORDS = {
    tech: /\b(code|coding|dev|ai|gpt|claude|bug|deploy|api|python|javascript|react|server|app|lập trình|công nghệ)\b/i,
    money: /\b(tiền|đầu tư|crypto|bitcoin|btc|eth|cổ phiếu|chứng khoán|lương|thu nhập|invest|money|stock|salary)\b/i
  };

  function looksVietnamese(text) {
    return /[ăâđêôơưàảãáạằẳẵắặầẩẫấậèẻẽéẹềểễếệìỉĩíịòỏõóọồổỗốộờởỡớợùủũúụừửữứựỳỷỹýỵ]/i.test(text || "");
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function templateSuggestions({ text = "", hasMedia = false, count = 4, language = "auto" } = {}) {
    const useVi = language === "vi" || (language === "auto" && (looksVietnamese(text) || !text.trim()));
    const bank = useVi ? VI : EN;
    let pool;
    if (text.includes("?")) pool = bank.question;
    else if (KEYWORDS.tech.test(text)) pool = bank.tech;
    else if (KEYWORDS.money.test(text)) pool = bank.money;
    else if (hasMedia && text.trim().length < 80) pool = bank.photo;
    else pool = bank.general;
    const picked = shuffle(pool);
    // Bổ sung từ nhóm chung nếu thiếu
    for (const s of shuffle(bank.general)) {
      if (picked.length >= count) break;
      if (!picked.includes(s)) picked.push(s);
    }
    return picked.slice(0, count);
  }

  root.XCSTemplates = { templateSuggestions, looksVietnamese };
})(typeof self !== "undefined" ? self : window);
