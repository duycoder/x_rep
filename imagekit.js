// Dùng chung cho content.js (bảng gợi ý trên X) và studio.html: vẽ ảnh chữ (quote card) bằng canvas.
(() => {
  // Ảnh chữ (quote card) 1080x1080 vẽ bằng canvas.
  const QUOTE_PALETTES = [
    ["#0f2027", "#2c5364", "#ffffff"],
    ["#f6d365", "#fda085", "#2a1a10"],
    ["#fdfcfb", "#e2d1c3", "#2b2b2b"],
    ["#141e30", "#243b55", "#f5f5f5"],
    ["#e0eafc", "#cfdef3", "#1d2b3a"],
    ["#232526", "#414345", "#f7d774"],
    ["#ffecd2", "#fcb69f", "#3a2a1a"],
    ["#11998e", "#38ef7d", "#0b2b1f"]
  ];
  function quoteCard(text, pi) {
    const [c1, c2, fg] = QUOTE_PALETTES[pi % QUOTE_PALETTES.length];
    const S = 1080;
    const cv = document.createElement("canvas");
    cv.width = cv.height = S;
    const g = cv.getContext("2d");
    const grad = g.createLinearGradient(0, 0, S, S);
    grad.addColorStop(0, c1);
    grad.addColorStop(1, c2);
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
    // Dấu ngoặc kép lớn mờ ở góc.
    g.fillStyle = fg;
    g.globalAlpha = 0.14;
    g.font = '700 420px Georgia, "Times New Roman", serif';
    g.textBaseline = "top";
    g.fillText("“", 60, -20);
    g.globalAlpha = 1;

    const pad = 120;
    const maxW = S - pad * 2;
    const font = (px) => `600 ${px}px "Segoe UI", Roboto, Arial, sans-serif`;
    const wrap = (px) => {
      g.font = font(px);
      const out = [];
      String(text || "").trim().split(/\r?\n/).forEach((para) => {
        let line = "";
        para.split(/\s+/).filter(Boolean).forEach((w) => {
          const t = line ? `${line} ${w}` : w;
          if (g.measureText(t).width > maxW && line) {
            out.push(line);
            line = w;
          } else line = t;
        });
        out.push(line);
      });
      return out;
    };
    // Chữ to nhất mà vẫn vừa khung.
    let px = 84;
    let lines = wrap(px);
    while (px > 30 && lines.length * px * 1.35 > S - pad * 2 - 80) lines = wrap((px -= 4));
    const lh = px * 1.35;
    let y = (S - lines.length * lh) / 2;
    g.font = font(px);
    g.fillStyle = fg;
    g.textBaseline = "top";
    lines.forEach((l) => {
      g.fillText(l, pad, y);
      y += lh;
    });
    // Vạch nhỏ dưới chữ.
    g.globalAlpha = 0.5;
    g.fillRect(pad, y + 30, 90, 6);
    g.globalAlpha = 1;
    return cv.toDataURL("image/png");
  }

  self.XCSImage = { quoteCard, QUOTE_PALETTES };
})();
