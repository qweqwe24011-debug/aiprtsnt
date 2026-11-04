window.SC = window.SC || {};

SC.next = () => {
  const n = SC.state.presentation?.slides?.length;
  if (!n) return;
  SC.state.currentSlide = (SC.state.currentSlide + 1) % n;
  SC.render(); SC.persist();
};
SC.prev = () => {
  const n = SC.state.presentation?.slides?.length;
  if (!n) return;
  SC.state.currentSlide = (SC.state.currentSlide - 1 + n) % n;
  SC.render(); SC.persist();
};

window.SC = window.SC || {};

/* ---------- навигация ---------- */
SC.next = () => {
  const p = SC.state.presentation;
  if (!p) return;
  if (SC.state.currentSlide < p.slides.length - 1) {
    SC.state.currentSlide++;
    SC.render();
    SC.persist();
  }
};

SC.prev = () => {
  if (SC.state.currentSlide > 0) {
    SC.state.currentSlide--;
    SC.render();
    SC.persist();
  }
};

/* ---------- демо ---------- */
SC.loadDemo = () => {
  SC.state.presentation = {
    title: "Демо-презентация",
    slides: [
      {
        layout: "title",
        title: "Как ИИ меняет образование",
        subtitle: "Демо-режим: смотри дизайн без обращения к API. Узнай, как искусственный интеллект сокращает время подготовки уроков в 4 раза и повышает вовлечённость учеников на 87%."
      },
      {
        layout: "bullets",
        title: "Проблемы старого подхода",
        points: [
          "Учителя тратят до 3 часов на подготовку одного урока, собирая материалы из десятков источников",
          "Учебные пособия устаревают быстрее, чем их успевают напечатать — данные двухлетней давности уже неактуальны",
          "Невозможно учесть уровень каждого ученика в классе из 30 человек — кто-то отстаёт, кому-то скучно",
          "Проверка домашних работ занимает 2-3 дня, обратная связь приходит слишком поздно",
          "Отсутствует персонализация: все ученики получают одинаковые задания независимо от их способностей"
        ]
      },
      {
        layout: "chart",
        title: "Рост внедрения ИИ в школах, %",
        items: [
          { label: "2021", value: "5" },
          { label: "2022", value: "8" },
          { label: "2023", value: "12" },
          { label: "2024", value: "34" },
          { label: "2025", value: "61" },
          { label: "2026", value: "88" }
        ]
      },
      {
        layout: "table",
        title: "Сравнение подходов",
        headers: ["Критерий", "Обычно", "С ИИ", "Экономия"],
        rows: [
          ["Подготовка урока", "3 часа ручной работы", "25 минут с ИИ", "87% времени"],
          ["Проверка работ", "2 дня на класс", "4 часа автоматом", "75% времени"],
          ["Персонализация", "Нет, все одинаково", "Да, под каждого", "Невозможно без ИИ"],
          ["Обратная связь", "Через 2-3 дня", "Мгновенно", "В 50 раз быстрее"],
          ["Адаптация материалов", "Раз в год", "В реальном времени", "Постоянная актуальность"]
        ]
      },
      {
        layout: "metrics",
        title: "Результаты пилота в 50 школах",
        metrics: [
          { value: "×4", label: "быстрее подготовка уроков — учителя экономят до 10 часов в неделю" },
          { value: "87%", label: "рост вовлечённости учеников благодаря персонализированным заданиям" },
          { value: "−30%", label: "времени на проверку работ — ИИ берёт рутину на себя" },
          { value: "2.5x", label: "ускорение онбординга новых разработчиков в проект" },
          { value: "55%", label: "среднее сокращение времени написания рутинного кода" },
          { value: "92%", label: "учителей рекомендуют инструмент коллегам после месяца использования" }
        ]
      },
      {
        layout: "quote",
        text: "Технология не заменяет учителя — она возвращает ему время для главного: живого общения с учениками, творческого подхода и индивидуальной работы с теми, кому нужна помощь.",
        author: "Мария Иванова, учитель математики, школа №42, участник пилота"
      },
      {
        layout: "closing",
        title: "Спасибо!",
        subtitle: "Сгенерируй свою презентацию через кнопку выше. Введи тему, выбери количество слайдов — ИИ напишет текст, построит диаграммы и соберёт слайды за минуту."
      }
    ]
  };
  SC.state.currentSlide = 0;
  SC.render();
  SC.persist();
  SC.setStatus("Демо загружено. Попробуй экспорт в PPTX и ODP.");
};

