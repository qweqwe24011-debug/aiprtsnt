window.SC = window.SC || {};

// ODP = качественный PPTX, сконвертированный локальным LibreOffice через proxy.py /convert
SC.exportOdp = async () => {
  const pres = SC.state.presentation;
  if (!pres?.slides?.length) { alert("Сначала сгенерируй презентацию"); return; }
  if (!APP_CONFIG.useProxy) {
    SC.setStatus("ODP требует запущенный proxy.py (локальная конвертация LibreOffice).");
    return;
  }
  SC.setStatus("Готовим PPTX и конвертируем в ODP через LibreOffice...");
  try {
    const blob = await SC.pptxBlob();
    const base = APP_CONFIG.proxyUrl.replace(/\/api\/chat\/?$/, "");
    const fd = new FormData();
    fd.append("file", blob, "presentation.pptx");

    const res = await fetch(base + "/convert", { method: "POST", body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || ("HTTP " + res.status));
    }
    const odp = await res.blob();
    SC.downloadBlob(odp, SC.sanitizeFilename(pres.title) + ".odp");
    SC.setStatus("ODP сохранён. Открывается в LibreOffice Impress.");
  } catch (e) {
    console.error(e);
    SC.setStatus("Ошибка ODP: " + e.message);
  }
};