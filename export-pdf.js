window.SC = window.SC || {};

SC.exportPdf = () => {
  const pres = SC.state.presentation;
  if (!pres?.slides?.length) { alert("Сначала сгенерируй презентацию"); return; }
  const theme = SC.$("themeSelect").value;
  const total = pres.slides.length;
  SC.$("printArea").innerHTML = pres.slides.map((s, i) => `
    <div class="slide print-slide" data-theme="${theme}">${SC.slideHtml(s, i, total)}</div>`).join("");
  SC.setStatus("Открыт диалог печати. Выбери «Сохранить как PDF».");
  window.print();
};