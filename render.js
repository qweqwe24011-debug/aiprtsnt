window.SC = window.SC || {};

SC.footerHtml = (idx, total) =>
  `<div class="slide-footer"><span>${SC.escapeHtml(SC.state.presentation?.title || "")}</span><span>${idx + 1} / ${total}</span></div>`;

SC.contentClasses = s =>
  s.layout === "closing" ? "centered finale" : s.layout === "title" ? "centered" : "";

SC.slideInnerHtml = (slide, idx, total) => {
  const e = SC.escapeHtml;
  switch (slide.layout) {
    case "title":
      return `<div class="badge"><span class="dot"></span>SlideCraft Studio</div>
        <h1 data-edit="title">${e(slide.title)}</h1>
        <p class="subtitle" data-edit="subtitle">${e(slide.subtitle || "")}</p>
        ${SC.footerHtml(idx, total)}`;
    case "closing":
      return `<h1 data-edit="title">${e(slide.title || "Спасибо за внимание")}</h1>
        <p class="subtitle" data-edit="subtitle">${e(slide.subtitle || "")}</p>
        ${SC.footerHtml(idx, total)}`;
    case "two_columns":
      return `<div class="kicker">Сравнение</div>
        <h2 data-edit="title">${e(slide.title)}</h2>
        <div class="cols">
          <div class="col"><h3 data-edit="left_title">${e(slide.left_title || "")}</h3>
            <ul>${(slide.left_points||[]).map((p,i)=>`<li data-edit="left_points.${i}">${e(p)}</li>`).join("")}</ul></div>
          <div class="col"><h3 data-edit="right_title">${e(slide.right_title || "")}</h3>
            <ul>${(slide.right_points||[]).map((p,i)=>`<li data-edit="right_points.${i}">${e(p)}</li>`).join("")}</ul></div>
        </div>
        ${SC.footerHtml(idx, total)}`;
    case "metrics":
      return `<div class="kicker">Цифры</div>
        <h2 data-edit="title">${e(slide.title)}</h2>
        <div class="metrics">${(slide.metrics||[]).map((m,i)=>`
          <div class="metric">
            <div class="value" data-edit="metrics.${i}.value">${e(m.value)}</div>
            <div class="label" data-edit="metrics.${i}.label">${e(m.label)}</div>
          </div>`).join("")}</div>
        ${SC.footerHtml(idx, total)}`;
    case "chart": {
      const items = slide.items || [];
      const nums = items.map(it => SC.parseNum(it.value));
      const max = Math.max(...nums, 1);
      return `<div class="kicker">Диаграмма</div>
        <h2 data-edit="title">${e(slide.title)}</h2>
        <div class="chart">${items.map((it,i)=>{
          const pct = Math.max(6, Math.round((nums[i]/max)*100));
          return `<div class="bar-col">
            <div class="bar-value" data-edit="items.${i}.value">${e(it.value)}</div>
            <div class="bar" style="height:${pct}%"></div>
            <div class="bar-label" data-edit="items.${i}.label">${e(it.label)}</div>
          </div>`;}).join("")}</div>
        ${SC.footerHtml(idx, total)}`;
    }
    case "table":
      return `<div class="kicker">Таблица</div>
        <h2 data-edit="title">${e(slide.title)}</h2>
        <div class="table-wrap"><table>
          <thead><tr>${(slide.headers||[]).map((h,i)=>`<th data-edit="headers.${i}">${e(h)}</th>`).join("")}</tr></thead>
          <tbody>${(slide.rows||[]).map((r,ri)=>`<tr>${(Array.isArray(r)?r:[]).map((c,ci)=>`<td data-edit="rows.${ri}.${ci}">${e(c)}</td>`).join("")}</tr>`).join("")}</tbody>
        </table></div>
        ${SC.footerHtml(idx, total)}`;
    case "quote":
      return `<div class="quote-mark">“</div>
        <div class="quote-text" data-edit="text">${e(slide.text)}</div>
        <div class="quote-author">— <span data-edit="author">${e(slide.author || "")}</span></div>
        ${SC.footerHtml(idx, total)}`;
    default:
      return `<div class="kicker">Слайд ${idx + 1}</div>
        <h2 data-edit="title">${e(slide.title || "")}</h2>
        <div class="points">${(slide.points||[]).map((p,i)=>`
          <div class="point"><span class="num">${i+1}</span><span data-edit="points.${i}">${e(p)}</span></div>`).join("")}</div>
        ${SC.footerHtml(idx, total)}`;
  }
};

// Полный markup слайда: свечения + контент. Используется экраном, печатью и снимками.
SC.slideHtml = (slide, idx, total) => `
  <div class="glow glow-a"></div>
  <div class="glow glow-b"></div>
  <div class="slide-content ${SC.contentClasses(slide)} anim">${SC.slideInnerHtml(slide, idx, total)}</div>`;

SC.render = () => {
  const slides = SC.state.presentation?.slides;
  const box = SC.$("slide");
  box.dataset.theme = SC.$("themeSelect").value;
  if (!Array.isArray(slides) || !slides.length) {
    SC.$("counter").textContent = "— / —";
    return;
  }
  const slide = slides[SC.state.currentSlide];
  box.className = "slide";
  box.innerHTML = SC.slideHtml(slide, SC.state.currentSlide, slides.length);
  SC.$("counter").textContent = `${SC.state.currentSlide + 1} / ${slides.length}`;
  SC.$("progressBar").style.width = `${((SC.state.currentSlide + 1) / slides.length) * 100}%`;
  if (SC.state.editMode) SC.applyEditing(true);
};

/* ---------- редактирование ---------- */
SC.applyEditing = on => {
  SC.$("slide").querySelectorAll("[data-edit]").forEach(el => el.contentEditable = on ? "true" : "false");
  SC.$("slide").classList.toggle("editing", on);
};

SC.setPath = (obj, path, value) => {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
  cur[parts[parts.length - 1]] = value;
};

SC.handleEdit = (el, commit) => {
  const path = el?.dataset?.edit;
  if (!path || !SC.state.presentation?.slides?.length) return;
  const value = el.innerText.replace(/\s*\n+\s*/g, " ").trim();
  SC.setPath(SC.state.presentation.slides[SC.state.currentSlide], path, value);
  SC.persist();
  const slide = SC.state.presentation.slides[SC.state.currentSlide];
  if (commit && slide.layout === "chart" && path.endsWith(".value")) SC.render();
};