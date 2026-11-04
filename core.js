window.SC = window.SC || {};
SC.state = { presentation: null, currentSlide: 0, editMode: false };

SC.$ = id => document.getElementById(id);
SC.setStatus = t => { SC.$("status").textContent = t; };

SC.escapeHtml = v => String(v ?? "")
  .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
  .replaceAll('"',"&quot;").replaceAll("'","&#039;");

SC.parseNum = v => {
  const n = parseFloat(String(v ?? "").replace(",", ".").replace(/[^\d.]/g, ""));
  return isFinite(n) ? n : 0;
};

SC.extractJson = text => {
  if (!text) return "{}";
  let c = text.trim();
  const a = c.indexOf("{"), b = c.lastIndexOf("}");
  if (a !== -1 && b !== -1 && b > a) c = c.slice(a, b + 1);
  return c;
};

SC.sanitizeFilename = t =>
  (String(t || "presentation").replace(/[^\wа-яА-ЯёЁ\s-]/g, "").trim().replace(/\s+/g, "_")) || "presentation";

SC.downloadBlob = (blob, name) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
};

/* ---------- автосохранение ---------- */
SC.persist = () => {
  const p = SC.state.presentation;
  if (!p) return;
  localStorage.setItem("ai_pres_data", JSON.stringify(p));
  localStorage.setItem("ai_pres_slide", String(SC.state.currentSlide));
};

SC.restore = () => {
  try {
    const raw = localStorage.getItem("ai_pres_data");
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data?.slides?.length) return false;
    SC.state.presentation = data;
    SC.state.currentSlide = Math.min(
      Number(localStorage.getItem("ai_pres_slide") || 0), data.slides.length - 1);
    return true;
  } catch { return false; }
};

/* ---------- ИИ ---------- */
SC.getModel = () => APP_CONFIG.models[SC.$("modeSelect").value] || APP_CONFIG.models.fast;
SC.apiUrl   = () => APP_CONFIG.useProxy ? APP_CONFIG.proxyUrl : APP_CONFIG.directUrl;

SC.apiHeaders = () => {
  const h = { "Content-Type": "application/json" };
  if (APP_CONFIG.useProxy) h["X-Ollama-Key"] = APP_CONFIG.apiKey;
  else h["Authorization"] = `Bearer ${APP_CONFIG.apiKey}`;
  return h;
};


SC.buildPrompt = (topic, n) => {
  const accents = [
    "сделай акцент на практическом применении и реальных кейсах",
    "сделай акцент на трендах и будущем развитии",
    "сделай акцент на проблемах и их решениях",
    "сделай акцент на данных, статистике и результатах",
    "сделай акцент на инновациях и технологиях",
    "сделай акцент на человеческом факторе и опыте"
  ];
  const accent = accents[Math.floor(Math.random() * accents.length)];
  const isThink = SC.$("modeSelect").value === "think";

  return `
Ты — дизайнер и автор презентаций.
Создай презентацию на тему: "${topic}".
Количество слайдов: ${n}. Язык: русский.
${accent}.
${isThink ? 'Режим "Раздумия": добавь МАКСИМУМ деталей, данных, примеров и развёрнутых текстов.' : ''}

Верни ТОЛЬКО валидный JSON без markdown и пояснений.
Формат:
{
  "title": "Название презентации",
  "slides": [
    { "layout": "title", "title": "...", "subtitle": "..." },
    { "layout": "bullets", "title": "...", "points": ["...", "..."] },
    { "layout": "two_columns", "title": "...", "left_title": "...", "left_points": ["..."], "right_title": "...", "right_points": ["..."] },
    { "layout": "metrics", "title": "...", "metrics": [{ "value": "85%", "label": "..." }] },
    { "layout": "chart", "title": "...", "items": [{ "label": "2024", "value": "34" }, { "label": "2025", "value": "61" }] },
    { "layout": "table", "title": "...", "headers": ["Критерий", "A", "B"], "rows": [["...", "...", "..."], ["...", "...", "..."]] },
    { "layout": "quote", "text": "...", "author": "..." },
    { "layout": "closing", "title": "...", "subtitle": "..." }
  ]
}

Правила объёма (КРИТИЧНО):
- Первый слайд — "title", последний — "closing".
- В "bullets" ОБЯЗАТЕЛЬНО 5-7 пунктов, каждый пункт 10-20 слов с конкретикой и примерами.
- В "two_columns" в каждой колонке 4-6 пунктов по 8-15 слов.
- В "metrics" ровно 6 метрик (2 ряда по 3): value — короткое число или процент, label — развёрнутое пояснение 5-10 слов.
- В "chart" ОБЯЗАТЕЛЬНО 6-8 элементов; value — только число или процент, label — 3-6 слов.
- В "table" 4-5 колонок и 5-7 строк; ячейки 8-12 слов с конкретными данными.
- В "quote" текст 20-40 слов, автор с должностью или контекстом.
- В "title" subtitle 15-25 слов, раскрывающий суть презентации.
- В "closing" subtitle 15-25 слов с призывом к действию или выводами.

Общие требования:
- Текст живой, конкретный, с примерами, цифрами и фактами. Избегай общих фраз и воды.
- Каждый слайд уникален по структуре и содержанию — не повторяй одни и те же приёмы.
- Используй реальные или правдоподобные данные, проценты, суммы, сроки.
- Если тема допускает — добавь сравнения, тренды, прогнозы, кейсы.
- Комбинируй типы слайдов по-разному: не обязательно использовать все типы. Выбирай те, которые лучше подходят под тему.
`.trim();
};

SC.callOllama = async messages => {
  const res = await fetch(SC.apiUrl(), {
    method: "POST",
    headers: SC.apiHeaders(),
    body: JSON.stringify({
      model: SC.getModel(),
      stream: false,
      format: "json",
      messages,
      options: { temperature: 0.6 }
    })
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data?.message?.content || "";
};

SC.generate = async () => {
  const topic = SC.$("topic").value.trim();
  if (!topic) { alert("Введи тему презентации"); return; }
  const mode = SC.$("modeSelect").value;
  SC.setStatus(`Генерируем... Режим: ${mode === "fast" ? "быстро" : "раздумия"}.`);
  try {
    const text = await SC.callOllama([
      { role: "system", content: "Ты дизайнер презентаций. Возвращай только валидный JSON без markdown." },
      { role: "user", content: SC.buildPrompt(topic, Number(SC.$("slideCount").value || 8)) }
    ]);
    SC.state.presentation = JSON.parse(SC.extractJson(text));
    SC.state.currentSlide = 0;
    SC.render();
    SC.persist();
    SC.setStatus("Готово. Презентация сохранена автоматически.");
  } catch (e) {
    console.error(e);
    SC.setStatus(`Ошибка: ${e.message}`);
  }
};