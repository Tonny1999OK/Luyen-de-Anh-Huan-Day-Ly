(() => {
  "use strict";

  const STORAGE_KEY = "anh_huan_physics_exam_results_v1";
  const EXAM_SECONDS = EXAM_DATA.durationMinutes * 60;
  const TF_SCORE = { 0: 0, 1: 0.1, 2: 0.25, 3: 0.5, 4: 1 };

  const state = {
    screen: "home",
    candidate: { name: "", className: "" },
    currentIndex: 0,
    secondsLeft: EXAM_SECONDS,
    timerId: null,
    startedAt: null,
    submitted: false,
    answers: createEmptyAnswers(),
    latestResult: null
  };

  const items = [
    ...EXAM_DATA.mcq.map((question, index) => ({ type: "mcq", part: 1, number: index + 1, question })),
    ...EXAM_DATA.trueFalse.map((question, index) => ({ type: "tf", part: 2, number: index + 1, question })),
    ...EXAM_DATA.shortAnswer.map((question, index) => ({ type: "short", part: 3, number: index + 1, question }))
  ];

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  function createEmptyAnswers() {
    return { mcq: {}, tf: {}, short: {} };
  }

  function initialize() {
    bindNavigation();
    bindHome();
    bindExamControls();
    bindResultControls();
    bindDashboardControls();
    renderQuestionNavigation();
    renderQuestion();
    renderDashboard();
  }

  function bindNavigation() {
    $$('[data-screen]').forEach((element) => {
      element.addEventListener("click", (event) => {
        event.preventDefault();
        const target = element.dataset.screen;
        if (target === "home" && state.screen === "exam" && !state.submitted) {
          if (!window.confirm("Bài làm đang diễn ra. Bạn có chắc muốn rời khỏi đề thi?")) return;
          stopTimer();
        }
        showScreen(target);
      });
    });
  }

  function bindHome() {
    $("#start-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const name = $("#student-name").value.trim();
      const className = $("#student-class").value.trim().toUpperCase();
      if (!name || !className) {
        showToast("Vui lòng nhập đầy đủ họ tên và lớp.");
        return;
      }
      startExam(name, className);
    });

    $("#load-sample-button").addEventListener("click", () => {
      seedSampleData();
      showScreen("dashboard");
    });
  }

  function bindExamControls() {
    $("#previous-button").addEventListener("click", () => navigateQuestion(-1));
    $("#submit-exam-button").addEventListener("click", openSubmitModal);
    $("#confirm-submit-button").addEventListener("click", () => submitExam(false));
    $$('[data-close-modal]').forEach((element) => element.addEventListener("click", closeSubmitModal));
  }

  function bindResultControls() {
    $("#retry-button").addEventListener("click", () => {
      startExam(state.candidate.name, state.candidate.className);
    });
    $("#view-dashboard-button").addEventListener("click", () => showScreen("dashboard"));
  }

  function bindDashboardControls() {
    $("#seed-dashboard-button").addEventListener("click", seedSampleData);
    $("#export-button").addEventListener("click", exportCsv);
    $("#clear-results-button").addEventListener("click", clearResults);
    $("#search-result").addEventListener("input", renderResultsTable);
    $("#class-filter").addEventListener("change", renderResultsTable);
  }

  function showScreen(screenName) {
    state.screen = screenName;
    $$(".screen").forEach((screen) => screen.classList.remove("active"));
    $(`#${screenName}-screen`).classList.add("active");
    $$(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.screen === screenName));
    if (screenName === "dashboard") renderDashboard();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startExam(name, className) {
    state.candidate = { name, className };
    state.currentIndex = 0;
    state.secondsLeft = EXAM_SECONDS;
    state.startedAt = Date.now();
    state.submitted = false;
    state.answers = createEmptyAnswers();
    state.latestResult = null;

    $("#candidate-line").textContent = `${name} · Lớp ${className}`;
    renderQuestionNavigation();
    renderQuestion();
    updateTimerDisplay();
    updateProgress();
    showScreen("exam");
    startTimer();
  }

  function startTimer() {
    stopTimer();
    state.timerId = window.setInterval(() => {
      state.secondsLeft -= 1;
      updateTimerDisplay();
      if (state.secondsLeft <= 0) submitExam(true);
    }, 1000);
  }

  function stopTimer() {
    if (state.timerId) window.clearInterval(state.timerId);
    state.timerId = null;
  }

  function updateTimerDisplay() {
    const minutes = Math.max(0, Math.floor(state.secondsLeft / 60));
    const seconds = Math.max(0, state.secondsLeft % 60);
    $("#timer").textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    const timerCard = $("#timer-card");
    timerCard.classList.toggle("warning", state.secondsLeft <= 600 && state.secondsLeft > 300);
    timerCard.classList.toggle("danger", state.secondsLeft <= 300);
  }

  function navigateQuestion(direction) {
    state.currentIndex = Math.min(items.length - 1, Math.max(0, state.currentIndex + direction));
    renderQuestion();
    renderQuestionNavigation();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderQuestionNavigation() {
    const groups = [
      { part: 1, title: "Phần I", items: items.filter((item) => item.part === 1) },
      { part: 2, title: "Phần II", items: items.filter((item) => item.part === 2) },
      { part: 3, title: "Phần III", items: items.filter((item) => item.part === 3) }
    ];

    $("#question-navigation").innerHTML = groups.map((group) => `
      <div class="nav-part">
        <div class="nav-part-title"><span>${group.title}</span><span>${group.items.length} câu</span></div>
        <div class="nav-buttons">
          ${group.items.map((item) => {
            const globalIndex = items.indexOf(item);
            const classes = ["question-nav-button"];
            if (isItemAnswered(item)) classes.push("done");
            if (globalIndex === state.currentIndex) classes.push("current");
            return `<button class="${classes.join(" ")}" type="button" data-question-index="${globalIndex}">${item.number}</button>`;
          }).join("")}
        </div>
      </div>
    `).join("");

    $$('[data-question-index]').forEach((button) => {
      button.addEventListener("click", () => {
        state.currentIndex = Number(button.dataset.questionIndex);
        renderQuestion();
        renderQuestionNavigation();
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });
    updateProgress();
  }

  function renderQuestion() {
    const item = items[state.currentIndex];
    const totalInPart = items.filter((candidate) => candidate.part === item.part).length;
    let html = `
      <div class="question-topline">
        <span class="question-type">${typeLabel(item.type)}</span>
        <span class="question-index">Câu ${item.number}/${totalInPart} · ${item.question.topic}</span>
      </div>
    `;

    if (item.type === "mcq") html += renderMcq(item);
    if (item.type === "tf") html += renderTrueFalse(item);
    if (item.type === "short") html += renderShortAnswer(item);

    $("#question-content").innerHTML = html;
    bindQuestionInputs(item);
    $("#previous-button").disabled = state.currentIndex === 0;
    $("#next-button").textContent = state.currentIndex === items.length - 1 ? "Kiểm tra và nộp bài" : "Câu tiếp theo →";
    $("#next-button").onclick = state.currentIndex === items.length - 1 ? openSubmitModal : () => navigateQuestion(1);
  }

  function renderMcq(item) {
    const selected = state.answers.mcq[item.question.id];
    return `
      <h2 class="question-stem">${item.question.stem}</h2>
      <div class="option-list">
        ${item.question.options.map((option, index) => `
          <button class="option-button ${selected === index ? "selected" : ""}" type="button" data-mcq-option="${index}">
            <span class="option-letter">${String.fromCharCode(65 + index)}</span>
            <span>${option}</span>
          </button>
        `).join("")}
      </div>
    `;
  }

  function renderTrueFalse(item) {
    const selected = state.answers.tf[item.question.id] || {};
    return `
      <h2 class="question-stem">Xác định tính đúng hoặc sai của từng nhận định.</h2>
      <div class="question-context">${item.question.context}</div>
      <div class="tf-list">
        ${item.question.statements.map((statement, index) => `
          <div class="tf-row">
            <span class="tf-label">${String.fromCharCode(97 + index)})</span>
            <span class="tf-text">${statement.text}</span>
            <button class="tf-choice true ${selected[index] === true ? "selected" : ""}" type="button" data-tf-index="${index}" data-tf-value="true">Đúng</button>
            <button class="tf-choice false ${selected[index] === false ? "selected" : ""}" type="button" data-tf-index="${index}" data-tf-value="false">Sai</button>
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderShortAnswer(item) {
    const value = state.answers.short[item.question.id] ?? "";
    return `
      <h2 class="question-stem">${item.question.stem}</h2>
      <div class="short-answer-box">
        <label for="short-answer-input">Nhập kết quả cuối cùng</label>
        <div class="short-answer-row">
          <input id="short-answer-input" inputmode="decimal" autocomplete="off" value="${escapeHtml(String(value))}" placeholder="Nhập một số" />
          <span class="unit-badge">${item.question.unit}</span>
        </div>
        <p class="answer-note">Có thể dùng dấu phẩy hoặc dấu chấm cho phần thập phân. Không nhập đơn vị vào ô trả lời.</p>
      </div>
    `;
  }

  function bindQuestionInputs(item) {
    if (item.type === "mcq") {
      $$('[data-mcq-option]').forEach((button) => {
        button.addEventListener("click", () => {
          state.answers.mcq[item.question.id] = Number(button.dataset.mcqOption);
          renderQuestion();
          renderQuestionNavigation();
        });
      });
    }

    if (item.type === "tf") {
      $$('[data-tf-index]').forEach((button) => {
        button.addEventListener("click", () => {
          const questionAnswers = state.answers.tf[item.question.id] || {};
          questionAnswers[Number(button.dataset.tfIndex)] = button.dataset.tfValue === "true";
          state.answers.tf[item.question.id] = questionAnswers;
          renderQuestion();
          renderQuestionNavigation();
        });
      });
    }

    if (item.type === "short") {
      const input = $("#short-answer-input");
      input.addEventListener("input", () => {
        state.answers.short[item.question.id] = input.value.trim();
        renderQuestionNavigation();
      });
    }
  }

  function typeLabel(type) {
    return type === "mcq" ? "Phần I · Nhiều lựa chọn" : type === "tf" ? "Phần II · Đúng/Sai" : "Phần III · Trả lời ngắn";
  }

  function isItemAnswered(item) {
    if (item.type === "mcq") return Number.isInteger(state.answers.mcq[item.question.id]);
    if (item.type === "tf") return Object.keys(state.answers.tf[item.question.id] || {}).length === 4;
    return String(state.answers.short[item.question.id] ?? "").trim() !== "";
  }

  function updateProgress() {
    const answered = items.filter(isItemAnswered).length;
    $("#progress-text").textContent = `${answered}/${items.length}`;
    $("#progress-bar").style.width = `${(answered / items.length) * 100}%`;
  }

  function openSubmitModal() {
    const unanswered = items.filter((item) => !isItemAnswered(item)).length;
    $("#modal-message").textContent = unanswered
      ? `Bạn còn ${unanswered} câu chưa trả lời. Các câu bỏ trống sẽ không được tính điểm.`
      : "Bạn đã trả lời đầy đủ 28 câu. Hãy kiểm tra lần cuối trước khi nộp.";
    $("#confirm-modal").classList.add("open");
    $("#confirm-modal").setAttribute("aria-hidden", "false");
  }

  function closeSubmitModal() {
    $("#confirm-modal").classList.remove("open");
    $("#confirm-modal").setAttribute("aria-hidden", "true");
  }

  function submitExam(autoSubmitted) {
    if (state.submitted) return;
    state.submitted = true;
    stopTimer();
    closeSubmitModal();

    const scores = calculateScores();
    const timeUsedSeconds = EXAM_SECONDS - Math.max(0, state.secondsLeft);
    const result = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: state.candidate.name,
      className: state.candidate.className,
      submittedAt: new Date().toISOString(),
      autoSubmitted,
      timeUsedSeconds,
      score: round2(scores.total),
      part1: round2(scores.part1),
      part2: round2(scores.part2),
      part3: round2(scores.part3),
      mcqCorrect: scores.mcqCorrect,
      tfCorrectStatements: scores.tfCorrectStatements,
      shortCorrect: scores.shortCorrect,
      answers: JSON.parse(JSON.stringify(state.answers))
    };
const results = getResults();
results.unshift(result);

// Vẫn lưu một bản trên trình duyệt để dự phòng mất mạng.
saveResults(results);

state.latestResult = result;
renderResult(result);
showScreen("result");

// Gửi một bản lên Supabase.
void saveResultToSupabase(result)
  .then(() => {
    showToast("Kết quả đã được lưu lên hệ thống.");
  })
  .catch((error) => {
    console.error("Lỗi lưu Supabase:", error);

    showToast(
      "Chưa lưu được lên máy chủ. Kết quả vẫn còn trên thiết bị này."
    );
  });    if (autoSubmitted) showToast("Hết giờ. Hệ thống đã tự động nộp bài.");
  }

  function calculateScores() {
    let mcqCorrect = 0;
    EXAM_DATA.mcq.forEach((question) => {
      if (state.answers.mcq[question.id] === question.answer) mcqCorrect += 1;
    });

    let part2 = 0;
    let tfCorrectStatements = 0;
    EXAM_DATA.trueFalse.forEach((question) => {
      const selected = state.answers.tf[question.id] || {};
      let correctInQuestion = 0;
      question.statements.forEach((statement, index) => {
        if (selected[index] === statement.answer) correctInQuestion += 1;
      });
      tfCorrectStatements += correctInQuestion;
      part2 += TF_SCORE[correctInQuestion];
    });

    let shortCorrect = 0;
    EXAM_DATA.shortAnswer.forEach((question) => {
      const parsed = parseNumericAnswer(state.answers.short[question.id]);
      if (Number.isFinite(parsed) && Math.abs(parsed - question.answer) <= question.tolerance) shortCorrect += 1;
    });

    const part1 = mcqCorrect * 0.25;
    const part3 = shortCorrect * 0.25;
    return { part1, part2, part3, total: part1 + part2 + part3, mcqCorrect, tfCorrectStatements, shortCorrect };
  }

  function parseNumericAnswer(value) {
    if (value === undefined || value === null || String(value).trim() === "") return NaN;
    return Number(String(value).trim().replace(",", "."));
  }

  function renderResult(result) {
    $("#result-name").textContent = `${result.name} · ${result.className}`;
    $("#result-message").textContent = result.autoSubmitted
      ? "Hết thời gian, hệ thống đã tự động nộp bài và lưu kết quả của bạn."
      : result.score >= 8
        ? "Kết quả tốt. Hãy xem lại những câu sai để giữ vững mức điểm này."
        : result.score >= 5
          ? "Bạn đã đạt mức cơ bản. Tập trung cải thiện phần có điểm thấp nhất."
          : "Bạn cần củng cố lại kiến thức nền và luyện từng dạng trước khi làm đề tiếp theo.";
    $("#final-score").textContent = result.score.toFixed(2);
    $("#part-one-score").textContent = result.part1.toFixed(2);
    $("#part-two-score").textContent = result.part2.toFixed(2);
    $("#part-three-score").textContent = result.part3.toFixed(2);
    $("#time-used").textContent = formatDuration(result.timeUsedSeconds);
    renderReview(result);
  }

  function renderReview(result) {
    const reviewHtml = items.map((item, globalIndex) => {
      const review = getItemReview(item, result.answers);
      return `
        <article class="review-item">
          <button class="review-summary" type="button" data-review-index="${globalIndex}">
            <span class="review-status ${review.correct ? "correct" : "wrong"}">${review.correct ? "✓" : "×"}</span>
            <strong>${item.type === "tf" ? `Phần II · Câu ${item.number}` : `Câu ${item.question.id}`}: ${truncate(item.type === "tf" ? item.question.context : item.question.stem, 120)}</strong>
            <small>${review.label}</small>
          </button>
          <div class="review-detail">
            ${review.detail}
            <div class="review-answer"><strong>Lời giải:</strong> ${item.question.explanation || review.explanation}</div>
          </div>
        </article>
      `;
    }).join("");

    $("#review-list").innerHTML = reviewHtml;
    $$('[data-review-index]').forEach((button) => {
      button.addEventListener("click", () => button.closest(".review-item").classList.toggle("open"));
    });
  }

  function getItemReview(item, answers) {
    if (item.type === "mcq") {
      const selected = answers.mcq[item.question.id];
      const correct = selected === item.question.answer;
      const selectedText = Number.isInteger(selected) ? `${String.fromCharCode(65 + selected)}. ${item.question.options[selected]}` : "Chưa trả lời";
      const correctText = `${String.fromCharCode(65 + item.question.answer)}. ${item.question.options[item.question.answer]}`;
      return {
        correct,
        label: correct ? "+0,25 điểm" : "0 điểm",
        detail: `<p><strong>Bạn chọn:</strong> ${selectedText}</p><p><strong>Đáp án đúng:</strong> ${correctText}</p>`,
        explanation: item.question.explanation
      };
    }

    if (item.type === "tf") {
      const selected = answers.tf[item.question.id] || {};
      let correctCount = 0;
      const lines = item.question.statements.map((statement, index) => {
        const isCorrect = selected[index] === statement.answer;
        if (isCorrect) correctCount += 1;
        const selectedLabel = selected[index] === undefined ? "Chưa chọn" : selected[index] ? "Đúng" : "Sai";
        const answerLabel = statement.answer ? "Đúng" : "Sai";
        return `<p><strong>${String.fromCharCode(97 + index)})</strong> ${statement.text}<br/>Bạn chọn: ${selectedLabel} · Đáp án: ${answerLabel}<br/><em>${statement.explanation}</em></p>`;
      }).join("");
      return {
        correct: correctCount === 4,
        label: `${correctCount}/4 ý đúng · +${TF_SCORE[correctCount].toFixed(2)} điểm`,
        detail: lines,
        explanation: "Điểm của câu Đúng/Sai được tính theo tổng số ý đúng trong cùng một câu."
      };
    }

    const selectedValue = parseNumericAnswer(answers.short[item.question.id]);
    const correct = Number.isFinite(selectedValue) && Math.abs(selectedValue - item.question.answer) <= item.question.tolerance;
    return {
      correct,
      label: correct ? "+0,25 điểm" : "0 điểm",
      detail: `<p><strong>Bạn trả lời:</strong> ${Number.isFinite(selectedValue) ? `${selectedValue} ${item.question.unit}` : "Chưa trả lời"}</p><p><strong>Đáp án:</strong> ${item.question.answer} ${item.question.unit}</p>`,
      explanation: item.question.explanation
    };
  }

  function getResults() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(stored) ? stored : [];
    } catch {
      return [];
    }
  }

  function saveResults(results) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(results));
  }

  function renderDashboard() {
    const results = getResults();
    const total = results.length;
    const average = total ? results.reduce((sum, result) => sum + result.score, 0) / total : 0;
    const highest = total ? Math.max(...results.map((result) => result.score)) : 0;
    const passRate = total ? (results.filter((result) => result.score >= 5).length / total) * 100 : 0;

    $("#stat-attempts").textContent = total;
    $("#stat-average").textContent = average.toFixed(2);
    $("#stat-highest").textContent = highest.toFixed(2);
    $("#stat-pass-rate").textContent = `${Math.round(passRate)}%`;

    renderDistribution(results);
    renderPartAverages(results);
    populateClassFilter(results);
    renderResultsTable();
  }

  function renderDistribution(results) {
    const buckets = [
      { label: "Dưới 5", count: results.filter((r) => r.score < 5).length },
      { label: "5 – 6,4", count: results.filter((r) => r.score >= 5 && r.score < 6.5).length },
      { label: "6,5 – 7,9", count: results.filter((r) => r.score >= 6.5 && r.score < 8).length },
      { label: "8 – 10", count: results.filter((r) => r.score >= 8).length }
    ];
    const max = Math.max(1, ...buckets.map((bucket) => bucket.count));
    $("#distribution-chart").innerHTML = buckets.map((bucket) => `
      <div class="distribution-column">
        <div class="bar-area"><div class="bar" style="height:${(bucket.count / max) * 100}%"></div></div>
        <strong>${bucket.count}</strong>
        <span>${bucket.label}</span>
      </div>
    `).join("");
  }

  function renderPartAverages(results) {
    const parts = [
      { label: "Phần I", max: 4.5, value: averageField(results, "part1") },
      { label: "Phần II", max: 4, value: averageField(results, "part2") },
      { label: "Phần III", max: 1.5, value: averageField(results, "part3") }
    ];
    $("#part-chart").innerHTML = parts.map((part) => `
      <div class="part-bar-row">
        <span>${part.label}</span>
        <div class="part-bar-track"><i style="width:${part.max ? (part.value / part.max) * 100 : 0}%"></i></div>
        <strong>${part.value.toFixed(2)}</strong>
      </div>
    `).join("");
  }

  function averageField(results, field) {
    return results.length ? results.reduce((sum, result) => sum + Number(result[field] || 0), 0) / results.length : 0;
  }

  function populateClassFilter(results) {
    const current = $("#class-filter").value;
    const classes = [...new Set(results.map((result) => result.className))].sort();
    $("#class-filter").innerHTML = `<option value="">Tất cả lớp</option>${classes.map((className) => `<option value="${escapeHtml(className)}">${escapeHtml(className)}</option>`).join("")}`;
    if (classes.includes(current)) $("#class-filter").value = current;
  }

  function renderResultsTable() {
    const results = getResults();
    const search = $("#search-result").value.trim().toLocaleLowerCase("vi");
    const classFilter = $("#class-filter").value;
    const filtered = results.filter((result) => {
      const matchesSearch = result.name.toLocaleLowerCase("vi").includes(search);
      const matchesClass = !classFilter || result.className === classFilter;
      return matchesSearch && matchesClass;
    });

    $("#results-table-body").innerHTML = filtered.map((result) => `
      <tr>
        <td><strong>${escapeHtml(result.name)}</strong></td>
        <td>${escapeHtml(result.className)}</td>
        <td>${Number(result.part1).toFixed(2)}</td>
        <td>${Number(result.part2).toFixed(2)}</td>
        <td>${Number(result.part3).toFixed(2)}</td>
        <td><span class="score-badge ${scoreClass(result.score)}">${Number(result.score).toFixed(2)}</span></td>
        <td>${formatDuration(result.timeUsedSeconds)}</td>
        <td>${formatDate(result.submittedAt)}</td>
      </tr>
    `).join("");
    $("#empty-results").style.display = filtered.length ? "none" : "block";
    $(".table-wrap").style.display = filtered.length ? "block" : "none";
  }

  function scoreClass(score) {
    return score >= 8 ? "good" : score >= 5 ? "average" : "low";
  }

  function seedSampleData() {
    const current = getResults();
    if (current.some((result) => String(result.id).startsWith("sample-"))) {
      showToast("Dữ liệu mẫu đã có sẵn trong bảng điểm.");
      renderDashboard();
      return;
    }

    const names = [
      ["Nguyễn Minh Anh", "12A1", 8.75, 4.0, 3.5, 1.25, 2120],
      ["Trần Gia Huy", "12A1", 7.25, 3.5, 2.75, 1.0, 2460],
      ["Lê Phương Thảo", "12A2", 9.25, 4.25, 3.75, 1.25, 1980],
      ["Phạm Đức Long", "12A2", 5.75, 3.0, 2.0, 0.75, 2860],
      ["Võ Khánh Linh", "12A3", 6.5, 3.25, 2.5, 0.75, 2685],
      ["Hoàng Nhật Nam", "12A3", 4.5, 2.5, 1.5, 0.5, 2990],
      ["Đỗ Thu Hà", "12A1", 8.0, 3.75, 3.25, 1.0, 2240],
      ["Bùi Quang Vinh", "12A2", 6.0, 3.0, 2.25, 0.75, 2735]
    ];

    const samples = names.map((entry, index) => ({
      id: `sample-${index + 1}`,
      name: entry[0],
      className: entry[1],
      score: entry[2],
      part1: entry[3],
      part2: entry[4],
      part3: entry[5],
      timeUsedSeconds: entry[6],
      submittedAt: new Date(Date.now() - index * 86400000).toISOString(),
      autoSubmitted: false,
      answers: createEmptyAnswers()
    }));
    saveResults([...current, ...samples]);
    renderDashboard();
    showToast("Đã nạp 8 kết quả mẫu.");
  }

  function exportCsv() {
    const results = getResults();
    if (!results.length) {
      showToast("Chưa có dữ liệu để xuất.");
      return;
    }
    const rows = [
      ["Họ và tên", "Lớp", "Phần I", "Phần II", "Phần III", "Tổng điểm", "Thời gian (giây)", "Ngày làm"],
      ...results.map((result) => [result.name, result.className, result.part1, result.part2, result.part3, result.score, result.timeUsedSeconds, formatDate(result.submittedAt)])
    ];
    const csv = "\uFEFF" + rows.map((row) => row.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `bang-diem-vat-li-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function csvEscape(value) {
    const text = String(value ?? "").replace(/"/g, '""');
    return `"${text}"`;
  }

  function clearResults() {
    if (!getResults().length) return;
    if (!window.confirm("Xóa toàn bộ lịch sử điểm trên trình duyệt này? Hành động này không thể hoàn tác.")) return;
    localStorage.removeItem(STORAGE_KEY);
    $("#search-result").value = "";
    $("#class-filter").value = "";
    renderDashboard();
    showToast("Đã xóa toàn bộ dữ liệu điểm.");
  }

  async function saveResultToSupabase(result) {
  if (!window.supabaseClient) {
    throw new Error("Supabase chưa được khởi tạo.");
  }

  const payload = {
    client_result_id: result.id,
    exam_code: "VL-THPT-01",

    student_name: result.name,
    class_name: result.className,

    score: result.score,
    part1: result.part1,
    part2: result.part2,
    part3: result.part3,

    mcq_correct: result.mcqCorrect,
    tf_correct_statements: result.tfCorrectStatements,
    short_correct: result.shortCorrect,

    time_used_seconds: result.timeUsedSeconds,
    auto_submitted: result.autoSubmitted,

    answers: result.answers
  };

  const { error } = await window.supabaseClient
    .from("exam_attempts")
    .insert(payload);

  if (error) {
    // Mã 23505 nghĩa là kết quả này đã được lưu trước đó.
    if (error.code === "23505") {
      return;
    }

    throw error;
  }
}

  function formatDuration(totalSeconds) {
    const minutes = Math.floor(Number(totalSeconds || 0) / 60);
    const seconds = Number(totalSeconds || 0) % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function formatDate(iso) {
    const date = new Date(iso);
    return new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(date);
  }

  function round2(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  function truncate(text, maxLength) {
    return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
  }

  function escapeHtml(value) {
    return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" }[character]));
  }

  let toastTimeout;
  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(toastTimeout);
    toastTimeout = window.setTimeout(() => toast.classList.remove("show"), 2600);
  }

  document.addEventListener("DOMContentLoaded", initialize);
})();
