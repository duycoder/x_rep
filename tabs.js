// Tabs cho trang Cài đặt: nhớ tab đang mở, hỗ trợ link #ai, #reply, #post, #fb, #data.
(() => {
  const links = [...document.querySelectorAll("#tabs a")];
  const names = links.map((a) => a.dataset.tab);
  function show(name) {
    if (!names.includes(name)) name = names[0];
    links.forEach((a) => a.classList.toggle("on", a.dataset.tab === name));
    names.forEach((n) => document.getElementById(`tab-${n}`).classList.toggle("on", n === name));
    try {
      localStorage.setItem("xcsTab", name);
    } catch (_) {}
  }
  links.forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      history.replaceState(null, "", `#${a.dataset.tab}`);
      show(a.dataset.tab);
      scrollTo(0, 0);
    })
  );
  let start = location.hash.slice(1);
  if (!start) {
    try {
      start = localStorage.getItem("xcsTab") || "";
    } catch (_) {}
  }
  show(start);
})();
