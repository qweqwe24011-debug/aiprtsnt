// ============================================================
// src/gallery.js — галерея сохранённых презентаций
// Хранилище: localStorage, ключ ai_pres_gallery.
// Интерфейс строится скриптом — править вёрстку не нужно.
// ============================================================
window.SC = window.SC || {};

SC.GALLERY_KEY = "ai_pres_gallery";
SC.GALLERY_CUR_KEY = "ai_pres_gallery_current";

/* ---------- хранилище ---------- */
SC.galleryList = () => {
  try { return JSON.parse(localStorage.getItem(SC.GALLERY_KEY)) || []; }
  catch { return []; }
};
SC.galleryStore = list => localStorage.setItem(SC.GALLERY_KEY, JSON.stringify(list));

SC.galleryPlural = n => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "слайд";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "слайда";
  return "слайдов";
};

/* цвет карточки под тему (если есть SC_THEMES — берёт из них) */
SC.galleryThemeColor = t => {
  const th = window.SC_THEMES?.[t];
  if (th) return th.accent || th.bg || "#5a6270";
  const map = {
    graphite: "#4a5162", night: "#2b3a67", light: "#cfd3dc", sunset: "#ff9950",
    mint: "#3ecf8e", ocean: "#3aa0ff", berry: "#e05263", sand: "#d9b382",
    "графит": "#4a5162", "ночь": "#2b3a67", "свет": "#cfd3dc", "закат": "#ff9950",
    "мята": "#3ecf8e", "океан": "#3aa0ff", "ягода": "#e05263", "песок": "#d9b382"
  };
  return map[String(t || "").toLowerCase().trim()] || "#5a6270";
};

/* ---------- сохранить текущую презентацию ---------- */
SC.gallerySave = () => {
  const p = SC.state.presentation;
  if (!p?.slides?.length) { alert("Сначала сгенерируй или загрузи презентацию."); return; }

  const list = SC.galleryList();
  const now = new Date().toISOString();
  const copy = JSON.parse(JSON.stringify(p));   // независимая копия
  const theme = SC.$("themeSelect")?.value || "";

  // если эта презентация уже из галереи — обновляем её,
  // но если название сменилось, спрашиваем: обновить или сохранить как новую
  let existing = SC.state.galleryId ? list.find(x => x.id === SC.state.galleryId) : null;
  if (existing && (copy.title || "") !== existing.title) {
    const upd = confirm(`В галерее уже есть «${existing.title}».\nОК — обновить её, Отмена — сохранить как новую.`);
    if (!upd) existing = null;
  }

  if (existing) {
    Object.assign(existing, {
      presentation: copy,
      title: copy.title || existing.title,
      theme, slidesCount: copy.slides.length, updatedAt: now
    });
    SC.setStatus(`Обновлено в галерее: «${existing.title}»`);
  } else {
    const item = {
      id: Date.now(),
      title: copy.title || "Без названия",
      theme, createdAt: now, updatedAt: now,
      slidesCount: copy.slides.length,
      presentation: copy
    };
    list.unshift(item);
    SC.state.galleryId = item.id;
    SC.setStatus(`Сохранено в галерее: «${item.title}»`);
  }

  SC.galleryStore(list);
  localStorage.setItem(SC.GALLERY_CUR_KEY, String(SC.state.galleryId || ""));
};

/* ---------- открыть / удалить ---------- */
SC.galleryOpenItem = id => {
  const item = SC.galleryList().find(x => x.id === id);
  if (!item) return;
  SC.state.presentation = JSON.parse(JSON.stringify(item.presentation));
  SC.state.currentSlide = 0;
  SC.state.galleryId = id;
  localStorage.setItem(SC.GALLERY_CUR_KEY, String(id));
  const sel = SC.$("themeSelect");
  if (sel && item.theme) sel.value = item.theme;   // вернуть тему, с которой сохраняли
  SC.render();
  SC.persist();
  SC.closeGallery();
  SC.setStatus(`Загружено из галереи: «${item.title}»`);
};

SC.galleryDelete = id => {
  const item = SC.galleryList().find(x => x.id === id);
  if (!item) return;
  if (!confirm(`Удалить «${item.title}» из галереи?`)) return;
  SC.galleryStore(SC.galleryList().filter(x => x.id !== id));
  if (SC.state.galleryId === id) {
    SC.state.galleryId = null;
    localStorage.setItem(SC.GALLERY_CUR_KEY, "");
  }
  SC.galleryRenderGrid();
  SC.setStatus("Презентация удалена из галереи.");
};

