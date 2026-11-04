// ============================================================
// src/help.js — окно «Помощь» с правилами работы со SlideCraft
// ============================================================
window.SC = window.SC || {};

SC.helpIsOpen = () =>
  !!SC.$("helpOverlay") && !SC.$("helpOverlay").classList.contains("h-hidden");

SC.ensureHelpUi = () => {
  if (SC.$("helpOverlay")) return;

  const st = document.createElement("style");
  st.textContent = `
    .help-overlay{position:fixed;inset:0;z-index:1000;background:rgba(9,10,13,.85);
      backdrop-filter:blur(8px);overflow-y:auto;padding:48px 24px}
    .help-overlay.h-hidden{display:none}
    .help-box{width:min(780px,100%);margin:0 auto;background:#14161c;
      border:1px solid #2a2d38;border-radius:16px;padding:28px 32px}
    .help-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}
    .help-head h2{margin:0;font-size:22px;color:#e8eaf0}
    .help-close{width:38px;height:38px;border-radius:10px;border:1px solid #3a3f4b;
      background:transparent;color:#aab1c0;font-size:18px;line-height:1;padding:0;cursor:pointer;
      display:inline-flex;align-items:center;justify-content:center;
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
    .help-close:hover{background:#22242c;color:#e8eaf0}
    .help-section{margin-bottom:18px}
    .help-section h3{margin:0 0 6px;font-size:15px;color:#e8eaf0;font-weight:600}
    .help-section p,.help-section li{color:#b3b9c7;font-size:14px;line-height:1.55;margin:0 0 4px}
    .help-section ul{margin:4px 0 0 18px;padding:0}
    .help-kbd{display:inline-block;padding:1px 7px;border:1px solid #3a3f4b;border-radius:5px;
      background:#1c1f28;color:#d4d9e4;font-family:ui-monospace,monospace;font-size:12.5px;margin:0 2px}
    .help-note{margin-top:14px;padding:10px 14px;border-left:3px solid #3aa0ff;
      background:#161a24;border-radius:0 8px 8px 0;color:#9aa3b8;font-size:13px;line-height:1.5}
  `;
  document.head.appendChild(st);

  const ov = document.createElement("div");
  ov.id = "helpOverlay";
  ov.className = "help-overlay h-hidden";
  ov.innerHTML = `
    <div class="help-box">
      <div class="help-head">
        <h2>📘 Помощь — как работать со SlideCraft</h2>
        <button id="helpCloseBtn" class="help-close" title="Закрыть (Esc)">×</button>
      </div>

      <div class="help-section">
        <h3>1. Как создать презентацию</h3>
        <p>Введи тему слева, выбери количество слайдов и нажми <b>«Сгенерировать презентацию»</b>. ИИ сам напишет текст, подберёт структуру и соберёт слайды в выбранной теме оформления.</p>
        <ul>
          <li><b>Быстро</b> — ответ за несколько секунд, подойдёт для большинства тем.</li>
          <li><b>Раздумия</b> — отвечает дольше, но добавляет диаграммы и таблицы, если тема это позволяет.</li>
        </ul>
      </div>

      <div class="help-section">
        <h3>2. Как редактировать</h3>
        <p>Нажми кнопку <b>«Редактирование: выкл»</b>, чтобы включить режим правки. После этого кликай по любому тексту на слайде и меняй его. Все правки автоматически попадают во все форматы экспорта.</p>
      </div>

      <div class="help-section">
        <h3>3. Как сохраняются презентации</h3>
        <ul>
          <li><b>Автосохранение</b> — работает само после каждого изменения. Если закрыть вкладку и вернуться, последняя презентация восстановится.</li>
          <li><b>Галерея</b> — нажми кнопку <b>«💾 В галерею»</b>, чтобы сохранить презентацию с названием и датой. В галерее можно хранить много работ и открывать любую из них позже.</li>
        </ul>
      </div>

      <div class="help-section">
        <h3>4. Как экспортировать</h3>
        <ul>
          <li><b>PDF</b> — открывается окно печати, выбираешь «Сохранить как PDF».</li>
          <li><b>PPTX</b> — файл для PowerPoint. Выглядит один в один как на экране.</li>
          <li><b>ODP</b> — файл для LibreOffice Impress.</li>
        </ul>
        <p>Во всех трёх случаях слайды сохраняются как точная копия экрана — со всеми цветами, таблицами и диаграммами.</p>
      </div>

      <div class="help-section">
        <h3>5. Темы оформления</h3>
        <p>Доступно 8 тем: Графит, Ночь, Свет, Закат, Мята, Океан, Ягода, Песок. По умолчанию выбрана <b>Графит</b>. Тема сохраняется вместе с презентацией в галерее — при открытии она вернётся.</p>
      </div>

      <div class="help-section">
        <h3>6. Навигация</h3>
        <ul>
          <li>Стрелки <span class="help-kbd">←</span> <span class="help-kbd">→</span> — листать слайды.</li>
          <li><span class="help-kbd">Esc</span> — закрыть галерею или помощь.</li>
          <li>Кнопка <b>«Во весь экран»</b> — режим показа презентации.</li>
        </ul>
      </div>

      <div class="help-note">
        <b>Подсказка:</b> сайт не прокручивается — всё помещается на один экран. Это сделано, чтобы экспорт давал точную копию того, что ты видишь.
      </div>

      <div class="help-note" style="border-left-color:#e07683">
        <b>Важно:</b> если очистить данные браузера, автосохранение и галерея пропадут. Перед этим экспортируй важное в файл (PDF/PPTX/ODP).
      </div>
    </div>`;
  document.body.appendChild(ov);

  SC.$("helpCloseBtn").addEventListener("click", SC.closeHelp);
  ov.addEventListener("click", e => { if (e.target === ov) SC.closeHelp(); });
};

SC.openHelp = () => {
  SC.ensureHelpUi();
  SC.$("helpOverlay").classList.remove("h-hidden");
};
SC.closeHelp = () => SC.$("helpOverlay")?.classList.add("h-hidden");

SC.helpInit = () => {
  document.querySelectorAll("a").forEach(a => {
    const t = a.textContent.trim().toLowerCase();
    if (t === "помощь") a.addEventListener("click", e => { e.preventDefault(); SC.openHelp(); });
  });

  document.addEventListener("keydown", e => {
    if (!SC.helpIsOpen()) return;
    if (e.key === "Escape") SC.closeHelp();
  }, true);
};

SC.helpInit();