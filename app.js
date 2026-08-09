(() => {
  "use strict";

  const STORAGE_KEY = "anh_huan_physics_exam_results_v2";
  const EXAM_DRAFT_PREFIX = "anh_huan_full_exam_draft_v1";
  const TF_SCORE = { 0: 0, 1: 0.1, 2: 0.25, 3: 0.5, 4: 1 };
  const REQUIRED_COUNTS = { mcq: 18, tf: 4, short: 6 };

  const state = {
    screen: "home",
    candidate: { name: "", className: "" },
    examCatalog: [],
    selectedExamId: null,
    activeExam: null,
    items: [],
    currentIndex: 0,
    secondsLeft: 0,
    timerId: null,
    startedAt: null,
    submitted: false,
    answers: createEmptyAnswers(),
    latestResult: null,
    studentUser: null,
    studentProfile: null,
    teacherUser: null,
    dashboardResults: [],
    teacherExams: [],
    examDraft: null,
    reviewFlags: new Set(),
    questionObserver: null,
    questionScrollHandler: null,
    questionScrollFrame: null,
    questionJumpTimer: null,
    observerLockUntil: 0,
    autosaveTimer: null
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const physicsChartInstances = [];

  function destroyPhysicsCharts() {
    while (physicsChartInstances.length > 0) {
      const chart = physicsChartInstances.pop();
      try {
        chart.destroy();
      } catch (error) {
        console.warn("Không hủy được đồ thị cũ:", error);
      }
    }
  }

  function createEmptyAnswers() {
    return { mcq: {}, tf: {}, short: {} };
  }

  function createEmptyExamData() {
    return { passages: [], mcq: [], trueFalse: [], shortAnswer: [] };
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  async function initialize() {
    bindNavigation();
    bindHome();
    bindStudentAuthControls();
    bindExamControls();
    bindResultControls();
    bindDashboardControls();
    bindTeacherControls();
    bindExamManagerControls();
    renderDashboard([]);
    renderQuestionBuilderFields();
    bindAutoGrowTextareas();
    await restoreCurrentSession();
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
    $("#start-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const selectedExam = state.examCatalog.find((exam) => exam.id === state.selectedExamId);
      const profile = state.studentProfile;

      if (!state.studentUser || !profile) {
        showToast("Vui lòng đăng nhập tài khoản học sinh trước.");
        showStudentAuthScreen();
        return;
      }
      if (!selectedExam) {
        showToast("Vui lòng chọn một đề trong kho đề luyện.");
        return;
      }

      const startButton = $("#start-exam-submit");
      startButton.disabled = true;
      startButton.textContent = "Đang mở đề...";
      try {
        startExam(profile.fullName, profile.className, selectedExam);
      } finally {
        startButton.disabled = false;
        startButton.textContent = "Bắt đầu làm bài";
      }
    });
  }

  function bindStudentAuthControls() {
    $$('[data-student-auth-tab]').forEach((button) => {
      button.addEventListener("click", () => switchStudentAuthMode(button.dataset.studentAuthTab));
    });
    $("#student-login-form")?.addEventListener("submit", handleStudentLogin);
    $("#student-register-form")?.addEventListener("submit", handleStudentRegister);
    $("#student-logout-button")?.addEventListener("click", handleStudentLogout);
    $("#student-auth-teacher-button")?.addEventListener("click", openTeacherAccess);
    $$('[data-toggle-password]').forEach((button) => {
      button.addEventListener("click", () => toggleStudentPassword(button));
    });
  }

  function bindExamControls() {
    $$('[data-submit-exam]').forEach((button) => button.addEventListener("click", openSubmitModal));
    $("#confirm-submit-button")?.addEventListener("click", () => submitExam(false));
    $$('[data-close-modal]').forEach((element) => element.addEventListener("click", closeSubmitModal));
    $("#mobile-question-map-button")?.addEventListener("click", openQuestionMap);
    $("#floating-question-map-button")?.addEventListener("click", openQuestionMap);
    $("#close-question-map-button")?.addEventListener("click", closeQuestionMap);
    $("#question-map-backdrop")?.addEventListener("click", closeQuestionMap);
    window.addEventListener("resize", () => {
      if (window.innerWidth > 1000) closeQuestionMap();
    });
  }

  function bindResultControls() {
    $("#retry-button").addEventListener("click", () => {
      if (state.activeExam) startExam(state.candidate.name, state.candidate.className, state.activeExam);
    });
    $("#view-dashboard-button").addEventListener("click", openTeacherAccess);
  }

  function bindDashboardControls() {
    $("#refresh-dashboard-button")?.addEventListener("click", async () => {
      const activePanel = $(".teacher-tab.active")?.dataset.teacherTab || "results";
      if (activePanel === "exams") await loadTeacherExams();
      else await loadTeacherDashboard(false);
    });
    $("#export-button").addEventListener("click", exportCsv);
    $("#logout-teacher-button")?.addEventListener("click", handleTeacherLogout);
    $("#search-result").addEventListener("input", renderResultsTable);
    $("#class-filter").addEventListener("change", renderResultsTable);
    $("#exam-filter").addEventListener("change", renderResultsTable);

    $$('[data-teacher-tab]').forEach((button) => {
      button.addEventListener("click", async () => {
        const panel = button.dataset.teacherTab;
        showTeacherPanel(panel);
        if (panel === "exams") await loadTeacherExams();
      });
    });
  }

  function bindTeacherControls() {
    $("#teacher-dashboard-button")?.addEventListener("click", openTeacherAccess);
    $("#teacher-login-form")?.addEventListener("submit", handleTeacherLogin);
    $("#teacher-magic-link-button")?.addEventListener("click", handleTeacherMagicLink);
    $("#close-teacher-login")?.addEventListener("click", closeTeacherLoginModal);
    $("#toggle-teacher-password")?.addEventListener("click", toggleTeacherPassword);
    $$('[data-close-teacher-login]').forEach((element) => {
      element.addEventListener("click", closeTeacherLoginModal);
    });
  }

  function bindExamManagerControls() {
    $("#new-exam-button")?.addEventListener("click", startNewExamDraft);
    $("#seed-default-exam-button")?.addEventListener("click", seedDefaultExam);
    $("#save-exam-draft-button")?.addEventListener("click", () => saveExamDraft(false));
    $("#publish-exam-button")?.addEventListener("click", handlePublishExam);
    $("#delete-exam-button")?.addEventListener("click", deleteCurrentExam);
    $("#question-type-input")?.addEventListener("change", renderQuestionBuilderFields);
    $("#add-question-button")?.addEventListener("click", addQuestionToDraft);
    $("#add-passage-button")?.addEventListener("click", addPassageToDraft);
  }

  async function loadPublishedExams() {
    const status = $("#exam-catalog-status");
    status.textContent = "Đang tải danh sách đề...";

    if (!window.supabaseClient) {
      status.textContent = "Supabase chưa được kết nối.";
      renderExamCatalog();
      return;
    }

    try {
      const { data, error } = await window.supabaseClient
        .from("exams")
        .select("id, code, title, description, duration_minutes, grade_level, is_published, exam_data, created_at")
        .eq("is_published", true)
        .order("created_at", { ascending: false });
      if (error) throw error;

      state.examCatalog = (data || []).map(normalizeExamRow);
      if (!state.examCatalog.some((exam) => exam.id === state.selectedExamId)) {
        state.selectedExamId = state.examCatalog[0]?.id || null;
      }
      renderExamCatalog();
      updateSelectedExamSummary();
    } catch (error) {
      console.error("Không tải được kho đề:", error);
      status.textContent = `Không tải được kho đề: ${error.message || "Lỗi không xác định"}`;
      renderExamCatalog();
    }
  }

  function normalizeExamRow(row) {
    const examData = row.exam_data && typeof row.exam_data === "object" ? row.exam_data : createEmptyExamData();
    return {
      id: row.id,
      code: row.code,
      title: row.title,
      description: row.description || "",
      durationMinutes: Number(row.duration_minutes || 50),
      gradeLevel: row.grade_level || "THPT",
      isPublished: Boolean(row.is_published),
      createdAt: row.created_at,
      data: {
        passages: Array.isArray(examData.passages) ? examData.passages : [],
        mcq: Array.isArray(examData.mcq) ? examData.mcq : [],
        trueFalse: Array.isArray(examData.trueFalse) ? examData.trueFalse : [],
        shortAnswer: Array.isArray(examData.shortAnswer) ? examData.shortAnswer : []
      }
    };
  }

  function renderExamCatalog() {
    const catalog = $("#exam-catalog");
    const status = $("#exam-catalog-status");
    if (!state.examCatalog.length) {
      catalog.innerHTML = "";
      status.textContent = "Chưa có đề nào được xuất bản. Giáo viên hãy đăng nhập và mở mục Quản lý đề.";
      return;
    }

    status.textContent = `${state.examCatalog.length} đề đang mở cho học sinh.`;
    catalog.innerHTML = state.examCatalog.map((exam) => {
      const counts = getExamCounts(exam.data);
      const selected = exam.id === state.selectedExamId;
      return `
        <button class="exam-catalog-card ${selected ? "selected" : ""}" type="button" data-select-exam="${exam.id}">
          <span class="catalog-card-top"><strong>${escapeHtml(exam.code)}</strong><i>${exam.durationMinutes} phút</i></span>
          <h3>${escapeHtml(exam.title)}</h3>
          <p>${escapeHtml(exam.description || "Đề luyện Vật lí THPT theo cấu trúc mới.")}</p>
          <span class="catalog-counts">
            <i>${counts.mcq} lựa chọn</i><i>${counts.tf} Đúng/Sai</i><i>${counts.short} trả lời ngắn</i>
          </span>
          <span class="catalog-select-label">${selected ? "Đã chọn đề này" : "Chọn đề"}</span>
        </button>
      `;
    }).join("");

    $$('[data-select-exam]').forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedExamId = button.dataset.selectExam;
        renderExamCatalog();
        updateSelectedExamSummary();
      });
    });
  }

  function updateSelectedExamSummary() {
    const exam = state.examCatalog.find((item) => item.id === state.selectedExamId);
    const button = $("#start-exam-submit");
    if (!exam) {
      $("#selected-exam-code").textContent = "CHỌN MỘT ĐỀ ĐỂ BẮT ĐẦU";
      $("#selected-exam-title").textContent = "Kho đề luyện Vật lí THPT";
      $("#selected-exam-duration").textContent = "--";
      $("#selected-exam-count").textContent = "--";
      button.disabled = true;
      return;
    }

    const counts = getExamCounts(exam.data);
    $("#selected-exam-code").textContent = exam.code;
    $("#selected-exam-title").textContent = exam.title;
    $("#selected-exam-duration").textContent = exam.durationMinutes;
    $("#selected-exam-count").textContent = counts.total;
    button.disabled = false;
  }

  function switchStudentAuthMode(mode) {
    const selectedMode = mode === "register" ? "register" : "login";
    $$('[data-student-auth-tab]').forEach((button) => {
      const active = button.dataset.studentAuthTab === selectedMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    $$('[data-student-auth-panel]').forEach((panel) => {
      const active = panel.dataset.studentAuthPanel === selectedMode;
      panel.classList.toggle("active", active);
      panel.hidden = !active;
    });
    $("#student-auth-title").textContent = selectedMode === "register" ? "Tạo tài khoản học sinh" : "Đăng nhập tài khoản";
    $("#student-login-error").textContent = "";
    $("#student-register-message").textContent = "";
    $$('[data-toggle-password]').forEach((button) => {
      const input = document.getElementById(button.dataset.togglePassword);
      if (input) input.type = "password";
      button.textContent = "Hiện";
      button.setAttribute("aria-label", "Hiện mật khẩu");
    });
  }

  function toggleStudentPassword(button) {
    const input = document.getElementById(button.dataset.togglePassword);
    if (!input) return;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    button.textContent = show ? "Ẩn" : "Hiện";
    button.setAttribute("aria-label", show ? "Ẩn mật khẩu" : "Hiện mật khẩu");
    input.focus();
  }

  function setButtonLoading(button, loading, loadingText, normalText) {
    if (!button) return;
    button.disabled = loading;
    const textElement = button.querySelector("span");
    if (textElement) textElement.textContent = loading ? loadingText : normalText;
    else button.textContent = loading ? loadingText : normalText;
  }

  async function isCurrentUserTeacher() {
    if (!window.supabaseClient) return false;
    const { data, error } = await window.supabaseClient.rpc("is_exam_teacher");
    if (error) {
      console.error("Không kiểm tra được quyền giáo viên:", error);
      return false;
    }
    return data === true;
  }

  async function loadStudentProfile(user) {
    const { data, error } = await window.supabaseClient
      .from("student_profiles")
      .select("user_id, full_name, class_name, created_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;

    if (data) {
      return {
        userId: data.user_id,
        fullName: data.full_name,
        className: data.class_name,
        email: user.email || ""
      };
    }

    const fullName = String(user.user_metadata?.full_name || "").trim();
    const className = String(user.user_metadata?.class_name || "").trim().toUpperCase();
    if (!fullName || !className) {
      throw new Error("Tài khoản chưa có hồ sơ học sinh. Hãy tạo lại tài khoản hoặc liên hệ giáo viên.");
    }

    const { data: inserted, error: insertError } = await window.supabaseClient
      .from("student_profiles")
      .upsert({ user_id: user.id, full_name: fullName, class_name: className }, { onConflict: "user_id" })
      .select("user_id, full_name, class_name")
      .single();
    if (insertError) throw insertError;
    return {
      userId: inserted.user_id,
      fullName: inserted.full_name,
      className: inserted.class_name,
      email: user.email || ""
    };
  }

  async function activateStudentSession(user) {
    state.studentUser = user;
    state.teacherUser = null;
    state.studentProfile = await loadStudentProfile(user);
    updateStudentUi();
    updateTeacherUi();
    showScreen("home");
    await loadPublishedExams();
  }

  async function restoreCurrentSession() {
    if (!window.supabaseClient) {
      showStudentAuthScreen("Supabase chưa được kết nối.");
      return;
    }

    const { data, error } = await window.supabaseClient.auth.getUser();
    if (error || !data?.user) {
      showStudentAuthScreen();
      return;
    }

    if (await isCurrentUserTeacher()) {
      state.teacherUser = data.user;
      state.studentUser = null;
      state.studentProfile = null;
      updateStudentUi();
      updateTeacherUi();
      showTeacherPanel("results");
      await loadTeacherDashboard(true);
      return;
    }

    try {
      await activateStudentSession(data.user);
    } catch (profileError) {
      console.error("Không tải được hồ sơ học sinh:", profileError);
      await window.supabaseClient.auth.signOut();
      showStudentAuthScreen(profileError.message);
    }
  }

  function showStudentAuthScreen(message = "") {
    state.studentUser = null;
    state.studentProfile = null;
    state.teacherUser = null;
    state.examCatalog = [];
    state.selectedExamId = null;
    updateStudentUi();
    updateTeacherUi();
    state.screen = "student-auth";
    $$(".screen").forEach((screen) => screen.classList.remove("active"));
    $("#student-auth-screen")?.classList.add("active");
    if (message) $("#student-login-error").textContent = message;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateStudentUi() {
    const loggedIn = Boolean(state.studentUser && state.studentProfile);
    const profile = state.studentProfile;
    const homeButton = $("#student-home-button");
    const navAccount = $("#student-nav-account");
    const logoutButton = $("#student-logout-button");
    if (homeButton) homeButton.hidden = !loggedIn;
    if (navAccount) navAccount.hidden = !loggedIn;
    if (logoutButton) logoutButton.hidden = !loggedIn;
    if (!loggedIn) return;

    const initials = profile.fullName
      .split(/\s+/)
      .filter(Boolean)
      .slice(-2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "HS";
    $("#student-nav-avatar").textContent = initials;
    $("#student-nav-name").textContent = profile.fullName;
    $("#student-nav-class").textContent = `Lớp ${profile.className}`;
    $("#student-current-avatar").textContent = initials;
    $("#student-current-name").textContent = profile.fullName;
    $("#student-current-meta").textContent = `Lớp ${profile.className} · ${profile.email}`;
  }

  async function handleStudentLogin(event) {
    event.preventDefault();
    if (!window.supabaseClient) return;
    const email = $("#student-login-email").value.trim();
    const password = $("#student-login-password").value;
    const errorElement = $("#student-login-error");
    const button = $("#student-login-submit");
    errorElement.textContent = "";
    setButtonLoading(button, true, "Đang đăng nhập...", "Đăng nhập và chọn đề");

    try {
      const { data, error } = await window.supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (await isCurrentUserTeacher()) {
        await window.supabaseClient.auth.signOut();
        throw new Error("Đây là tài khoản giáo viên. Hãy dùng nút “Tôi là giáo viên”.");
      }
      await activateStudentSession(data.user);
      $("#student-login-form").reset();
      showToast("Đăng nhập học sinh thành công.");
    } catch (loginError) {
      console.error("Lỗi đăng nhập học sinh:", loginError);
      errorElement.textContent = loginError.message === "Invalid login credentials"
        ? "Email hoặc mật khẩu không chính xác."
        : (loginError.message || "Không thể đăng nhập. Vui lòng thử lại.");
    } finally {
      setButtonLoading(button, false, "Đang đăng nhập...", "Đăng nhập và chọn đề");
    }
  }

  async function handleStudentRegister(event) {
    event.preventDefault();
    if (!window.supabaseClient) return;
    const fullName = $("#student-register-name").value.trim();
    const className = $("#student-register-class").value.trim().toUpperCase();
    const email = $("#student-register-email").value.trim();
    const password = $("#student-register-password").value;
    const confirmPassword = $("#student-register-confirm-password").value;
    const messageElement = $("#student-register-message");
    const button = $("#student-register-submit");

    messageElement.className = "student-auth-message";
    messageElement.textContent = "";
    if (fullName.length < 2 || !className) {
      messageElement.classList.add("error");
      messageElement.textContent = "Vui lòng nhập đúng họ tên và lớp.";
      return;
    }
    if (password.length < 6) {
      messageElement.classList.add("error");
      messageElement.textContent = "Mật khẩu cần có ít nhất 6 ký tự.";
      return;
    }
    if (password !== confirmPassword) {
      messageElement.classList.add("error");
      messageElement.textContent = "Hai lần nhập mật khẩu chưa khớp.";
      return;
    }

    setButtonLoading(button, true, "Đang tạo tài khoản...", "Tạo tài khoản học sinh");
    try {
      const { data, error } = await window.supabaseClient.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName, class_name: className, role: "student" },
          emailRedirectTo: window.location.origin
        }
      });
      if (error) throw error;

      if (data.session && data.user) {
        await activateStudentSession(data.user);
        $("#student-register-form").reset();
        showToast("Tạo tài khoản và đăng nhập thành công.");
      } else {
        messageElement.classList.add("success");
        messageElement.textContent = "Tài khoản đã được tạo. Hãy mở email để xác nhận, sau đó quay lại đăng nhập.";
        $("#student-register-form").reset();
        window.setTimeout(() => switchStudentAuthMode("login"), 3500);
      }
    } catch (registerError) {
      console.error("Lỗi tạo tài khoản học sinh:", registerError);
      messageElement.classList.add("error");
      messageElement.textContent = registerError.message || "Không thể tạo tài khoản. Vui lòng thử lại.";
    } finally {
      setButtonLoading(button, false, "Đang tạo tài khoản...", "Tạo tài khoản học sinh");
    }
  }

  async function handleStudentLogout() {
    if (state.screen === "exam" && !state.submitted) {
      if (!window.confirm("Bài làm đang diễn ra. Đăng xuất sẽ kết thúc bài đang làm. Bạn có chắc không?")) return;
      stopTimer();
    }
    if (window.supabaseClient) await window.supabaseClient.auth.signOut();
    showStudentAuthScreen();
    showToast("Đã đăng xuất tài khoản học sinh.");
  }

  function updateTeacherUi() {
    const teacherButton = $("#teacher-dashboard-button");
    if (teacherButton) teacherButton.textContent = state.teacherUser ? "Khu vực giáo viên" : "Giáo viên";

    const dashboardStatus = $("#dashboard-status");
    if (dashboardStatus) {
      dashboardStatus.textContent = state.teacherUser
        ? `Đang đăng nhập: ${state.teacherUser.email}. Dữ liệu được đồng bộ từ Supabase.`
        : "Dữ liệu được đồng bộ từ Supabase và chỉ tài khoản giáo viên được xem.";
    }
  }

  async function openTeacherAccess() {
    if (state.screen === "exam" && !state.submitted) {
      const shouldLeave = window.confirm("Bài làm đang diễn ra. Bạn có chắc muốn rời khỏi đề thi để mở trang giáo viên?");
      if (!shouldLeave) return;
      stopTimer();
    }

    if (state.teacherUser) {
      showTeacherPanel("results");
      await loadTeacherDashboard(true);
      return;
    }

    if (state.studentUser) {
      const shouldSwitch = window.confirm("Bạn đang đăng nhập tài khoản học sinh. Hệ thống sẽ đăng xuất học sinh để chuyển sang giáo viên. Tiếp tục?");
      if (!shouldSwitch) return;
      await window.supabaseClient.auth.signOut();
      state.studentUser = null;
      state.studentProfile = null;
      showStudentAuthScreen();
    }
    openTeacherLoginModal();
  }

  function openTeacherLoginModal() {
    const modal = $("#teacher-login-modal");
    if (!modal) return;
    setTeacherLoginMessage("");
    resetTeacherPasswordVisibility();
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    window.setTimeout(() => {
      const emailInput = $("#teacher-email");
      const passwordInput = $("#teacher-password");
      if (emailInput?.value.trim()) passwordInput?.focus();
      else emailInput?.focus();
    }, 50);
  }

  function closeTeacherLoginModal() {
    const modal = $("#teacher-login-modal");
    if (!modal) return;
    $("#teacher-password").value = "";
    setTeacherLoginMessage("");
    resetTeacherPasswordVisibility();
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  }

  function toggleTeacherPassword() {
    const passwordInput = $("#teacher-password");
    const toggleButton = $("#toggle-teacher-password");
    if (!passwordInput || !toggleButton) return;
    const willShowPassword = passwordInput.type === "password";
    passwordInput.type = willShowPassword ? "text" : "password";
    toggleButton.classList.toggle("is-visible", willShowPassword);
    toggleButton.setAttribute("aria-pressed", String(willShowPassword));
    toggleButton.setAttribute("aria-label", willShowPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu");
    toggleButton.setAttribute("title", willShowPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu");
    passwordInput.focus();
  }

  function resetTeacherPasswordVisibility() {
    const passwordInput = $("#teacher-password");
    const toggleButton = $("#toggle-teacher-password");
    if (passwordInput) passwordInput.type = "password";
    if (toggleButton) {
      toggleButton.classList.remove("is-visible");
      toggleButton.setAttribute("aria-pressed", "false");
      toggleButton.setAttribute("aria-label", "Hiện mật khẩu");
      toggleButton.setAttribute("title", "Hiện mật khẩu");
    }
  }

  function setTeacherLoginMessage(message, type = "error") {
    const element = $("#teacher-login-error");
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("success", type === "success");
  }

  function getTeacherLoginErrorMessage(error) {
    const message = String(error?.message || "").toLowerCase();
    if (error?.code === "not_teacher") {
      return "Tài khoản đăng nhập được nhưng chưa có quyền giáo viên.";
    }
    if (message.includes("invalid login credentials")) {
      return "Mật khẩu không đúng hoặc tài khoản chưa được đặt mật khẩu. Hãy dùng liên kết đăng nhập qua email bên dưới.";
    }
    if (message.includes("email not confirmed")) {
      return "Email chưa được xác nhận. Hãy mở email Supabase đã gửi rồi thử lại.";
    }
    if (message.includes("rate limit") || message.includes("too many requests")) {
      return "Bạn đã thử quá nhiều lần. Hãy chờ một lúc rồi thử lại.";
    }
    return error?.message || "Không thể đăng nhập. Vui lòng thử lại.";
  }

  async function handleTeacherLogin(event) {
    event.preventDefault();
    if (!window.supabaseClient) {
      setTeacherLoginMessage("Supabase chưa được khởi tạo.");
      return;
    }

    const email = $("#teacher-email").value.trim().toLowerCase();
    const password = $("#teacher-password").value;
    const submitButton = $("#teacher-login-submit");

    setTeacherLoginMessage("");
    submitButton.disabled = true;
    submitButton.classList.add("is-loading");
    submitButton.querySelector("span").textContent = "Đang đăng nhập...";

    try {
      const { data, error } = await window.supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!(await isCurrentUserTeacher())) {
        await window.supabaseClient.auth.signOut();
        const permissionError = new Error("Tài khoản này không có quyền giáo viên.");
        permissionError.code = "not_teacher";
        throw permissionError;
      }
      state.teacherUser = data.user;
      state.studentUser = null;
      state.studentProfile = null;
      updateStudentUi();
      updateTeacherUi();
      closeTeacherLoginModal();
      showTeacherPanel("results");
      await loadTeacherDashboard(true);
      showToast("Đăng nhập giáo viên thành công.");
    } catch (error) {
      console.error("Lỗi đăng nhập giáo viên:", error);
      setTeacherLoginMessage(getTeacherLoginErrorMessage(error));
    } finally {
      submitButton.disabled = false;
      submitButton.classList.remove("is-loading");
      submitButton.querySelector("span").textContent = "Đăng nhập";
    }
  }

  async function handleTeacherMagicLink() {
    if (!window.supabaseClient) {
      setTeacherLoginMessage("Supabase chưa được khởi tạo.");
      return;
    }

    const emailInput = $("#teacher-email");
    const email = emailInput?.value.trim().toLowerCase() || "";
    const button = $("#teacher-magic-link-button");

    if (!email) {
      setTeacherLoginMessage("Hãy nhập email giáo viên trước.");
      emailInput?.focus();
      return;
    }

    setTeacherLoginMessage("");
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = "Đang gửi liên kết...";

    try {
      const redirectUrl = `${window.location.origin}${window.location.pathname}`;
      const { error } = await window.supabaseClient.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: redirectUrl
        }
      });
      if (error) throw error;
      setTeacherLoginMessage(
        "Đã gửi liên kết đăng nhập. Mở email trên cùng thiết bị, bấm liên kết rồi website sẽ tự vào trang giáo viên.",
        "success"
      );
    } catch (error) {
      console.error("Không gửi được liên kết đăng nhập giáo viên:", error);
      const message = String(error?.message || "").toLowerCase();
      setTeacherLoginMessage(
        message.includes("rate limit") || message.includes("too many requests")
          ? "Supabase đang giới hạn gửi email. Hãy chờ một lúc rồi thử lại."
          : (error?.message || "Không gửi được liên kết đăng nhập.")
      );
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  async function handleTeacherLogout() {
    if (!window.supabaseClient) return;
    const { error } = await window.supabaseClient.auth.signOut();
    if (error) {
      showToast(`Không thể đăng xuất: ${error.message}`);
      return;
    }
    state.teacherUser = null;
    state.dashboardResults = [];
    state.teacherExams = [];
    state.examDraft = null;
    updateTeacherUi();
    renderDashboard([]);
    showStudentAuthScreen();
    showToast("Đã đăng xuất tài khoản giáo viên.");
  }

  function showScreen(screenName) {
    if (screenName === "dashboard" && !state.teacherUser) {
      openTeacherLoginModal();
      return;
    }
    if (["home", "exam", "result"].includes(screenName) && !state.studentUser) {
      showStudentAuthScreen();
      return;
    }
    state.screen = screenName;
    $$(".screen").forEach((screen) => screen.classList.remove("active"));
    $(`#${screenName}-screen`)?.classList.add("active");
    $$(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.screen === screenName));
    $("#teacher-dashboard-button")?.classList.toggle("active", screenName === "dashboard");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startExam(name, className, exam) {
    if (!state.studentUser || !state.studentProfile) {
      showStudentAuthScreen("Vui lòng đăng nhập tài khoản học sinh trước khi làm đề.");
      return;
    }

    stopTimer();
    stopQuestionObserver();
    clearAutosaveTimer();

    state.candidate = { name, className };
    state.activeExam = exam;
    state.items = buildExamItems(exam.data);
    state.currentIndex = 0;
    state.secondsLeft = exam.durationMinutes * 60;
    state.startedAt = Date.now();
    state.submitted = false;
    state.answers = createEmptyAnswers();
    state.reviewFlags = new Set();
    state.latestResult = null;

    restoreExamDraftIfAvailable(exam);

    $("#active-exam-code").textContent = exam.code;
    $("#active-exam-title").textContent = exam.title;
    $("#candidate-line").textContent = `${name} · Lớp ${className}`;
    $("#result-duration-limit").textContent = `trên ${exam.durationMinutes} phút`;

    renderFullExam();
    renderQuestionNavigation();
    updateTimerDisplay();
    updateProgress();
    showScreen("exam");
    startQuestionObserver();
    startTimer();
    scheduleAutosave();

    if (state.secondsLeft <= 0) submitExam(true);
  }

  function buildExamItems(data) {
    return [
      ...(data.mcq || []).map((question, index) => ({ type: "mcq", part: 1, number: index + 1, question })),
      ...(data.trueFalse || []).map((question, index) => ({ type: "tf", part: 2, number: index + 1, question })),
      ...(data.shortAnswer || []).map((question, index) => ({ type: "short", part: 3, number: index + 1, question }))
    ];
  }

  function startTimer() {
    stopTimer();
    state.timerId = window.setInterval(() => {
      state.secondsLeft -= 1;
      updateTimerDisplay();
      if (state.secondsLeft > 0 && state.secondsLeft % 10 === 0) saveExamDraft();
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
    timerCard?.classList.toggle("warning", state.secondsLeft <= 600 && state.secondsLeft > 300);
    timerCard?.classList.toggle("danger", state.secondsLeft <= 300);
  }

  function renderFullExam() {
    destroyPhysicsCharts();
    const container = $("#question-content");
    if (!container) return;
    if (!state.items.length) {
      container.innerHTML = `<div class="empty-state"><strong>Đề chưa có câu hỏi</strong></div>`;
      return;
    const renderedVisuals = new Set();
    }

    const groups = [
      {
        part: 1,
        title: "PHẦN I",
        subtitle: "Câu trắc nghiệm nhiều phương án lựa chọn",
        description: "Mỗi câu chỉ chọn một phương án đúng."
      },
      {
        part: 2,
        title: "PHẦN II",
        subtitle: "Câu trắc nghiệm Đúng/Sai",
        description: "Mỗi câu gồm bốn nhận định a), b), c), d)."
      },
      {
        part: 3,
        title: "PHẦN III",
        subtitle: "Câu trắc nghiệm trả lời ngắn",
        description: "Nhập kết quả cuối cùng, không nhập đơn vị vào ô trả lời."
      }
    ];

    container.innerHTML = groups.map((group) => {
      const items = state.items.filter((item) => item.part === group.part);
      if (!items.length) return "";
      return `
        <section class="exam-part-section" data-exam-part="${group.part}">
          <header class="exam-part-heading">
            <div>
              <span>${group.title}</span>
              <h2>${group.subtitle}</h2>
              <p>${group.description}</p>
            </div>
            <strong>${items.length} câu</strong>
          </header>
          <div class="exam-question-list">
            ${renderQuestionGroupWithPassages(
  items,
  renderedVisuals}
          </div>
        </section>`;
    }).join("");

    bindFullExamInputs();
    window.requestAnimationFrame(() => {
      renderPhysicsCharts();
      renderMathContent(container);
    });
  }

  function renderQuestionGroupWithPassages(items) {
    const renderedPassages = new Set();
    return items.map((item) => {
      const globalIndex = state.items.indexOf(item);
      const passageId = String(item.question?.passageId || "").trim();
      let passageHtml = "";
      if (passageId && !renderedPassages.has(passageId)) {
        const passage = (state.activeExam?.data?.passages || []).find((entry) => String(entry.id) === passageId);
        if (passage) {
          renderedPassages.add(passageId);
          passageHtml = renderSharedPassage(passage);
        }
      }
      return `${passageHtml}${renderFullQuestion(item, globalIndex)}`;
    }).join("");
  }

  function renderSharedPassage(passage) {
    const imageUrl = passage?.imageUrl || passage?.image_url || passage?.figureUrl || "";
    const ownerKey = `passage-${String(passage.id || "")}`;
    return `
      <aside id="passage-${escapeHtml(String(passage.id || ""))}" class="shared-passage-block">
        <div class="shared-passage-heading">
          <span>DỮ KIỆN DÙNG CHUNG</span>
          <strong>${escapeHtml(passage.title || "Đọc đoạn dữ kiện sau")}</strong>
        </div>
        <div class="shared-passage-content">${renderRichContent(passage.content)}</div>
        ${renderPhysicsVisuals(passage.visuals, ownerKey)}
        ${imageUrl ? `<figure class="question-media"><img src="${escapeHtml(String(imageUrl))}" alt="Hình minh họa cho đoạn dữ kiện" loading="lazy" /></figure>` : ""}
      </aside>`;
  }

  function renderQuestionContext(question) {
    const context = String(question?.context || "").trim();
    return context ? `<div class="question-context question-own-context">${renderRichContent(context)}</div>` : "";
  }

  function renderFullQuestion(item, globalIndex) {
    const status = getItemStatus(item);
    const marked = state.reviewFlags.has(globalIndex);
    const question = item.question || {};
    return `
      <article id="question-${globalIndex}" class="exam-question-card ${status} ${marked ? "marked" : ""}" data-question-card data-question-index="${globalIndex}">
        <div class="question-card-header">
          <div>
            <span class="question-number-badge">Câu ${item.number}</span>
            <span class="question-topic">${escapeHtml(question.topic || "Vật lí")}</span>
          </div>
          <button class="review-flag-button ${marked ? "active" : ""}" type="button" data-review-index="${globalIndex}" aria-pressed="${marked}">
            <span aria-hidden="true">${marked ? "★" : "☆"}</span>
            ${marked ? "Đã đánh dấu" : "Đánh dấu xem lại"}
          </button>
        </div>
        ${item.type === "mcq" ? renderFullMcq(item, globalIndex) : ""}
        ${item.type === "tf" ? renderFullTrueFalse(item, globalIndex) : ""}
        ${item.type === "short" ? renderFullShortAnswer(item, globalIndex) : ""}
      </article>`;
  }

  function renderPhysicsTable(table) {
    if (!table || typeof table !== "object") return "";

    const headers = Array.isArray(table.headers) ? table.headers.map((item) => String(item ?? "")) : [];
    const rows = Array.isArray(table.rows) ? table.rows.filter(Array.isArray) : [];
    if (headers.length < 2 || rows.length === 0) return "";

    const caption = String(table.caption || table.title || "").trim();
    const columnCount = headers.length;
    const normalizedRows = rows.map((row) => {
      const cells = row.slice(0, columnCount).map((item) => String(item ?? ""));
      while (cells.length < columnCount) cells.push("");
      return cells;
    });

    return `
      <section class="physics-table-block">
        ${caption ? `
          <div class="physics-visual-heading">
            <span>BẢNG SỐ LIỆU</span>
            <strong>${escapeHtml(caption)}</strong>
          </div>` : ""}
        <div class="physics-table-scroll" tabindex="0" aria-label="Bảng số liệu có thể cuộn ngang">
          <table class="physics-data-table">
            <thead>
              <tr>${headers.map((header) => `<th scope="col">${renderLongText(header)}</th>`).join("")}</tr>
            </thead>
            <tbody>
              ${normalizedRows.map((row) => `
                <tr>
                  ${row.map((cell, cellIndex) => cellIndex === 0
                    ? `<th scope="row">${renderLongText(cell)}</th>`
                    : `<td>${renderLongText(cell)}</td>`).join("")}
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </section>`;
  }

  function renderPhysicsChartPlaceholder(chart, ownerKey, index) {
    if (!chart || typeof chart !== "object") return "";

    const chartId = `physics-chart-${ownerKey}-${index}`.replace(/[^a-zA-Z0-9-_]/g, "-");
    let encodedConfig = "";
    try {
      encodedConfig = encodeURIComponent(JSON.stringify(chart));
    } catch (error) {
      console.error("Không mã hóa được dữ liệu đồ thị:", error);
      return "";
    }

    return `
      <section class="physics-chart-block">
        <div class="physics-visual-heading">
          <span>ĐỒ THỊ</span>
          <strong>${escapeHtml(String(chart.title || "Đồ thị Vật lí"))}</strong>
        </div>
        <div class="physics-chart-container">
          <canvas id="${chartId}" data-physics-chart="${escapeHtml(encodedConfig)}" role="img" aria-label="${escapeHtml(String(chart.title || "Đồ thị Vật lí"))}"></canvas>
        </div>
      </section>`;
  }

  function renderPhysicsVisuals(
  visuals,
  ownerKey,
  renderedVisuals = new Set()
) {
  if (!Array.isArray(visuals)) {
    return "";
  }

  return visuals
    .map((visual, index) => {
      const type = String(
        visual?.type || ""
      ).toLowerCase();

      const signature = getVisualSignature(visual);

      if (signature && renderedVisuals.has(signature)) {
        return "";
      }

      if (signature) {
        renderedVisuals.add(signature);
      }

      if (type === "table") {
        return renderPhysicsTable(visual);
      }

      if (type === "chart") {
        return renderPhysicsChartPlaceholder(
          visual,
          ownerKey,
          index
        );
      }

      return "";
    })
    .join("");
}

  function renderPhysicsCharts() {
    destroyPhysicsCharts();
    const canvases = $$('[data-physics-chart]');
    if (!canvases.length) return;

    if (!window.Chart) {
      console.error("Chart.js chưa được tải. Bảng vẫn hoạt động nhưng đồ thị chưa thể hiển thị.");
      return;
    }

    const palette = [
      { border: "#1d4ed8", background: "rgba(29, 78, 216, 0.14)" },
      { border: "#dc2626", background: "rgba(220, 38, 38, 0.12)" },
      { border: "#059669", background: "rgba(5, 150, 105, 0.12)" },
      { border: "#d97706", background: "rgba(217, 119, 6, 0.12)" }
    ];

    canvases.forEach((canvas) => {
      let chart;
      try {
        chart = JSON.parse(decodeURIComponent(canvas.dataset.physicsChart || ""));
      } catch (error) {
        console.error("Dữ liệu đồ thị không hợp lệ:", error);
        return;
      }

      const requestedType = String(chart.chartType || chart.type || "line").toLowerCase();
      const chartType = requestedType === "coordinate" || requestedType === "piecewise"
        ? "line"
        : (["line", "bar", "scatter"].includes(requestedType) ? requestedType : "line");
      const rawDatasets = Array.isArray(chart.datasets) ? chart.datasets : [];
      const usesPointObjects = rawDatasets.some((dataset) => {
        const source = Array.isArray(dataset?.data) ? dataset.data : (Array.isArray(dataset?.points) ? dataset.points : []);
        return source.some((point) => point && typeof point === "object" && "x" in point && "y" in point);
      });

      const datasets = rawDatasets.map((dataset, datasetIndex) => {
        const paletteItem = palette[datasetIndex % palette.length];
        const source = Array.isArray(dataset?.data) ? dataset.data : (Array.isArray(dataset?.points) ? dataset.points : []);
        const data = usesPointObjects || chartType === "scatter"
          ? source.map((point) => ({ x: Number(point?.x), y: Number(point?.y) }))
              .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
          : source.map((value) => {
              const numberValue = Number(value);
              return Number.isFinite(numberValue) ? numberValue : null;
            });

        return {
          label: String(dataset?.label || `Dữ liệu ${datasetIndex + 1}`),
          data,
          borderColor: paletteItem.border,
          backgroundColor: paletteItem.background,
          borderWidth: 2.5,
          pointRadius: chartType === "bar" ? 0 : 4,
          pointHoverRadius: 6,
          tension: requestedType === "piecewise" ? 0 : 0.2,
          fill: Boolean(dataset?.fill),
          showLine: chartType !== "scatter" || Boolean(dataset?.showLine)
        };
      });

      const instance = new window.Chart(canvas, {
        type: chartType,
        data: {
          labels: usesPointObjects || chartType === "scatter"
            ? undefined
            : (Array.isArray(chart.labels) ? chart.labels.map(String) : []),
          datasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 450 },
          interaction: { intersect: false, mode: "nearest" },
          plugins: {
            legend: { display: datasets.length > 1 || datasets.some((dataset) => !dataset.label.startsWith("Dữ liệu")), position: "bottom" },
            tooltip: { enabled: true }
          },
          scales: {
            x: {
              type: usesPointObjects || chartType === "scatter" ? "linear" : "category",
              title: { display: Boolean(chart.xLabel), text: String(chart.xLabel || "") },
              grid: { color: "rgba(148, 163, 184, 0.18)" },
              ticks: { color: "#475569" }
            },
            y: {
              beginAtZero: Boolean(chart.beginAtZero),
              title: { display: Boolean(chart.yLabel), text: String(chart.yLabel || "") },
              grid: { color: "rgba(148, 163, 184, 0.22)" },
              ticks: { color: "#475569" }
            }
          }
        }
      });

      physicsChartInstances.push(instance);
    });
  }

  function renderQuestionMedia(question) {
    const imageUrl = question?.imageUrl || question?.image_url || question?.figureUrl || question?.mediaUrl || "";
    if (!imageUrl) return "";
    return `
      <figure class="question-media">
        <img src="${escapeHtml(String(imageUrl))}" alt="Hình minh họa cho câu hỏi" loading="lazy" />
        ${question.imageCaption ? `<figcaption>${escapeHtml(question.imageCaption)}</figcaption>` : ""}
      </figure>`;
  }

  function renderFullMcq(item, globalIndex) {
    const selected = state.answers.mcq[item.question.id];
    return `
      <div class="question-body">
        ${renderQuestionContext(item.question)}
        <div class="question-stem">${renderRichContent(item.question.stem)}</div>
        ${renderPhysicsVisuals(item.question.visuals, `question-${globalIndex}`)}
        ${renderQuestionMedia(item.question)}
        <div class="option-list">
          ${(item.question.options || []).map((option, index) => `
            <button class="option-button ${selected === index ? "selected" : ""}" type="button" data-mcq-index="${globalIndex}" data-mcq-option="${index}" aria-pressed="${selected === index}">
              <span class="option-letter">${String.fromCharCode(65 + index)}</span>
              <span class="option-text">${renderLongText(cleanupOptionText(option, index))}</span>
            </button>
          `).join("")}
        </div>
      </div>`;
  }

  function renderFullTrueFalse(item, globalIndex) {
    const selected = state.answers.tf[item.question.id] || {};
    return `
      <div class="question-body">
        ${renderQuestionContext(item.question)}
        ${renderPhysicsVisuals(item.question.visuals, `question-${globalIndex}`)}
        ${renderQuestionMedia(item.question)}
        <div class="tf-list">
          ${(item.question.statements || []).map((statement, index) => `
            <div class="tf-row" data-tf-row="${index}">
              <span class="tf-label">${String.fromCharCode(97 + index)})</span>
              <span class="tf-text">${renderLongText(cleanupInlineDisplayText(statement.text))}</span>
              <button class="tf-choice true ${selected[index] === true ? "selected" : ""}" type="button" data-tf-question-index="${globalIndex}" data-tf-index="${index}" data-tf-value="true" aria-pressed="${selected[index] === true}">Đúng</button>
              <button class="tf-choice false ${selected[index] === false ? "selected" : ""}" type="button" data-tf-question-index="${globalIndex}" data-tf-index="${index}" data-tf-value="false" aria-pressed="${selected[index] === false}">Sai</button>
            </div>`).join("")}
        </div>
      </div>`;
  }

  function renderFullShortAnswer(item, globalIndex) {
    const value = state.answers.short[item.question.id] ?? "";
    return `
      <div class="question-body">
        ${renderQuestionContext(item.question)}
        <div class="question-stem">${renderRichContent(item.question.stem)}</div>
        ${renderPhysicsVisuals(item.question.visuals, `question-${globalIndex}`)}
        ${renderQuestionMedia(item.question)}
        <div class="short-answer-box">
          <label for="short-answer-${globalIndex}">Nhập kết quả cuối cùng</label>
          <div class="short-answer-row">
            <input id="short-answer-${globalIndex}" data-short-index="${globalIndex}" inputmode="decimal" autocomplete="off" value="${escapeHtml(String(value))}" placeholder="Nhập một số" />
            <span class="unit-badge">${escapeHtml(item.question.unit || "")}</span>
          </div>
          <p class="answer-note">Có thể dùng dấu phẩy hoặc dấu chấm cho phần thập phân. Không nhập đơn vị vào ô trả lời.</p>
        </div>
      </div>`;
  }

  function bindFullExamInputs() {
    $$('[data-mcq-index]').forEach((button) => {
      button.addEventListener("click", () => {
        const itemIndex = Number(button.dataset.mcqIndex);
        const item = state.items[itemIndex];
        if (!item) return;
        state.answers.mcq[item.question.id] = Number(button.dataset.mcqOption);
        const card = $(`#question-${itemIndex}`);
        card?.querySelectorAll('[data-mcq-index]').forEach((candidate) => {
          const selected = candidate === button;
          candidate.classList.toggle("selected", selected);
          candidate.setAttribute("aria-pressed", String(selected));
        });
        handleAnswerChange(itemIndex);
      });
    });

    $$('[data-tf-question-index]').forEach((button) => {
      button.addEventListener("click", () => {
        const itemIndex = Number(button.dataset.tfQuestionIndex);
        const statementIndex = Number(button.dataset.tfIndex);
        const item = state.items[itemIndex];
        if (!item) return;
        const questionAnswers = state.answers.tf[item.question.id] || {};
        questionAnswers[statementIndex] = button.dataset.tfValue === "true";
        state.answers.tf[item.question.id] = questionAnswers;
        const row = button.closest("[data-tf-row]");
        row?.querySelectorAll(".tf-choice").forEach((candidate) => {
          const selected = candidate === button;
          candidate.classList.toggle("selected", selected);
          candidate.setAttribute("aria-pressed", String(selected));
        });
        handleAnswerChange(itemIndex);
      });
    });

    $$('[data-short-index]').forEach((input) => {
      input.addEventListener("input", () => {
        const itemIndex = Number(input.dataset.shortIndex);
        const item = state.items[itemIndex];
        if (!item) return;
        state.answers.short[item.question.id] = input.value.trim();
        handleAnswerChange(itemIndex, false);
      });
      input.addEventListener("change", () => saveExamDraft());
    });

    $$('[data-review-index]').forEach((button) => {
      button.addEventListener("click", () => {
        const itemIndex = Number(button.dataset.reviewIndex);
        if (state.reviewFlags.has(itemIndex)) state.reviewFlags.delete(itemIndex);
        else state.reviewFlags.add(itemIndex);
        const marked = state.reviewFlags.has(itemIndex);
        button.classList.toggle("active", marked);
        button.setAttribute("aria-pressed", String(marked));
        button.innerHTML = `<span aria-hidden="true">${marked ? "★" : "☆"}</span>${marked ? "Đã đánh dấu" : "Đánh dấu xem lại"}`;
        $(`#question-${itemIndex}`)?.classList.toggle("marked", marked);
        updateQuestionNavigationState();
        saveExamDraft();
      });
    });
  }

  function handleAnswerChange(itemIndex, saveImmediately = true) {
    updateQuestionCardStatus(itemIndex);
    updateQuestionNavigationState();
    updateProgress();
    if (saveImmediately) saveExamDraft();
    else scheduleAutosave();
  }

  function updateQuestionCardStatus(itemIndex) {
    const item = state.items[itemIndex];
    const card = $(`#question-${itemIndex}`);
    if (!item || !card) return;
    card.classList.remove("empty", "partial", "done");
    card.classList.add(getItemStatus(item));
  }

  function getItemStatus(item) {
    if (item.type === "mcq") return Number.isInteger(state.answers.mcq[item.question.id]) ? "done" : "empty";
    if (item.type === "tf") {
      const count = Object.keys(state.answers.tf[item.question.id] || {}).length;
      return count === 4 ? "done" : count > 0 ? "partial" : "empty";
    }
    return String(state.answers.short[item.question.id] ?? "").trim() !== "" ? "done" : "empty";
  }

  function isItemAnswered(item) {
    return getItemStatus(item) === "done";
  }

  function renderQuestionNavigation() {
    const groups = [
      { part: 1, title: "Phần I", items: state.items.filter((item) => item.part === 1) },
      { part: 2, title: "Phần II", items: state.items.filter((item) => item.part === 2) },
      { part: 3, title: "Phần III", items: state.items.filter((item) => item.part === 3) }
    ];

    const navigation = $("#question-navigation");
    if (!navigation) return;

    const structureKey = state.items
      .map((item, index) => `${index}:${item.part}:${item.number}:${item.question?.id || ""}`)
      .join("|");

    if (navigation.dataset.structureKey !== structureKey) {
      navigation.innerHTML = groups.map((group) => `
        <div class="nav-part" data-nav-part="${group.part}">
          <div class="nav-part-title">
            <span>${group.title}</span>
            <span>${group.items.length} câu</span>
          </div>
          <div class="nav-buttons">
            ${group.items.map((item) => {
              const globalIndex = state.items.indexOf(item);
              return `<button class="question-nav-button empty" type="button" data-question-index="${globalIndex}" aria-label="${group.title}, câu ${item.number}">${item.number}</button>`;
            }).join("")}
          </div>
        </div>
      `).join("");
      navigation.dataset.structureKey = structureKey;
    }

    if (navigation.dataset.clickBound !== "true") {
      navigation.addEventListener("click", (event) => {
        const button = event.target.closest("[data-question-index]");
        if (!button || !navigation.contains(button)) return;
        jumpToQuestion(Number(button.dataset.questionIndex));
      });
      navigation.dataset.clickBound = "true";
    }

    updateQuestionNavigationState();
    updateProgress();
  }

  function updateQuestionNavigationState() {
    const navigation = $("#question-navigation");
    if (!navigation) return;

    navigation.querySelectorAll("[data-question-index]").forEach((button) => {
      const itemIndex = Number(button.dataset.questionIndex);
      const item = state.items[itemIndex];
      if (!item) return;

      const status = getItemStatus(item);
      const isCurrent = itemIndex === state.currentIndex;
      const isMarked = state.reviewFlags.has(itemIndex);

      button.classList.remove("empty", "partial", "done", "current", "marked");
      button.classList.add(status);
      button.classList.toggle("current", isCurrent);
      button.classList.toggle("marked", isMarked);
      button.setAttribute("aria-current", isCurrent ? "true" : "false");
    });
  }

  function setCurrentQuestion(itemIndex) {
    if (!Number.isInteger(itemIndex) || !state.items[itemIndex]) return;
    state.currentIndex = itemIndex;
    $$('[data-question-card]').forEach((card) => {
      card.classList.toggle(
        "current-view",
        Number(card.dataset.questionIndex) === itemIndex
      );
    });
    updateQuestionNavigationState();
  }

  function getQuestionScrollOffset() {
    const commandBar = $("#exam-command-bar");
    const topbar = $(".topbar");
    const commandBottom = commandBar?.getBoundingClientRect().bottom || 0;
    const topbarBottom = topbar?.getBoundingClientRect().bottom || 0;
    return Math.max(commandBottom, topbarBottom, 92) + 16;
  }

  function jumpToQuestion(itemIndex) {
    const target = $(`#question-${itemIndex}`);
    if (!target || !state.items[itemIndex]) return;

    window.clearTimeout(state.questionJumpTimer);
    state.observerLockUntil = Date.now() + 900;
    setCurrentQuestion(itemIndex);
    closeQuestionMap();

    const targetTop = Math.max(
      0,
      window.scrollY + target.getBoundingClientRect().top - getQuestionScrollOffset()
    );

    window.scrollTo({
      top: targetTop,
      behavior: "smooth"
    });

    target.classList.remove("jump-highlight");
    window.requestAnimationFrame(() => target.classList.add("jump-highlight"));
    window.setTimeout(() => target.classList.remove("jump-highlight"), 1200);

    state.questionJumpTimer = window.setTimeout(() => {
      state.observerLockUntil = 0;
      syncCurrentQuestionFromViewport();
    }, 920);
  }

  function syncCurrentQuestionFromViewport() {
    if (Date.now() < state.observerLockUntil) return;

    const cards = $$('[data-question-card]');
    if (!cards.length) return;

    const anchorY = getQuestionScrollOffset() + Math.min(130, window.innerHeight * 0.12);
    let bestCard = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    cards.forEach((card) => {
      const rect = card.getBoundingClientRect();
      if (rect.bottom <= getQuestionScrollOffset() || rect.top >= window.innerHeight) return;

      if (rect.top <= anchorY && rect.bottom >= anchorY) {
        bestCard = card;
        bestDistance = -1;
        return;
      }

      if (bestDistance === -1) return;
      const distance = Math.min(
        Math.abs(rect.top - anchorY),
        Math.abs(rect.bottom - anchorY)
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        bestCard = card;
      }
    });

    if (!bestCard) return;
    const index = Number(bestCard.dataset.questionIndex);
    if (!Number.isInteger(index) || index === state.currentIndex) return;
    setCurrentQuestion(index);
  }

  function startQuestionObserver() {
    stopQuestionObserver();

    const scheduleSync = () => {
      if (state.questionScrollFrame) return;
      state.questionScrollFrame = window.requestAnimationFrame(() => {
        state.questionScrollFrame = null;
        syncCurrentQuestionFromViewport();
      });
    };

    state.questionScrollHandler = scheduleSync;
    window.addEventListener("scroll", scheduleSync, { passive: true });
    window.addEventListener("resize", scheduleSync, { passive: true });
    scheduleSync();
  }

  function stopQuestionObserver() {
    state.questionObserver?.disconnect();
    state.questionObserver = null;

    if (state.questionScrollHandler) {
      window.removeEventListener("scroll", state.questionScrollHandler);
      window.removeEventListener("resize", state.questionScrollHandler);
      state.questionScrollHandler = null;
    }

    if (state.questionScrollFrame) {
      window.cancelAnimationFrame(state.questionScrollFrame);
      state.questionScrollFrame = null;
    }

    window.clearTimeout(state.questionJumpTimer);
    state.questionJumpTimer = null;
    state.observerLockUntil = 0;
  }

  function updateProgress() {
    const answered = state.items.filter(isItemAnswered).length;
    const total = state.items.length;
    $$('[data-progress-text]').forEach((element) => { element.textContent = `${answered}/${total}`; });
    if ($("#floating-progress-text")) $("#floating-progress-text").textContent = `${answered}/${total}`;
    if ($("#progress-bar")) $("#progress-bar").style.width = `${total ? (answered / total) * 100 : 0}%`;
  }

  function openQuestionMap() {
    const map = $("#question-map");
    const backdrop = $("#question-map-backdrop");
    map?.classList.add("mobile-open");
    map?.setAttribute("aria-hidden", "false");
    backdrop?.classList.add("open");
    backdrop?.setAttribute("aria-hidden", "false");
    $("#mobile-question-map-button")?.setAttribute("aria-expanded", "true");
    $("#floating-question-map-button")?.setAttribute("aria-expanded", "true");
    document.body.classList.add("question-map-is-open");
    window.requestAnimationFrame(() => scrollCurrentNavigationButtonIntoView());
  }

  function scrollCurrentNavigationButtonIntoView() {
    const map = $("#question-map");
    const button = $(`[data-question-index="${state.currentIndex}"]`);
    if (!map || !button) return;

    const mapRect = map.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const safeTop = mapRect.top + 84;
    const safeBottom = mapRect.bottom - 88;

    if (buttonRect.top >= safeTop && buttonRect.bottom <= safeBottom) return;

    const targetTop = map.scrollTop
      + buttonRect.top
      - mapRect.top
      - map.clientHeight / 2
      + buttonRect.height / 2;

    map.scrollTo({
      top: Math.max(0, targetTop),
      behavior: "auto"
    });
  }

  function closeQuestionMap() {
    const map = $("#question-map");
    const backdrop = $("#question-map-backdrop");
    map?.classList.remove("mobile-open");
    backdrop?.classList.remove("open");
    backdrop?.setAttribute("aria-hidden", "true");
    $("#mobile-question-map-button")?.setAttribute("aria-expanded", "false");
    $("#floating-question-map-button")?.setAttribute("aria-expanded", "false");
    document.body.classList.remove("question-map-is-open");
  }

  function getExamDraftKey(exam = state.activeExam) {
    const userId = state.studentUser?.id || "guest";
    const examId = exam?.id || exam?.code || "exam";
    return `${EXAM_DRAFT_PREFIX}:${userId}:${examId}`;
  }

  function restoreExamDraftIfAvailable(exam) {
    try {
      const raw = localStorage.getItem(getExamDraftKey(exam));
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (!draft?.answers || draft.submitted) return;
      const shouldResume = window.confirm("Bạn có một bài làm chưa hoàn thành ở đề này. Nhấn OK để tiếp tục, hoặc Hủy để làm lại từ đầu.");
      if (!shouldResume) {
        localStorage.removeItem(getExamDraftKey(exam));
        return;
      }
      state.answers = {
        mcq: draft.answers.mcq || {},
        tf: draft.answers.tf || {},
        short: draft.answers.short || {}
      };
      state.reviewFlags = new Set(Array.isArray(draft.reviewFlags) ? draft.reviewFlags : []);
      const elapsedSinceSave = draft.savedAt ? Math.max(0, Math.floor((Date.now() - draft.savedAt) / 1000)) : 0;
      state.secondsLeft = Math.max(0, Number(draft.secondsLeft ?? state.secondsLeft) - elapsedSinceSave);
      state.startedAt = Number(draft.startedAt || Date.now());
      showToast("Đã khôi phục bài làm đang dở.");
    } catch (error) {
      console.error("Không thể khôi phục bài làm:", error);
      localStorage.removeItem(getExamDraftKey(exam));
    }
  }

  function saveExamDraft() {
    if (!state.activeExam || state.submitted) return;
    try {
      const draft = {
        examId: state.activeExam.id,
        examCode: state.activeExam.code,
        answers: state.answers,
        reviewFlags: [...state.reviewFlags],
        secondsLeft: state.secondsLeft,
        startedAt: state.startedAt,
        savedAt: Date.now(),
        submitted: false
      };
      localStorage.setItem(getExamDraftKey(), JSON.stringify(draft));
      const status = $("#autosave-status");
      if (status) status.textContent = `Đã lưu lúc ${new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
    } catch (error) {
      console.error("Không thể lưu bài tạm:", error);
      if ($("#autosave-status")) $("#autosave-status").textContent = "Chưa lưu được trên thiết bị";
    }
  }

  function scheduleAutosave() {
    clearAutosaveTimer();
    state.autosaveTimer = window.setTimeout(() => {
      saveExamDraft();
      state.autosaveTimer = null;
    }, 500);
  }

  function clearAutosaveTimer() {
    if (state.autosaveTimer) window.clearTimeout(state.autosaveTimer);
    state.autosaveTimer = null;
  }

  function clearExamDraft() {
    try { localStorage.removeItem(getExamDraftKey()); } catch (error) { console.error(error); }
  }

  function openSubmitModal() {
    const unansweredIndexes = state.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !isItemAnswered(item));
    const markedIndexes = [...state.reviewFlags].sort((a, b) => a - b);
    const answered = state.items.length - unansweredIndexes.length;

    $("#modal-message").textContent = unansweredIndexes.length
      ? `Bạn đã hoàn thành ${answered}/${state.items.length} câu. Hãy kiểm tra các câu còn thiếu trước khi nộp.`
      : `Bạn đã trả lời đầy đủ ${state.items.length} câu. Hãy kiểm tra lần cuối trước khi nộp.`;

    const summary = $("#modal-question-summary");
    if (summary) {
      const buildButtons = (indexes, emptyText) => indexes.length
        ? `<div class="modal-jump-list">${indexes.map((index) => {
            const item = state.items[index];
            return `<button type="button" data-modal-jump-index="${index}">${partShortLabel(item.part)} ${item.number}</button>`;
          }).join("")}</div>`
        : `<p class="modal-empty-note">${emptyText}</p>`;
      summary.innerHTML = `
        <div class="modal-summary-group">
          <strong>Chưa hoàn thành (${unansweredIndexes.length})</strong>
          ${buildButtons(unansweredIndexes.map(({ index }) => index), "Không còn câu bỏ trống.")}
        </div>
        <div class="modal-summary-group">
          <strong>Đã đánh dấu xem lại (${markedIndexes.length})</strong>
          ${buildButtons(markedIndexes, "Không có câu nào được đánh dấu.")}
        </div>`;
      $$('[data-modal-jump-index]').forEach((button) => {
        button.addEventListener("click", () => {
          closeSubmitModal();
          jumpToQuestion(Number(button.dataset.modalJumpIndex));
        });
      });
    }

    $("#confirm-modal").classList.add("open");
    $("#confirm-modal").setAttribute("aria-hidden", "false");
  }

  function partShortLabel(part) {
    return part === 1 ? "Phần I · Câu" : part === 2 ? "Phần II · Câu" : "Phần III · Câu";
  }

  function typeLabel(type) {
    return type === "mcq" ? "Phần I · Nhiều lựa chọn" : type === "tf" ? "Phần II · Đúng/Sai" : "Phần III · Trả lời ngắn";
  }

  function closeSubmitModal() {
    $("#confirm-modal").classList.remove("open");
    $("#confirm-modal").setAttribute("aria-hidden", "true");
  }

  function submitExam(autoSubmitted) {
    if (state.submitted || !state.activeExam) return;
    state.submitted = true;
    stopTimer();
    stopQuestionObserver();
    clearAutosaveTimer();
    clearExamDraft();
    closeQuestionMap();
    closeSubmitModal();

    const scores = calculateScores();
    const examSeconds = state.activeExam.durationMinutes * 60;
    const timeUsedSeconds = examSeconds - Math.max(0, state.secondsLeft);
    const result = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      examId: state.activeExam.id,
      examCode: state.activeExam.code,
      examTitle: state.activeExam.title,
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
      answers: deepClone(state.answers)
    };

    const results = getResults();
    results.unshift(result);
    saveResults(results);
    state.latestResult = result;
    renderResult(result);
    showScreen("result");

    void saveResultToSupabase(result)
      .then(() => showToast("Kết quả đã được lưu lên hệ thống."))
      .catch((error) => {
        console.error("Không lưu được kết quả lên Supabase:", error);
        showToast("Chưa lưu được lên máy chủ. Kết quả vẫn còn trên thiết bị này.");
      });

    if (autoSubmitted) showToast("Hết giờ. Hệ thống đã tự động nộp bài.");
  }

  async function saveResultToSupabase(result) {
    if (!window.supabaseClient) throw new Error("Supabase chưa được khởi tạo.");
    const payload = {
      client_result_id: result.id,
      exam_id: result.examId,
      exam_code: result.examCode,
      student_user_id: state.studentUser?.id || null,
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
    const { error } = await window.supabaseClient.from("exam_attempts").insert(payload);
    if (error && error.code !== "23505") throw error;
  }

  function calculateScores() {
    const data = state.activeExam.data;
    let mcqCorrect = 0;
    data.mcq.forEach((question) => {
      if (state.answers.mcq[question.id] === Number(question.answer)) mcqCorrect += 1;
    });

    let part2 = 0;
    let tfCorrectStatements = 0;
    data.trueFalse.forEach((question) => {
      const selected = state.answers.tf[question.id] || {};
      let correctInQuestion = 0;
      question.statements.forEach((statement, index) => {
        if (selected[index] === Boolean(statement.answer)) correctInQuestion += 1;
      });
      tfCorrectStatements += correctInQuestion;
      part2 += TF_SCORE[correctInQuestion];
    });

    let shortCorrect = 0;
    data.shortAnswer.forEach((question) => {
      const parsed = parseNumericAnswer(state.answers.short[question.id]);
      if (Number.isFinite(parsed) && Math.abs(parsed - Number(question.answer)) <= Number(question.tolerance || 0)) shortCorrect += 1;
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
      ? `Hết thời gian, hệ thống đã tự động nộp ${result.examCode}.`
      : result.score >= 8
        ? `Kết quả tốt ở ${result.examCode}. Hãy xem lại những câu sai để giữ vững mức điểm này.`
        : result.score >= 5
          ? `Bạn đã đạt mức cơ bản ở ${result.examCode}. Tập trung cải thiện phần có điểm thấp nhất.`
          : `Bạn cần củng cố lại kiến thức nền trước khi làm lại ${result.examCode}.`;
    $("#final-score").textContent = result.score.toFixed(2);
    $("#part-one-score").textContent = result.part1.toFixed(2);
    $("#part-two-score").textContent = result.part2.toFixed(2);
    $("#part-three-score").textContent = result.part3.toFixed(2);
    $("#time-used").textContent = formatDuration(result.timeUsedSeconds);
    renderReview(result);
  }

  function renderReview(result) {
    $("#review-list").innerHTML = state.items.map((item, globalIndex) => {
      const review = getItemReview(item, result.answers);
      return `
        <article class="review-item">
          <button class="review-summary" type="button" data-review-index="${globalIndex}">
            <span class="review-status ${review.correct ? "correct" : "wrong"}">${review.correct ? "✓" : "×"}</span>
            <strong>${typeLabel(item.type)} · Câu ${item.number}: ${truncate(item.type === "tf" ? item.question.context : item.question.stem, 120)}</strong>
            <small>${review.label}</small>
          </button>
          <div class="review-detail">${review.detail}<div class="review-answer"><strong>Lời giải:</strong> ${review.explanation}</div></div>
        </article>`;
    }).join("");
    $$('[data-review-index]').forEach((button) => button.addEventListener("click", () => button.closest(".review-item").classList.toggle("open")));
  }

  function getItemReview(item, answers) {
    if (item.type === "mcq") {
      const selected = answers.mcq[item.question.id];
      const answer = Number(item.question.answer);
      const correct = selected === answer;
      const selectedText = Number.isInteger(selected) ? `${String.fromCharCode(65 + selected)}. ${item.question.options[selected]}` : "Chưa trả lời";
      const correctText = `${String.fromCharCode(65 + answer)}. ${item.question.options[answer]}`;
      return { correct, label: correct ? "+0,25 điểm" : "0 điểm", detail: `<p><strong>Bạn chọn:</strong> ${selectedText}</p><p><strong>Đáp án đúng:</strong> ${correctText}</p>`, explanation: item.question.explanation || "" };
    }
    if (item.type === "tf") {
      const selected = answers.tf[item.question.id] || {};
      let correctCount = 0;
      const lines = item.question.statements.map((statement, index) => {
        const isCorrect = selected[index] === Boolean(statement.answer);
        if (isCorrect) correctCount += 1;
        const selectedLabel = selected[index] === undefined ? "Chưa chọn" : selected[index] ? "Đúng" : "Sai";
        const answerLabel = statement.answer ? "Đúng" : "Sai";
        return `<p><strong>${String.fromCharCode(97 + index)})</strong> ${statement.text}<br/>Bạn chọn: ${selectedLabel} · Đáp án: ${answerLabel}<br/><em>${statement.explanation || ""}</em></p>`;
      }).join("");
      return { correct: correctCount === 4, label: `${correctCount}/4 ý đúng · +${TF_SCORE[correctCount].toFixed(2)} điểm`, detail: lines, explanation: "Điểm của câu Đúng/Sai được tính theo tổng số ý đúng trong cùng một câu." };
    }
    const selectedValue = parseNumericAnswer(answers.short[item.question.id]);
    const answer = Number(item.question.answer);
    const correct = Number.isFinite(selectedValue) && Math.abs(selectedValue - answer) <= Number(item.question.tolerance || 0);
    return { correct, label: correct ? "+0,25 điểm" : "0 điểm", detail: `<p><strong>Bạn trả lời:</strong> ${Number.isFinite(selectedValue) ? `${selectedValue} ${item.question.unit || ""}` : "Chưa trả lời"}</p><p><strong>Đáp án:</strong> ${answer} ${item.question.unit || ""}</p>`, explanation: item.question.explanation || "" };
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

  async function getResultsFromSupabase() {
    if (!window.supabaseClient) throw new Error("Supabase chưa được khởi tạo.");
    const { data, error } = await window.supabaseClient
      .from("exam_attempts")
      .select("id, exam_id, exam_code, student_name, class_name, score, part1, part2, part3, mcq_correct, tf_correct_statements, short_correct, time_used_seconds, auto_submitted, submitted_at")
      .order("submitted_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }

  function mapSupabaseResult(row) {
    return {
      id: row.id,
      examId: row.exam_id,
      examCode: row.exam_code || "Không rõ",
      name: row.student_name,
      className: row.class_name,
      score: Number(row.score),
      part1: Number(row.part1),
      part2: Number(row.part2),
      part3: Number(row.part3),
      mcqCorrect: Number(row.mcq_correct || 0),
      tfCorrectStatements: Number(row.tf_correct_statements || 0),
      shortCorrect: Number(row.short_correct || 0),
      timeUsedSeconds: Number(row.time_used_seconds || 0),
      autoSubmitted: Boolean(row.auto_submitted),
      submittedAt: row.submitted_at
    };
  }

  async function loadTeacherDashboard(showDashboard = true) {
    if (!state.teacherUser) {
      openTeacherLoginModal();
      return;
    }
    const refreshButton = $("#refresh-dashboard-button");
    if (refreshButton) {
      refreshButton.disabled = true;
      refreshButton.textContent = "Đang tải...";
    }
    try {
      const rows = await getResultsFromSupabase();
      state.dashboardResults = rows.map(mapSupabaseResult);
      renderDashboard(state.dashboardResults);
      if (showDashboard) showScreen("dashboard");
    } catch (error) {
      console.error("Không tải được bảng điểm:", error);
      showToast(error.code === "42501" ? "Tài khoản này không có quyền xem bảng điểm." : `Không tải được bảng điểm: ${error.message || "Lỗi không xác định"}`);
    } finally {
      if (refreshButton) {
        refreshButton.disabled = false;
        refreshButton.textContent = "Làm mới";
      }
    }
  }

  function renderDashboard(results = state.dashboardResults) {
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
    populateExamFilter(results);
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
    $("#distribution-chart").innerHTML = buckets.map((bucket) => `<div class="distribution-column"><div class="bar-area"><div class="bar" style="height:${(bucket.count / max) * 100}%"></div></div><strong>${bucket.count}</strong><span>${bucket.label}</span></div>`).join("");
  }

  function renderPartAverages(results) {
    const parts = [
      { label: "Phần I", max: 4.5, value: averageField(results, "part1") },
      { label: "Phần II", max: 4, value: averageField(results, "part2") },
      { label: "Phần III", max: 1.5, value: averageField(results, "part3") }
    ];
    $("#part-chart").innerHTML = parts.map((part) => `<div class="part-bar-row"><span>${part.label}</span><div class="part-bar-track"><i style="width:${part.max ? (part.value / part.max) * 100 : 0}%"></i></div><strong>${part.value.toFixed(2)}</strong></div>`).join("");
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

  function populateExamFilter(results) {
    const current = $("#exam-filter").value;
    const exams = [...new Set(results.map((result) => result.examCode))].sort();
    $("#exam-filter").innerHTML = `<option value="">Tất cả đề</option>${exams.map((code) => `<option value="${escapeHtml(code)}">${escapeHtml(code)}</option>`).join("")}`;
    if (exams.includes(current)) $("#exam-filter").value = current;
  }

  function renderResultsTable() {
    const search = $("#search-result").value.trim().toLocaleLowerCase("vi");
    const classFilter = $("#class-filter").value;
    const examFilter = $("#exam-filter").value;
    const filtered = state.dashboardResults.filter((result) => {
      const matchesSearch = result.name.toLocaleLowerCase("vi").includes(search);
      const matchesClass = !classFilter || result.className === classFilter;
      const matchesExam = !examFilter || result.examCode === examFilter;
      return matchesSearch && matchesClass && matchesExam;
    });

    $("#results-table-body").innerHTML = filtered.map((result) => `
      <tr>
        <td><strong>${escapeHtml(result.name)}</strong></td><td>${escapeHtml(result.className)}</td><td><span class="exam-code-badge">${escapeHtml(result.examCode)}</span></td>
        <td>${result.part1.toFixed(2)}</td><td>${result.part2.toFixed(2)}</td><td>${result.part3.toFixed(2)}</td>
        <td><span class="score-badge ${scoreClass(result.score)}">${result.score.toFixed(2)}</span></td><td>${formatDuration(result.timeUsedSeconds)}</td><td>${formatDate(result.submittedAt)}</td>
      </tr>`).join("");
    $("#empty-results").style.display = filtered.length ? "none" : "block";
    $("#teacher-results-panel .table-wrap").style.display = filtered.length ? "block" : "none";
  }

  function scoreClass(score) {
    return score >= 8 ? "good" : score >= 5 ? "average" : "low";
  }

  function showTeacherPanel(panelName) {
    $$('[data-teacher-tab]').forEach((button) => button.classList.toggle("active", button.dataset.teacherTab === panelName));
    $$('[data-teacher-panel]').forEach((panel) => panel.classList.toggle("active", panel.dataset.teacherPanel === panelName));
  }

  async function loadTeacherExams() {
    if (!state.teacherUser || !window.supabaseClient) return;
    $("#teacher-exam-list").innerHTML = `<div class="manager-loading">Đang tải danh sách đề...</div>`;
    try {
      const { data, error } = await window.supabaseClient
        .from("exams")
        .select("id, code, title, description, duration_minutes, grade_level, is_published, exam_data, created_at, updated_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      state.teacherExams = (data || []).map(normalizeExamRow);
      renderTeacherExamList();
      if (state.examDraft?.id) {
        const updated = state.teacherExams.find((exam) => exam.id === state.examDraft.id);
        if (updated) setExamDraftFromExam(updated);
      }
    } catch (error) {
      console.error("Không tải được danh sách đề:", error);
      $("#teacher-exam-list").innerHTML = `<div class="empty-state"><strong>Không tải được danh sách đề</strong><p>${escapeHtml(error.message || "")}</p></div>`;
    }
  }

  function renderTeacherExamList() {
    const list = $("#teacher-exam-list");
    if (!state.teacherExams.length) {
      list.innerHTML = `<div class="empty-state"><strong>Chưa có đề nào</strong><p>Nhấn “Tạo đề” hoặc đưa đề mẫu lên Supabase.</p></div>`;
      return;
    }
    list.innerHTML = state.teacherExams.map((exam) => {
      const counts = getExamCounts(exam.data);
      return `
        <button class="teacher-exam-card ${state.examDraft?.id === exam.id ? "active" : ""}" type="button" data-edit-exam="${exam.id}">
          <span class="teacher-exam-card-top"><strong>${escapeHtml(exam.code)}</strong><i class="publish-badge ${exam.isPublished ? "published" : "draft"}">${exam.isPublished ? "Đã xuất bản" : "Bản nháp"}</i></span>
          <h3>${escapeHtml(exam.title)}</h3>
          <p>${counts.mcq}/18 · ${counts.tf}/4 · ${counts.short}/6 câu</p>
        </button>`;
    }).join("");
    $$('[data-edit-exam]').forEach((button) => button.addEventListener("click", () => {
      const exam = state.teacherExams.find((item) => item.id === button.dataset.editExam);
      if (exam) setExamDraftFromExam(exam);
    }));
  }

  function startNewExamDraft() {
    state.examDraft = {
      id: null,
      code: `VL-THPT-${String(state.teacherExams.length + 1).padStart(2, "0")}`,
      title: "Đề luyện Vật lí THPT mới",
      description: "",
      durationMinutes: 50,
      isPublished: false,
      data: createEmptyExamData()
    };
    renderExamEditor();
    renderTeacherExamList();
  }

  function setExamDraftFromExam(exam) {
    state.examDraft = deepClone(exam);
    renderExamEditor();
    renderTeacherExamList();
  }

  function renderExamEditor() {
    const draft = state.examDraft;
    $("#exam-editor-empty").hidden = Boolean(draft);
    $("#exam-editor").hidden = !draft;
    if (!draft) return;

    $("#exam-editor-heading").textContent = draft.id ? `Chỉnh sửa ${draft.code}` : "Tạo đề mới";
    $("#exam-code-input").value = draft.code || "";
    $("#exam-duration-input").value = draft.durationMinutes || 50;
    $("#exam-title-input").value = draft.title || "";
    $("#exam-description-input").value = draft.description || "";
    $("#publish-exam-button").textContent = draft.isPublished ? "Gỡ xuất bản" : "Xuất bản";
    $("#delete-exam-button").disabled = !draft.id;
    updateDraftCounts();
    renderDraftPassageList();
    renderDraftQuestionList();
    renderQuestionBuilderFields();
    bindAutoGrowTextareas();
  }

  function readMetadataIntoDraft() {
    if (!state.examDraft) return false;
    const code = $("#exam-code-input").value.trim().toUpperCase().replace(/\s+/g, "-");
    const title = $("#exam-title-input").value.trim();
    const description = $("#exam-description-input").value.trim();
    const durationMinutes = Number($("#exam-duration-input").value);
    if (!code || !title || !Number.isFinite(durationMinutes) || durationMinutes < 10 || durationMinutes > 180) {
      showToast("Vui lòng nhập mã đề, tên đề và thời gian từ 10 đến 180 phút.");
      return false;
    }
    Object.assign(state.examDraft, { code, title, description, durationMinutes });
    return true;
  }

  function getExamCounts(data) {
    const mcq = Array.isArray(data?.mcq) ? data.mcq.length : 0;
    const tf = Array.isArray(data?.trueFalse) ? data.trueFalse.length : 0;
    const short = Array.isArray(data?.shortAnswer) ? data.shortAnswer.length : 0;
    return { mcq, tf, short, total: mcq + tf + short };
  }

  function hasRequiredStructure(data) {
    const counts = getExamCounts(data);
    return counts.mcq === REQUIRED_COUNTS.mcq && counts.tf === REQUIRED_COUNTS.tf && counts.short === REQUIRED_COUNTS.short;
  }

  function updateDraftCounts() {
    if (!state.examDraft) return;
    const counts = getExamCounts(state.examDraft.data);
    $("#draft-mcq-count").textContent = `${counts.mcq}/18`;
    $("#draft-tf-count").textContent = `${counts.tf}/4`;
    $("#draft-short-count").textContent = `${counts.short}/6`;
    $("#draft-mcq-count").classList.toggle("complete", counts.mcq === 18);
    $("#draft-tf-count").classList.toggle("complete", counts.tf === 4);
    $("#draft-short-count").classList.toggle("complete", counts.short === 6);
  }

  function getPassageOptions(selectedValue = "") {
    const passages = state.examDraft?.data?.passages || [];
    return [
      `<option value="">Không dùng đoạn dữ kiện chung</option>`,
      ...passages.map((passage) => `<option value="${escapeHtml(String(passage.id))}" ${String(passage.id) === String(selectedValue) ? "selected" : ""}>${escapeHtml(passage.title || passage.id)}</option>`)
    ].join("");
  }

  function renderQuestionBuilderFields() {
    const container = $("#question-builder-fields");
    if (!container) return;
    const type = $("#question-type-input")?.value || "mcq";
    const passageField = `<label class="builder-wide">Đoạn dữ kiện dùng chung<select id="qb-passage-id">${getPassageOptions()}</select><small class="field-hint">Chọn một đoạn đã lưu ở phía trên. Nội dung dài không phải lặp lại trong từng câu.</small></label>`;

    if (type === "mcq") {
      container.innerHTML = `
        <div class="builder-grid">
          <label>Chủ đề<input id="qb-topic" placeholder="Ví dụ: Dao động" /></label>
          ${passageField}
          <label class="builder-wide">Dữ kiện riêng của câu (tùy chọn)<textarea id="qb-context" class="long-content-textarea" rows="6" data-auto-grow placeholder="Không giới hạn ký tự"></textarea></label>
          <label class="builder-wide">Nội dung câu hỏi<textarea id="qb-stem" class="long-content-textarea" rows="6" data-auto-grow placeholder="Không giới hạn ký tự"></textarea><small class="field-hint">Không đặt maxlength. Có thể dán nguyên văn đoạn dài, công thức và xuống dòng.</small></label>
          ${["A", "B", "C", "D"].map((letter, index) => `<label>Phương án ${letter}<textarea id="qb-option-${index}" rows="3" data-auto-grow placeholder="Phương án có thể dài"></textarea></label>`).join("")}
          <label>Đáp án đúng<select id="qb-mcq-answer"><option value="0">A</option><option value="1">B</option><option value="2">C</option><option value="3">D</option></select></label>
          <label class="builder-wide">Lời giải<textarea id="qb-explanation" class="long-content-textarea" rows="6" data-auto-grow placeholder="Không giới hạn ký tự"></textarea></label>
        </div>`;
      bindAutoGrowTextareas();
      return;
    }
    if (type === "tf") {
      container.innerHTML = `
        <div class="builder-grid">
          <label>Chủ đề<input id="qb-topic" placeholder="Ví dụ: Khí lí tưởng" /></label>
          ${passageField}
          <label class="builder-wide">Dữ kiện riêng của câu<textarea id="qb-context" class="long-content-textarea" rows="10" data-auto-grow placeholder="Không giới hạn ký tự"></textarea><small class="field-hint">Nếu đã chọn đoạn dữ kiện chung, ô này chỉ cần ghi phần bổ sung riêng cho câu.</small></label>
        </div>
        <div class="tf-builder-list">
          ${[0, 1, 2, 3].map((index) => `
            <div class="tf-builder-row long-row">
              <strong>${String.fromCharCode(97 + index)})</strong>
              <textarea id="qb-statement-${index}" rows="3" data-auto-grow placeholder="Nhận định ${index + 1}, không giới hạn ký tự"></textarea>
              <select id="qb-tf-answer-${index}"><option value="true">Đúng</option><option value="false">Sai</option></select>
              <textarea id="qb-tf-explanation-${index}" rows="3" data-auto-grow placeholder="Giải thích, không giới hạn ký tự"></textarea>
            </div>`).join("")}
        </div>`;
      bindAutoGrowTextareas();
      return;
    }
    container.innerHTML = `
      <div class="builder-grid">
        <label>Chủ đề<input id="qb-topic" placeholder="Ví dụ: Điện năng" /></label>
        ${passageField}
        <label class="builder-wide">Dữ kiện riêng của câu (tùy chọn)<textarea id="qb-context" class="long-content-textarea" rows="6" data-auto-grow placeholder="Không giới hạn ký tự"></textarea></label>
        <label class="builder-wide">Nội dung câu hỏi<textarea id="qb-stem" class="long-content-textarea" rows="6" data-auto-grow placeholder="Không giới hạn ký tự"></textarea></label>
        <label>Đáp án số<input id="qb-short-answer" inputmode="decimal" placeholder="Ví dụ: 14.4" /></label>
        <label>Sai số cho phép<input id="qb-tolerance" inputmode="decimal" value="0.01" /></label>
        <label>Đơn vị<input id="qb-unit" placeholder="Ví dụ: kJ" /></label>
        <label class="builder-wide">Lời giải<textarea id="qb-explanation" class="long-content-textarea" rows="6" data-auto-grow placeholder="Không giới hạn ký tự"></textarea></label>
      </div>`;
    bindAutoGrowTextareas();
  }

  function addQuestionToDraft() {
    if (!state.examDraft) {
      showToast("Hãy tạo hoặc chọn một đề trước.");
      return;
    }
    const type = $("#question-type-input").value;
    const topic = $("#qb-topic")?.value.trim() || "Vật lí";
    const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    const counts = getExamCounts(state.examDraft.data);
    const passageId = $("#qb-passage-id")?.value || "";
    const context = $("#qb-context")?.value.trim() || "";

    if (type === "mcq") {
      if (counts.mcq >= 18) return showToast("Phần I đã đủ 18 câu.");
      const stem = $("#qb-stem").value.trim();
      const options = [0, 1, 2, 3].map((index) => $(`#qb-option-${index}`).value.trim());
      if (!stem || options.some((option) => !option)) return showToast("Hãy nhập nội dung và đủ bốn phương án.");
      state.examDraft.data.mcq.push({ id, topic, passageId, context, stem, options, answer: Number($("#qb-mcq-answer").value), explanation: $("#qb-explanation").value.trim() });
    } else if (type === "tf") {
      if (counts.tf >= 4) return showToast("Phần II đã đủ 4 câu.");
      const statements = [0, 1, 2, 3].map((index) => ({
        text: $(`#qb-statement-${index}`).value.trim(),
        answer: $(`#qb-tf-answer-${index}`).value === "true",
        explanation: $(`#qb-tf-explanation-${index}`).value.trim()
      }));
      if ((!context && !passageId) || statements.some((statement) => !statement.text)) return showToast("Hãy chọn đoạn dữ kiện chung hoặc nhập dữ kiện riêng, đồng thời nhập đủ bốn nhận định.");
      state.examDraft.data.trueFalse.push({ id, topic, passageId, context, statements });
    } else {
      if (counts.short >= 6) return showToast("Phần III đã đủ 6 câu.");
      const stem = $("#qb-stem").value.trim();
      const answer = parseNumericAnswer($("#qb-short-answer").value);
      const tolerance = parseNumericAnswer($("#qb-tolerance").value);
      if (!stem || !Number.isFinite(answer) || !Number.isFinite(tolerance) || tolerance < 0) return showToast("Hãy nhập câu hỏi, đáp án số và sai số hợp lệ.");
      state.examDraft.data.shortAnswer.push({ id, topic, passageId, context, stem, answer, tolerance, unit: $("#qb-unit").value.trim(), explanation: $("#qb-explanation").value.trim() });
    }

    updateDraftCounts();
    renderDraftQuestionList();
    renderQuestionBuilderFields();
    showToast("Đã thêm câu hỏi vào bản nháp.");
  }

  function addPassageToDraft() {
    if (!state.examDraft) return showToast("Hãy tạo hoặc chọn một đề trước.");
    const title = $("#passage-title-input")?.value.trim() || "Đoạn dữ kiện dùng chung";
    const content = $("#passage-content-input")?.value.trim() || "";
    if (!content) return showToast("Hãy nhập nội dung đoạn dữ kiện.");
    const rawId = $("#passage-id-input")?.value.trim() || title;
    const id = rawId.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `passage-${Date.now()}`;
    state.examDraft.data.passages ||= [];
    if (state.examDraft.data.passages.some((passage) => String(passage.id) === id)) {
      return showToast("Mã đoạn dữ kiện đã tồn tại. Hãy dùng mã khác.");
    }
    state.examDraft.data.passages.push({ id, title, content });
    $("#passage-id-input").value = "";
    $("#passage-title-input").value = "";
    $("#passage-content-input").value = "";
    renderDraftPassageList();
    renderQuestionBuilderFields();
    showToast("Đã thêm đoạn dữ kiện dùng chung.");
  }

  function renderDraftPassageList() {
    const container = $("#draft-passage-list");
    if (!container) return;
    const passages = state.examDraft?.data?.passages || [];
    if (!passages.length) {
      container.innerHTML = `<p class="field-hint passage-empty">Chưa có đoạn dữ kiện dùng chung.</p>`;
      return;
    }
    container.innerHTML = passages.map((passage) => `
      <details class="draft-passage-item">
        <summary><strong>${escapeHtml(passage.title || passage.id)}</strong><span>${String(passage.content || "").length.toLocaleString("vi-VN")} ký tự</span></summary>
        <div class="draft-passage-full">${renderLongText(passage.content)}</div>
        <button class="danger-button compact-question-delete" type="button" data-delete-passage-id="${escapeHtml(String(passage.id))}">Xóa đoạn dữ kiện</button>
      </details>`).join("");
    $$('[data-delete-passage-id]').forEach((button) => button.addEventListener("click", () => deletePassageFromDraft(button.dataset.deletePassageId)));
  }

  function deletePassageFromDraft(passageId) {
    if (!state.examDraft) return;
    const usedCount = buildExamItems(state.examDraft.data).filter((item) => String(item.question?.passageId || "") === String(passageId)).length;
    if (usedCount && !window.confirm(`Đoạn dữ kiện đang được ${usedCount} câu sử dụng. Xóa đoạn này và bỏ liên kết khỏi các câu?`)) return;
    state.examDraft.data.passages = (state.examDraft.data.passages || []).filter((passage) => String(passage.id) !== String(passageId));
    [state.examDraft.data.mcq, state.examDraft.data.trueFalse, state.examDraft.data.shortAnswer].forEach((questions) => {
      (questions || []).forEach((question) => {
        if (String(question.passageId || "") === String(passageId)) question.passageId = "";
      });
    });
    renderDraftPassageList();
    renderQuestionBuilderFields();
    showToast("Đã xóa đoạn dữ kiện.");
  }

  function bindAutoGrowTextareas() {
    $$('textarea[data-auto-grow]').forEach((textarea) => {
      const resize = () => {
        textarea.style.height = "auto";
        textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 96), 720)}px`;
      };
      if (!textarea.dataset.autoGrowBound) {
        textarea.addEventListener("input", resize);
        textarea.dataset.autoGrowBound = "true";
      }
      resize();
    });
  }

  function renderDraftQuestionList() {
    const container = $("#draft-question-list");
    if (!state.examDraft) {
      container.innerHTML = "";
      return;
    }
    const items = buildExamItems(state.examDraft.data);
    if (!items.length) {
      container.innerHTML = `<div class="empty-state"><strong>Đề chưa có câu hỏi</strong><p>Chọn loại câu hỏi và thêm từng câu ở phía trên.</p></div>`;
      return;
    }
    container.innerHTML = items.map((item) => {
      const fullText = item.type === "tf" ? item.question.context : item.question.stem;
      const passage = (state.examDraft.data.passages || []).find((entry) => String(entry.id) === String(item.question.passageId || ""));
      return `
        <article class="draft-question-item long-question-item">
          <details>
            <summary><span>${typeLabel(item.type)} · Câu ${item.number}</span><strong>${escapeHtml(truncate(fullText, 180))}</strong></summary>
            ${passage ? `<p class="draft-linked-passage">Dùng đoạn dữ kiện: <strong>${escapeHtml(passage.title || passage.id)}</strong></p>` : ""}
            <div class="draft-question-full">${renderLongText(fullText)}</div>
          </details>
          <button class="danger-button compact-question-delete" type="button" data-delete-question-type="${item.type}" data-delete-question-id="${item.question.id}">Xóa</button>
        </article>`;
    }).join("");
    $$('[data-delete-question-id]').forEach((button) => button.addEventListener("click", () => {
      deleteDraftQuestion(button.dataset.deleteQuestionType, button.dataset.deleteQuestionId);
    }));
  }

  function deleteDraftQuestion(type, questionId) {
    if (!state.examDraft) return;
    const key = type === "mcq" ? "mcq" : type === "tf" ? "trueFalse" : "shortAnswer";
    state.examDraft.data[key] = state.examDraft.data[key].filter((question) => String(question.id) !== String(questionId));
    updateDraftCounts();
    renderDraftQuestionList();
  }

  async function saveExamDraft(publish) {
    if (!state.examDraft || !readMetadataIntoDraft()) return null;
    if (publish && !hasRequiredStructure(state.examDraft.data)) {
      showToast("Muốn xuất bản, đề phải đủ 18 câu lựa chọn, 4 câu Đúng/Sai và 6 câu trả lời ngắn.");
      return null;
    }
    if (!window.supabaseClient) return null;

    const payload = {
      code: state.examDraft.code,
      title: state.examDraft.title,
      description: state.examDraft.description,
      duration_minutes: state.examDraft.durationMinutes,
      grade_level: "THPT",
      is_published: Boolean(publish),
      exam_data: state.examDraft.data,
      updated_at: new Date().toISOString()
    };

    const button = publish ? $("#publish-exam-button") : $("#save-exam-draft-button");
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Đang lưu...";

    try {
      let query;
      if (state.examDraft.id) query = window.supabaseClient.from("exams").update(payload).eq("id", state.examDraft.id).select().single();
      else query = window.supabaseClient.from("exams").insert({ ...payload, created_by: state.teacherUser.id }).select().single();
      const { data, error } = await query;
      if (error) throw error;
      state.examDraft = normalizeExamRow(data);
      await loadTeacherExams();
      await loadPublishedExams();
      showToast(publish ? "Đề đã được xuất bản cho học sinh." : "Đã lưu bản nháp. Nếu đề đang xuất bản, thao tác này sẽ chuyển về bản nháp.");
      return data;
    } catch (error) {
      console.error("Không lưu được đề:", error);
      showToast(error.code === "23505" ? "Mã đề đã tồn tại. Hãy dùng mã khác." : `Không lưu được đề: ${error.message || "Lỗi không xác định"}`);
      return null;
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  async function handlePublishExam() {
    if (!state.examDraft) return;
    if (state.examDraft.isPublished && state.examDraft.id) {
      const { error } = await window.supabaseClient.from("exams").update({ is_published: false, updated_at: new Date().toISOString() }).eq("id", state.examDraft.id);
      if (error) {
        showToast(`Không thể gỡ xuất bản: ${error.message}`);
        return;
      }
      state.examDraft.isPublished = false;
      await loadTeacherExams();
      await loadPublishedExams();
      showToast("Đã gỡ đề khỏi kho đề học sinh.");
      return;
    }
    await saveExamDraft(true);
  }

  async function deleteCurrentExam() {
    if (!state.examDraft?.id) return;
    if (!window.confirm(`Xóa vĩnh viễn đề ${state.examDraft.code}? Các điểm đã lưu vẫn được giữ lại.`)) return;
    const { error } = await window.supabaseClient.from("exams").delete().eq("id", state.examDraft.id);
    if (error) {
      showToast(`Không thể xóa đề: ${error.message}`);
      return;
    }
    state.examDraft = null;
    renderExamEditor();
    await loadTeacherExams();
    await loadPublishedExams();
    showToast("Đã xóa đề.");
  }

  async function seedDefaultExam() {
    if (!window.EXAM_DATA && typeof EXAM_DATA === "undefined") {
      showToast("Không tìm thấy dữ liệu đề mẫu trong data.js.");
      return;
    }
    const sample = typeof EXAM_DATA !== "undefined" ? EXAM_DATA : window.EXAM_DATA;
    const existing = state.teacherExams.find((exam) => exam.code === "VL-THPT-01");
    if (existing) {
      setExamDraftFromExam(existing);
      showToast("Đề mẫu số 01 đã có trong Supabase.");
      return;
    }

    const payload = {
      code: "VL-THPT-01",
      title: sample.title || "Đề luyện tổng hợp Vật lí THPT số 01",
      description: "Đề luyện tổng hợp theo cấu trúc mới gồm 18 câu nhiều lựa chọn, 4 câu Đúng/Sai và 6 câu trả lời ngắn.",
      duration_minutes: Number(sample.durationMinutes || 50),
      grade_level: "THPT",
      is_published: true,
      exam_data: sample,
      created_by: state.teacherUser.id,
      updated_at: new Date().toISOString()
    };

    const button = $("#seed-default-exam-button");
    button.disabled = true;
    button.textContent = "Đang đưa đề mẫu lên...";
    try {
      const { data, error } = await window.supabaseClient.from("exams").insert(payload).select().single();
      if (error) throw error;
      state.examDraft = normalizeExamRow(data);
      await loadTeacherExams();
      await loadPublishedExams();
      showToast("Đã đưa đề mẫu số 01 lên Supabase và xuất bản.");
    } catch (error) {
      console.error("Không tạo được đề mẫu:", error);
      showToast(`Không tạo được đề mẫu: ${error.message || "Lỗi không xác định"}`);
    } finally {
      button.disabled = false;
      button.textContent = "Đưa đề mẫu số 01 lên Supabase";
    }
  }

  function exportCsv() {
    const results = state.dashboardResults;
    if (!results.length) return showToast("Chưa có dữ liệu để xuất.");
    const rows = [
      ["Họ và tên", "Lớp", "Mã đề", "Phần I", "Phần II", "Phần III", "Tổng điểm", "Thời gian (giây)", "Ngày làm"],
      ...results.map((result) => [result.name, result.className, result.examCode, result.part1, result.part2, result.part3, result.score, result.timeUsedSeconds, formatDate(result.submittedAt)])
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
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
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
    const value = String(text || "");
    return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" }[character]));
  }

  function normalizeLatexEscapes(value) {
    let text = String(value ?? "");

    // Một số vòng JSON/AI có thể làm backslash bị nhân đôi. Chỉ thu gọn
    // trước các lệnh LaTeX quen thuộc để không phá ký tự xuống dòng hợp lệ.
    text = text.replace(
      /\\\\(?=(?:\(|\)|\[|\]|,|;|!|quad\b|qquad\b|mathrm\b|text\b|frac\b|sqrt\b|cdot\b|times\b|circ\b|Delta\b|lambda\b|rho\b|alpha\b|beta\b|omega\b|mu\b|vec\b|left\b|right\b|pm\b|le\b|ge\b|neq\b|approx\b))/g,
      "\\"
    );

    // OCR/LLM đôi lúc tạo \^ thay vì ^.
    text = text.replace(/\\\^/g, "^");
    return text;
  }

  function protectMathSegments(text) {
    const segments = [];
    const masked = String(text).replace(/\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g, (match) => {
      const token = `@@PHYSICS_MATH_${segments.length}@@`;
      segments.push(match);
      return token;
    });
    return { masked, segments };
  }

  function restoreMathSegments(text, segments) {
    return String(text).replace(/@@PHYSICS_MATH_(\d+)@@/g, (_, index) => segments[Number(index)] || "");
  }

  function wrapLooseLatex(value) {
    let text = normalizeLatexEscapes(value);
    const { masked, segments } = protectMathSegments(text);
    text = masked;

    // Sửa các mảnh LaTeX phổ biến AI đã tạo nhưng quên bọc \(...\).
    // Mục tiêu là cứu dữ liệu cũ; dữ liệu import mới vẫn phải có delimiter chuẩn.
    text = text.replace(
      /([+-]?\d+(?:[.,]\d+)?(?:\\,)?\s*\^\{\\circ\}\\mathrm\{C\})/g,
      "\\($1\\)"
    );

    text = text.replace(
      /((?:[A-Za-z][A-Za-z0-9_{}]*\s*=\s*)?[+-]?\d+(?:[.,]\d+)?(?:\\(?:cdot|times)\s*10\^\{?-?\d+\}?)?(?:\\,)?\\mathrm\{[^{}]+\})/g,
      "\\($1\\)"
    );

    text = text.replace(
      /([+-]?\d+(?:[.,]\d+)?\\(?:cdot|times)\s*10\^\{?-?\d+\}?)/g,
      "\\($1\\)"
    );

    return restoreMathSegments(text, segments);
  }

  function cleanupInlineDisplayText(value) {
    return wrapLooseLatex(
      String(value ?? "")
        .replace(/\r/g, "")
        .replace(/\u00a0/g, " ")
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .replace(/[ \t]*\n[ \t]*/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    );
  }

  function cleanupOptionText(value, optionIndex = -1) {
    let raw = normalizeLatexEscapes(
      String(value ?? "")
        .replace(/\r/g, "")
        .replace(/\u00a0/g, " ")
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .trim()
    );

    if (!raw) return "";

    const expectedLetter = optionIndex >= 0 ? String.fromCharCode(65 + optionIndex) : "";
    const stripLabel = (line) => {
      let cleaned = String(line || "").trim();
      if (expectedLetter) {
        cleaned = cleaned.replace(new RegExp(`^\\s*${expectedLetter}\\s*[.\\):\\]-]\\s*`, "i"), "");
      }
      return cleaned.replace(/^\s*[A-D]\s*[.\):\]-]\s*/i, "").trim();
    };

    const lines = raw.split("\n").map(stripLabel).filter(Boolean);
    if (lines.length <= 1) return wrapLooseLatex(lines[0] || raw);

    let result = "";
    for (const line of lines) {
      if (!result) {
        result = line;
        continue;
      }

      // Nối các chữ số OCR bị tách thành 7 / 4 / 0 hoặc 2 / 9 / 1.
      if (/^[+-]?\d+$/.test(result) && /^\d+$/.test(line)) {
        result += line;
        continue;
      }

      // Nối phần thập phân bị tách kiểu 24, / 5.
      if (/\d[,.]$/.test(result) && /^\d+$/.test(line)) {
        result += line;
        continue;
      }

      // Nối đơn vị bị OCR tách từng ký tự: m / l -> ml, K / . -> K.
      if (/[A-Za-z]$/.test(result) && /^[A-Za-z]$/.test(line)) {
        result += line;
        continue;
      }

      if (/^[,.;:%)\]}°]/.test(line)) {
        result += line;
        continue;
      }

      result += ` ${line}`;
    }

    result = result
      .replace(/\s+/g, " ")
      .replace(/\s+([,.;:%)\]}])/g, "$1")
      .replace(/([({\[])\s+/g, "$1")
      .replace(/(\d)\s*°\s*C\b/gi, "$1°C")
      .replace(/(\d)\s*°\s*K\b/gi, "$1°K")
      .replace(/(\d)(ml|mL|kg|g|K|J|N|Pa|W|s)\b/g, "$1 $2")
      .trim();

    return wrapLooseLatex(result);
  }

  function renderMathContent(rootElement) {
    if (!rootElement || typeof window.renderMathInElement !== "function") return;
    try {
      window.renderMathInElement(rootElement, {
        delimiters: [
          { left: "\\[", right: "\\]", display: true },
          { left: "\\(", right: "\\)", display: false }
        ],
        throwOnError: false,
        strict: false,
        trust: false,
        ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"]
      });
    } catch (error) {
      console.error("Không render được công thức KaTeX:", error);
    }
  }

  function renderLongText(value) {
    return escapeHtml(wrapLooseLatex(value)).replace(/\r?\n/g, "<br>");
  }

  function parsePipeTableRow(line) {
    const parts = String(line || "").trim().split("|").map((cell) => cell.trim());
    if (parts[0] === "") parts.shift();
    if (parts[parts.length - 1] === "") parts.pop();
    return parts;
  }

  function isMarkdownSeparatorRow(cells) {
    return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(String(cell).trim()));
  }

  function isPipeTableStart(lines, index) {
    if (index + 1 >= lines.length) return false;
    const first = parsePipeTableRow(lines[index]);
    const second = parsePipeTableRow(lines[index + 1]);
    const firstPipeCount = (String(lines[index]).match(/\|/g) || []).length;
    const secondPipeCount = (String(lines[index + 1]).match(/\|/g) || []).length;
    return firstPipeCount >= 2 && secondPipeCount >= 2 && first.length >= 3 && second.length === first.length;
  }

  function renderRichContent(value) {
    const text = String(value ?? "").replace(/\r/g, "").trim();
    if (!text) return "";

    const lines = text.split("\n");
    const blocks = [];
    let paragraphLines = [];

    const flushParagraph = () => {
      while (paragraphLines.length && !paragraphLines[0].trim()) paragraphLines.shift();
      while (paragraphLines.length && !paragraphLines[paragraphLines.length - 1].trim()) paragraphLines.pop();
      if (!paragraphLines.length) return;
      blocks.push(`<div class="rich-text-paragraph">${renderLongText(paragraphLines.join("\n"))}</div>`);
      paragraphLines = [];
    };

    for (let index = 0; index < lines.length;) {
      if (!isPipeTableStart(lines, index)) {
        paragraphLines.push(lines[index]);
        index += 1;
        continue;
      }

      let caption = "";
      const precedingLine = String(paragraphLines[paragraphLines.length - 1] || "").trim();
      if (/^bảng(?:\s+.*)?[:：]?$/i.test(precedingLine)) {
        paragraphLines.pop();
        caption = precedingLine.replace(/[:：]\s*$/, "").trim();
        if (caption.toLowerCase() === "bảng") caption = "Bảng số liệu";
      }

      flushParagraph();
      const header = parsePipeTableRow(lines[index]);
      const rows = [];
      index += 1;

      if (index < lines.length) {
        const possibleSeparator = parsePipeTableRow(lines[index]);
        if (possibleSeparator.length === header.length && isMarkdownSeparatorRow(possibleSeparator)) index += 1;
      }

      while (index < lines.length) {
        const rawLine = lines[index];
        const pipeCount = (String(rawLine).match(/\|/g) || []).length;
        const row = parsePipeTableRow(rawLine);
        if (pipeCount < 2 || row.length !== header.length) break;
        rows.push(row);
        index += 1;
      }

      if (rows.length) {
        blocks.push(renderPhysicsTable({ caption, headers: header, rows }));
      } else {
        paragraphLines.push(header.join(" | "));
      }
    }

    flushParagraph();
    return blocks.join("");
  }

  let toastTimeout;
  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(toastTimeout);
    toastTimeout = window.setTimeout(() => toast.classList.remove("show"), 3200);
  }

  document.addEventListener("DOMContentLoaded", initialize);

async function loadPhysicsPdf(file) {
  if (!file) {
    throw new Error("Chưa chọn file PDF.");
  }

  const pdfjsLib = await window.pdfJsReady;

  if (!pdfjsLib) {
    throw new Error("PDF.js chưa sẵn sàng.");
  }

  const arrayBuffer = await file.arrayBuffer();

  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer)
  }).promise;

  console.log(`✅ PDF có ${pdf.numPages} trang`);

  return pdf;
}


async function renderPhysicsPdfPage(
  pdf,
  pageNumber,
  scale = 2
) {
  const page = await pdf.getPage(pageNumber);

  const viewport = page.getViewport({
    scale
  });

  const canvas = document.createElement("canvas");

  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);

  const ctx = canvas.getContext("2d", {
    alpha: false
  });

  await page.render({
    canvasContext: ctx,
    viewport
  }).promise;

  return canvas;
}

window.loadPhysicsPdf = loadPhysicsPdf;
window.renderPhysicsPdfPage = renderPhysicsPdfPage;
})();

function getVisualSignature(visual) {
  if (!visual || typeof visual !== "object") return "";

  if (visual.type === "table") {
    return JSON.stringify({
      type: "table",
      headers: visual.headers || [],
      rows: visual.rows || []
    })
      .toLowerCase()
      .replace(/\s+/g, "");
  }

  if (visual.type === "chart") {
    return JSON.stringify({
      type: "chart",
      chartType: visual.chartType || "",
      labels: visual.labels || [],
      datasets: visual.datasets || []
    })
      .toLowerCase()
      .replace(/\s+/g, "");
  }

  return JSON.stringify(visual);
}