/* ---------- редактирование ---------- */
SC.toggleEdit = () => {
  SC.state.editMode = !SC.state.editMode;
  SC.$("editBtn").textContent = SC.state.editMode ? "Редактирование: вкл" : "Редактирование: выкл";
  SC.render();
};

SC.applyEditing = (path, value) => {
  const p = SC.state.presentation;
  if (!p) return;
  const slide = p.slides[SC.state.currentSlide];
  if (!slide) return;

  const parts = path.split(".");
  let obj = slide;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (key === "metrics" || key === "items" || key === "rows" || key === "points" || key === "left_points" || key === "right_points") {
      obj = obj[key];
    } else if (/^\d+$/.test(key)) {
      obj = obj[Number(key)];
    } else {
      obj = obj[key];
    }
  }
  const lastKey = parts[parts.length - 1];
  if (/^\d+$/.test(lastKey)) {
    obj[Number(lastKey)] = value;
  } else {
    obj[lastKey] = value;
  }
  SC.persist();
};

SC.handleEdit = (el) => {
  const path = el.dataset.edit;
  if (!path) return;
  const value = el.innerText.trim();
  SC.applyEditing(path, value);
};

/* ---------- инициализация ---------- */
SC.init = () => {
  // кнопки навигации
  SC.$("prevBtn").addEventListener("click", SC.prev);
  SC.$("nextBtn").addEventListener("click", SC.next);

  // кнопки действий
  SC.$("genBtn").addEventListener("click", SC.generate);
  SC.$("pdfBtn").addEventListener("click", SC.exportPdf);
  SC.$("pptxBtn").addEventListener("click", SC.exportPptx);
  SC.$("odpBtn").addEventListener("click", SC.exportOdp);
  SC.$("editBtn").addEventListener("click", SC.toggleEdit);
  SC.$("fullscreenBtn").addEventListener("click", () => {
    const viewer = SC.$("viewer");
    if (!document.fullscreenElement) {
      viewer.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen();
    }
  });
  SC.$("demoBtn").addEventListener("click", SC.loadDemo);

  // клавиатура
  document.addEventListener("keydown", (e) => {
    if (SC.state.editMode) return;
    if (e.key === "ArrowRight") SC.next();
    if (e.key === "ArrowLeft") SC.prev();
  });

  // восстановление из localStorage
  if (!SC.restore()) {
    SC.loadDemo();
  } else {
    SC.render();
    SC.setStatus("Презентация восстановлена из автосохранения.");
  }
};

SC.init = () => {
  SC.$("generateBtn").addEventListener("click", SC.generate);
  SC.$("pdfBtn").addEventListener("click", SC.exportPdf);
  SC.$("pptxBtn").addEventListener("click", SC.exportPptx);
  SC.$("odpBtn").addEventListener("click", SC.exportOdp);
  SC.$("nextBtn").addEventListener("click", SC.next);
  SC.$("prevBtn").addEventListener("click", SC.prev);
  SC.$("demoBtn").addEventListener("click", SC.loadDemo);
  SC.$("themeSelect").addEventListener("change", SC.render);
  SC.$("fullscreenBtn").addEventListener("click", () => SC.$("viewer").requestFullscreen?.());
  SC.$("exitFsBtn").addEventListener("click", () => document.exitFullscreen?.());

  SC.$("editBtn").addEventListener("click", () => {
    SC.state.editMode = !SC.state.editMode;
    SC.$("editBtn").textContent = `Редактирование: ${SC.state.editMode ? "вкл" : "выкл"}`;
    SC.$("editBtn").classList.toggle("active", SC.state.editMode);
    SC.applyEditing(SC.state.editMode);
    SC.setStatus(SC.state.editMode
      ? "Кликай по тексту и правь. Правки сохраняются и попадают во все экспорты."
      : "Редактирование выключено.");
  });

  const slideBox = SC.$("slide");
  slideBox.addEventListener("input", e => SC.handleEdit(e.target, false));
  slideBox.addEventListener("blur", e => SC.handleEdit(e.target, true), true);

  document.addEventListener("keydown", e => {
    if (SC.state.editMode && document.activeElement?.isContentEditable) return;
    if (e.key === "ArrowRight") SC.next();
    if (e.key === "ArrowLeft") SC.prev();
  });

  if (SC.restore()) {
    SC.render();
    SC.setStatus("Восстановлена прошлая презентация.");
  }
};

SC.init();