/* ---------- интерфейс ---------- */
SC.ensureGalleryUi = () => {
  if (SC.$("galleryOverlay")) return;

  const st = document.createElement("style");
  st.textContent = `
    .gallery-overlay{position:fixed;inset:0;z-index:1000;background:rgba(9,10,13,.85);
      backdrop-filter:blur(8px);overflow-y:auto;padding:48px 24px}
    .gallery-overlay.g-hidden{display:none}
    .gallery-box{width:min(980px,100%);margin:0 auto}
    .gallery-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}
    .gallery-head h2{margin:0;font-size:22px;color:#e8eaf0}
    .gallery-close{
    width:38px;height:38px;border-radius:10px;
    border:1px solid #3a3f4b;background:transparent;color:#aab1c0;
    font-size:18px;line-height:1;padding:0;cursor:pointer;
    display:inline-flex;align-items:center;justify-content:center;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    transition:background .15s,color .15s;
    }
    .gallery-close:hover{background:#22242c;color:#e8eaf0}
    .gallery-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(265px,1fr));gap:14px}
    .gallery-empty{color:#8a8f9c;text-align:center;padding:70px 0;font-size:15px;line-height:1.6}
    .g-card{background:#171920;border:1px solid #2a2d38;border-radius:14px;overflow:hidden;
      cursor:pointer;transition:transform .15s,border-color .15s;display:flex;flex-direction:column}
    .g-card:hover{border-color:#4a5162;transform:translateY(-2px)}
    .g-accent{height:6px;flex-shrink:0}
    .g-body{padding:14px 14px 6px;flex:1}
    .g-title{font-weight:600;color:#e8eaf0;font-size:15px;line-height:1.35;display:-webkit-box;
      -webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .g-meta{margin-top:6px;color:#7f8595;font-size:12.5px}
    .g-actions{display:flex;gap:8px;padding:10px 14px 14px}
    .g-actions button{flex:1;padding:8px 0;border-radius:9px;border:1px solid #333846;
      background:#1f222c;color:#cfd3dd;cursor:pointer;font-size:13px}
    .g-actions .g-open:hover{background:#2a2f3d}
    .g-actions .g-del{color:#e07683}
    .g-actions .g-del:hover{background:#3a2026;border-color:#5a2b33}
  `;
  document.head.appendChild(st);

  const ov = document.createElement("div");
  ov.id = "galleryOverlay";
  ov.className = "gallery-overlay g-hidden";
  ov.innerHTML = `
    <div class="gallery-box">
      <div class="gallery-head">
        <h2>🗂 Галерея презентаций</h2>
        <button id="galleryCloseBtn" class="gallery-close" title="Закрыть (Esc)">✕</button>
      </div>
      <div id="galleryGrid" class="gallery-grid"></div>
      <div id="galleryEmpty" class="gallery-empty g-hidden">
        Пока пусто.<br>Сгенерируй презентацию и нажми «💾 В галерею», чтобы сохранить её здесь.
      </div>
    </div>`;
  document.body.appendChild(ov);

  SC.$("galleryCloseBtn").addEventListener("click", SC.closeGallery);
  ov.addEventListener("click", e => { if (e.target === ov) SC.closeGallery(); });

  // клики по карточкам (делегирование)
  SC.$("galleryGrid").addEventListener("click", e => {
    const card = e.target.closest(".g-card");
    if (!card) return;
    const id = Number(card.dataset.id);
    if (e.target.closest(".g-del")) SC.galleryDelete(id);
    else SC.galleryOpenItem(id);   // клик по карточке или «Открыть»
  });
};

SC.galleryRenderGrid = () => {
  const grid = SC.$("galleryGrid"), empty = SC.$("galleryEmpty");
  if (!grid) return;
  const esc = SC.escapeHtml || (s => String(s));
  const list = SC.galleryList();
  empty.classList.toggle("g-hidden", list.length > 0);
  grid.innerHTML = list.map(it => {
    const d = new Date(it.updatedAt || it.createdAt);
    const date = d.toLocaleString("ru-RU", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
    });
    return `
      <div class="g-card" data-id="${it.id}">
        <div class="g-accent" style="background:${SC.galleryThemeColor(it.theme)}"></div>
        <div class="g-body">
          <div class="g-title">${esc(it.title)}</div>
          <div class="g-meta">${it.slidesCount} ${SC.galleryPlural(it.slidesCount)} · ${date}</div>
        </div>
        <div class="g-actions">
          <button class="g-open">Открыть</button>
          <button class="g-del">Удалить</button>
        </div>
      </div>`;
  }).join("");
};

SC.galleryIsOpen = () =>
  !!SC.$("galleryOverlay") && !SC.$("galleryOverlay").classList.contains("g-hidden");

SC.openGallery = () => {
  SC.ensureGalleryUi();
  SC.galleryRenderGrid();
  SC.$("galleryOverlay").classList.remove("g-hidden");
};
SC.closeGallery = () => SC.$("galleryOverlay")?.classList.add("g-hidden");

/* ---------- инициализация ---------- */
SC.galleryInit = () => {
  // помним, какая презентация в галерее «своя» (для обновления при сохранении)
  const gid = Number(localStorage.getItem(SC.GALLERY_CUR_KEY) || 0);
  if (gid) SC.state.galleryId = gid;

  // кнопка «В галерею» рядом с кнопками экспорта
  const anchor = SC.$("odpBtn") || SC.$("pptxBtn");
  if (anchor && !SC.$("gallerySaveBtn")) {
    const b = document.createElement("button");
    b.id = "gallerySaveBtn";
    b.textContent = "💾 В галерею";
    if (anchor.className) b.className = anchor.className;  // унаследует твои стили кнопок
    anchor.insertAdjacentElement("afterend", b);
    b.addEventListener("click", SC.gallerySave);
  }

  // ссылки верхнего меню
  document.querySelectorAll("a").forEach(a => {
    const t = a.textContent.trim().toLowerCase();
    if (t === "галерея") a.addEventListener("click", e => { e.preventDefault(); SC.openGallery(); });
    if (t === "создать") a.addEventListener("click", e => { e.preventDefault(); SC.closeGallery(); });
  });

  // клавиатура: Esc закрывает галерею; стрелки не листают слайды под ней
  document.addEventListener("keydown", e => {
    if (!SC.galleryIsOpen()) return;
    if (e.key === "Escape") SC.closeGallery();
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") e.stopImmediatePropagation();
  }, true);
};

SC.galleryInit();