// Thanh chuyển trang dùng chung (trang Cài đặt và trang Dữ liệu bài viết).
// renderPager(el, total, page, size, go): vẽ « ‹ 1 2 [3] 4 5 › » vào el; go(trang) khi bấm. Trang tính từ 0.
function renderPager(el, total, page, size, go) {
  const pages = Math.max(1, Math.ceil(total / size));
  el.innerHTML = "";
  el.hidden = pages <= 1;
  if (pages <= 1) return 0;
  page = Math.min(Math.max(0, page), pages - 1);
  const btn = (label, to, on, title) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pg" + (on ? " on" : "");
    b.textContent = label;
    if (title) b.title = title;
    b.disabled = to < 0 || to >= pages || (on && to === page);
    b.addEventListener("click", () => go(to));
    el.appendChild(b);
  };
  btn("«", 0, false, "Trang đầu");
  btn("‹", page - 1, false, "Trang trước");
  const from = Math.max(0, Math.min(page - 2, pages - 5));
  for (let i = from; i < Math.min(pages, from + 5); i++) btn(String(i + 1), i, i === page);
  btn("›", page + 1, false, "Trang sau");
  btn("»", pages - 1, false, "Trang cuối");
  const info = document.createElement("span");
  info.className = "pginfo";
  info.textContent = `${page * size + 1}–${Math.min(total, (page + 1) * size)} / ${total}`;
  el.appendChild(info);
  return page;
}
