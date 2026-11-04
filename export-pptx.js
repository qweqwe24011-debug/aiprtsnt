window.SC = window.SC || {};

/* ---------- снимки слайдов: один в один с экраном ---------- */
SC.captureSlides = async () => {
  const pres = SC.state.presentation;
  const root = SC.$("captureRoot");
  const theme = SC.$("themeSelect").value;
  const total = pres.slides.length;

  await document.fonts.ready; // ждём шрифты, чтобы снимок не сбился

  const shots = [];
  for (let i = 0; i < total; i++) {
    root.innerHTML = `<div class="slide capture-slide" data-theme="${theme}">${SC.slideHtml(pres.slides[i], i, total)}</div>`;
    const node = root.firstElementChild;

    const canvas = await html2canvas(node, {
      scale: 2,               // снимок 2560×1440 — чёткий в PowerPoint
      backgroundColor: null,
      width: 1280,
      height: 720,
      logging: false,
      useCORS: true
    });

    shots.push(canvas.toDataURL("image/png"));
    SC.setStatus(`Снимаем слайды: ${i + 1} / ${total}`);
  }
  root.innerHTML = "";
  return shots;
};

/* ---------- сборка PPTX из снимков ---------- */
SC.buildPptx = shots => {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "SC16x9", width: 13.33, height: 7.5 });
  pptx.layout = "SC16x9";
  pptx.author = "SlideCraft Studio";
  pptx.title = SC.state.presentation?.title || "Презентация";

  shots.forEach(data => {
    const s = pptx.addSlide();
    s.addImage({ data, x: 0, y: 0, w: 13.33, h: 7.5 }); // во весь слайд, без полей
  });
  return pptx;
};

SC.pptxBlob = async () => {
  const shots = await SC.captureSlides();
  return SC.buildPptx(shots).write({ outputType: "blob" });
};

SC.exportPptx = async () => {
  if (!SC.state.presentation?.slides?.length) { alert("Сначала сгенерируй презентацию"); return; }
  if (typeof html2canvas === "undefined") { alert("html2canvas ещё не загрузилась, подожди секунду."); return; }
  if (typeof PptxGenJS === "undefined") { alert("PptxGenJS ещё не загрузилась, подожди секунду."); return; }

  SC.setStatus("Делаем точные снимки слайдов...");
  try {
    const blob = await SC.pptxBlob();
    SC.downloadBlob(blob, SC.sanitizeFilename(SC.state.presentation.title) + ".pptx");
    SC.setStatus("PPTX сохранён: слайды один в один как на экране.");
  } catch (e) {
    console.error(e);
    SC.setStatus(`Ошибка PPTX: ${e.message}`);
  }
};