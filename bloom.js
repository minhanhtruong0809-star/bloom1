const SUPABASE_URL = "https://kmitbuuuzpajmilbgans.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_y9uEs3oSFqViXTT4WbSpWg_DXZbyl21";
const API_BASE = "/api";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

const $ = (id) => document.getElementById(id);

let currentUser = null;
let appData = {};
let saveTimer = null;
let breathTimer = null;
let breathRunning = false;
let breathStep = 0;
let breathRemaining = 4;
let calendarDate = new Date();
let currentRating = 0;
let sleepRating = 0;
let selectedImageUrls = [];
let journalUnlocked = true;

const quotes = [
  ["Bloom where you are planted.", "Saint Francis de Sales"],
  ["Almost everything will work again if you unplug it for a few minutes, including you.", "Anne Lamott"],
  ["You are allowed to be both a masterpiece and a work in progress.", "Sophia Bush"],
  ["Small steps every day add up.", "Unknown"],
  ["Be gentle with yourself. You are doing the best you can.", "Unknown"]
];

const affirmations = [
  "I am worthy of love and peace.",
  "I can grow at my own pace.",
  "I give myself permission to rest.",
  "I am allowed to begin again.",
  "My progress matters, even when it is small."
];

const prompts = [
  "What made me smile today?",
  "What is one thing I learned about myself?",
  "What do I need more of this week?",
  "What is something I am proud of?",
  "What can I let go of today?"
];

function defaultData() {
  return {
    goals: [],
    entries: [],
    journalText: "",
    gratitude: [],
    rating: 0,
    water: 0,
    markedDays: [],
    sleep: { bed: "22:30", wake: "06:45", rating: 0, notes: "" },
    widgetsHidden: [],
    widgetsRemoved: [],
    quoteIndex: 0,
    affirmationIndex: 0
  };
}

function mergeData(saved) {
  const defaults = defaultData();
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) {
    return defaults;
  }

  return {
    ...defaults,
    ...saved,
    goals: Array.isArray(saved.goals) ? saved.goals : [],
    entries: Array.isArray(saved.entries) ? saved.entries : [],
    gratitude: Array.isArray(saved.gratitude) ? saved.gratitude : [],
    markedDays: Array.isArray(saved.markedDays) ? saved.markedDays : [],
    widgetsHidden: Array.isArray(saved.widgetsHidden) ? saved.widgetsHidden : [],
    widgetsRemoved: Array.isArray(saved.widgetsRemoved) ? saved.widgetsRemoved : [],
    sleep: { ...defaults.sleep, ...(saved.sleep || {}) }
  };
}

function showAuthMessage(message) {
  const el = $("auth-error");
  if (el) el.textContent = message;
}

function setAuthMode(mode) {
  const signup = mode === "signup";

  if ($("login-form")) $("login-form").style.display = signup ? "none" : "block";
  if ($("signup-form")) $("signup-form").style.display = signup ? "block" : "none";

  document.querySelectorAll(".auth-tab").forEach((tab, index) => {
    tab.classList.toggle("active", index === (signup ? 1 : 0));
  });

  showAuthMessage("");
}

async function doSignup() {
  const name = $("s-name")?.value.trim();
  const email = $("s-email")?.value.trim();
  const password = $("s-pass")?.value;

  if (!name || !email || !password) {
    showAuthMessage("Please fill in all fields.");
    return;
  }

  if (password.length < 6) {
    showAuthMessage("Password must be at least 6 characters.");
    return;
  }

  showAuthMessage("Creating your account...");

  try {
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: { name },
        emailRedirectTo: `${location.origin}/main.html`
      }
    });

    if (error) throw error;

    if (data.session) {
      await enterApp(data.user);
    } else {
      showAuthMessage(
        "Account created! Check your email to confirm your account, then sign in."
      );
    }
  } catch (error) {
    showAuthMessage(error.message || "Could not create account.");
  }
}

async function doLogin() {
  const email = $("l-email")?.value.trim();
  const password = $("l-pass")?.value;

  if (!email || !password) {
    showAuthMessage("Please enter your email and password.");
    return;
  }

  showAuthMessage("Signing in...");

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;
    await enterApp(data.user);
  } catch (error) {
    showAuthMessage(error.message || "Could not sign in.");
  }
}

async function doLogout() {
  stopBreath();

  try {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;

    currentUser = null;
    appData = defaultData();

    $("app").style.display = "none";
    $("auth-screen").style.display = "flex";
    setAuthMode("login");
  } catch (error) {
    toast("⚠️", "Sign out failed", error.message);
  }
}

async function apiRequest(method, body) {
  const { data: sessionData, error: sessionError } =
    await supabaseClient.auth.getSession();

  if (sessionError) throw sessionError;

  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Your session has expired. Please sign in again.");

  const response = await fetch(`${API_BASE}/data`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result.error || `Server error (${response.status}).`);
  }

  return result;
}

async function loadCloudData() {
  try {
    const result = await apiRequest("GET");
    appData = mergeData(result.data);
    renderAll();
  } catch (error) {
    console.error("[Bloom cloud read]", error);
    toast("⚠️", "Cloud data unavailable", error.message);
  }
}

async function saveCloudData() {
  if (!currentUser) return;

  try {
    await apiRequest("PUT", { data: appData });
    const status = $("j-autosave");
    if (status) status.textContent = "Saved to cloud ✓";
  } catch (error) {
    console.error("[Bloom cloud save]", error);
    const status = $("j-autosave");
    if (status) status.textContent = "Cloud save failed";
    toast("⚠️", "Could not save", error.message);
  }
}

function scheduleSave() {
  if (!currentUser) return;

  const status = $("j-autosave");
  if (status) status.textContent = "Saving...";

  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveCloudData, 700);
}

async function enterApp(user) {
  currentUser = user;

  $("auth-screen").style.display = "none";
  $("app").style.display = "block";

  const name = user.user_metadata?.name || user.email?.split("@")[0] || "friend";
  if ($("greet-name")) $("greet-name").textContent = name;

  const now = new Date();
  if ($("greet-time")) {
    $("greet-time").textContent =
      now.getHours() < 12 ? "morning" : now.getHours() < 18 ? "afternoon" : "evening";
  }
  if ($("home-date")) {
    $("home-date").textContent = now.toLocaleDateString(undefined, {
      weekday: "long", month: "long", day: "numeric", year: "numeric"
    });
  }

  await loadCloudData();
}

function goPage(page, button) {
  document.querySelectorAll(".page").forEach((el) => el.classList.remove("active"));
  document.querySelectorAll(".nt").forEach((el) => el.classList.remove("active"));

  const pageEl = $(`page-${page}`);
  if (pageEl) pageEl.classList.add("active");

  if (button) button.classList.add("active");

  if (page === "wellness") {
    renderCalendar();
    calcSleep();
  }
}

function renderAll() {
  renderGoals();
  renderEntries();
  renderGratitude();
  renderRating();
  renderCalendar();
  renderWater();
  renderSleep();
  renderQuote();
  renderAffirmation();
  renderSummary();
  renderWidgets();

  if ($("j-text")) $("j-text").value = appData.journalText || "";
}

function renderSummary() {
  const goals = appData.goals || [];
  const done = goals.filter((g) => g.done).length;

  if ($("sum-tasks-title")) {
    $("sum-tasks-title").textContent = `${done} of ${goals.length} done`;
  }
  if ($("sum-tasks-detail")) {
    $("sum-tasks-detail").textContent =
      goals.length ? `${goals.length - done} goals remaining` : "Add your first goal";
  }
  if ($("sum-tasks-bar")) {
    $("sum-tasks-bar").style.width =
      `${goals.length ? (done / goals.length) * 100 : 0}%`;
  }

  const today = new Date().toDateString();
  const todayEntry = appData.entries.find(
    (entry) => new Date(entry.date).toDateString() === today
  );

  if ($("sum-journal-title")) {
    $("sum-journal-title").textContent = todayEntry ? "Entry saved" : "Not written yet";
  }
  if ($("sum-journal-detail")) {
    $("sum-journal-detail").textContent =
      todayEntry ? "Your thoughts are saved" : "Tap to open your journal";
  }
  if ($("sum-journal-bar")) {
    $("sum-journal-bar").style.width = todayEntry ? "100%" : "0%";
  }

  if ($("sum-well-title")) {
    $("sum-well-title").textContent = `${appData.water || 0} / 8 cups`;
  }
  if ($("sum-well-detail")) {
    $("sum-well-detail").textContent = "Hydration · Sleep · Breathing";
  }
  if ($("sum-well-bar")) {
    $("sum-well-bar").style.width = `${Math.min(100, (appData.water || 0) / 8 * 100)}%`;
  }
}

function openAddGoal() {
  openModal("Add a goal", `
    <div class="fl">
      <label>Goal title</label>
      <input class="fi" id="goal-title-input" placeholder="e.g. Read for 20 minutes">
    </div>
    <div class="fl">
      <label>Small description (optional)</label>
      <input class="fi" id="goal-desc-input" placeholder="A little step for today">
    </div>
    <button class="btn btn-rose" onclick="addGoal()">Add goal ✨</button>
  `);
}

function addGoal() {
  const title = $("goal-title-input")?.value.trim();
  const description = $("goal-desc-input")?.value.trim();

  if (!title) {
    toast("🌱", "Add a title", "Please enter a goal first.");
    return;
  }

  appData.goals.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    description,
    done: false,
    createdAt: new Date().toISOString()
  });

  closeModal();
  renderGoals();
  renderSummary();
  scheduleSave();
  toast("🎯", "Goal added", title);
}

function toggleGoal(id) {
  const goal = appData.goals.find((g) => g.id === id);
  if (!goal) return;

  goal.done = !goal.done;
  renderGoals();
  renderSummary();
  scheduleSave();
}

function deleteGoal(id) {
  appData.goals = appData.goals.filter((g) => g.id !== id);
  renderGoals();
  renderSummary();
  scheduleSave();
}

function renderGoals() {
  const container = $("goals-grid");
  if (!container) return;

  if (!appData.goals.length) {
    container.innerHTML = `
      <div class="widget">
        <div class="widget-body">
          <p>No goals yet. Start small 🌱</p>
          <button class="btn btn-rose" onclick="openAddGoal()">+ Add your first goal</button>
        </div>
      </div>`;
    return;
  }

  container.innerHTML = appData.goals.map((goal) => `
    <div class="widget goal-card">
      <div class="widget-body">
        <label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer">
          <input type="checkbox" ${goal.done ? "checked" : ""}
            onchange="toggleGoal('${goal.id}')">
          <span style="${goal.done ? "text-decoration:line-through;opacity:.6" : ""}">
            <strong>${escapeHTML(goal.title)}</strong>
            ${goal.description ? `<div>${escapeHTML(goal.description)}</div>` : ""}
          </span>
        </label>
        <button class="wc-btn del" style="margin-top:12px"
          onclick="deleteGoal('${goal.id}')">Delete</button>
      </div>
    </div>
  `).join("");
}

function jAutoSave() {
  appData.journalText = $("j-text")?.value || "";
  scheduleSave();
}

function saveEntry() {
  const text = $("j-text")?.value.trim() || "";

  if (!text) {
    toast("📖", "Nothing to save", "Write a little before saving.");
    return;
  }

  const today = new Date().toDateString();
  const existing = appData.entries.find(
    (entry) => new Date(entry.date).toDateString() === today
  );

  if (existing) {
    existing.text = text;
    existing.rating = currentRating || appData.rating || 0;
    existing.images = selectedImageUrls;
  } else {
    appData.entries.unshift({
      id: `${Date.now()}`,
      date: new Date().toISOString(),
      text,
      rating: currentRating || appData.rating || 0,
      images: selectedImageUrls
    });
  }

  appData.journalText = text;
  renderEntries();
  renderSummary();
  scheduleSave();
  toast("💗", "Entry saved", "Your journal entry has been saved.");
}

function renderEntries() {
  const container = $("past-entries-body");
  if (!container) return;

  if (!appData.entries.length) {
    container.innerHTML = "<p>No past entries yet. Your saved entries will appear here.</p>";
    return;
  }

  container.innerHTML = appData.entries.map((entry) => `
    <div style="padding:12px 0;border-bottom:1px solid var(--line,#eee)">
      <div style="font-size:12px;color:var(--ink-3)">
        ${new Date(entry.date).toLocaleString()}
      </div>
      <div style="white-space:pre-wrap;margin:8px 0">
        ${escapeHTML(entry.text)}
      </div>
      <button class="wc-btn" onclick="loadEntry('${entry.id}')">Open</button>
      <button class="wc-btn del" onclick="deleteEntry('${entry.id}')">Delete</button>
    </div>
  `).join("");
}

function loadEntry(id) {
  const entry = appData.entries.find((e) => e.id === id);
  if (!entry) return;

  if ($("j-text")) $("j-text").value = entry.text;
  appData.journalText = entry.text;
  currentRating = entry.rating || 0;
  renderRating();
  toast("📖", "Entry opened", "You can edit it and save your changes.");
}

function deleteEntry(id) {
  appData.entries = appData.entries.filter((e) => e.id !== id);
  renderEntries();
  renderSummary();
  scheduleSave();
}

function renderRating() {
  const row = $("star-row");
  if (!row) return;

  row.innerHTML = [1, 2, 3, 4, 5].map((n) => `
    <button type="button" aria-label="${n} stars"
      style="border:0;background:none;font-size:26px;cursor:pointer"
      onclick="rateDay(${n})">${n <= currentRating ? "⭐" : "☆"}</button>
  `).join("");

  if ($("rating-label")) {
    $("rating-label").textContent = currentRating
      ? `${currentRating} / 5 — thank you for checking in`
      : "Tap a star to rate";
  }
}

function rateDay(rating) {
  currentRating = rating;
  appData.rating = rating;
  renderRating();
  scheduleSave();
}

function renderGratitude() {
  const container = $("grat-list");
  if (!container) return;

  container.innerHTML = appData.gratitude.map((item, index) => `
    <div style="display:flex;justify-content:space-between;gap:8px;padding:5px 0">
      <span>💗 ${escapeHTML(item)}</span>
      <button class="wc-btn del" onclick="removeGrat(${index})">×</button>
    </div>
  `).join("");
}

function addGrat() {
  const input = $("grat-input");
  const value = input?.value.trim();
  if (!value) return;

  appData.gratitude.push(value);
  input.value = "";
  renderGratitude();
  scheduleSave();
}

function removeGrat(index) {
  appData.gratitude.splice(index, 1);
  renderGratitude();
  scheduleSave();
}

function renderCalendar() {
  const grid = $("cal-grid");
  if (!grid) return;

  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();

  if ($("cal-month-label")) {
    $("cal-month-label").textContent =
      calendarDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }

  const headers = ["S", "M", "T", "W", "T", "F", "S"];
  let html = headers.map((d) => `<div class="cal-day-head">${d}</div>`).join("");

  for (let i = 0; i < firstDay; i++) html += "<div></div>";

  for (let day = 1; day <= days; day++) {
    const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const marked = appData.markedDays.includes(dateKey);

    html += `
      <button type="button" class="cal-day ${marked ? "marked" : ""}"
        onclick="toggleCalendarDay('${dateKey}')">${day}${marked ? " 🟢" : ""}</button>`;
  }

  grid.innerHTML = html;
}

function calMove(delta) {
  calendarDate = new Date(
    calendarDate.getFullYear(),
    calendarDate.getMonth() + delta,
    1
  );
  renderCalendar();
}

function toggleCalendarDay(key) {
  if (appData.markedDays.includes(key)) {
    appData.markedDays = appData.markedDays.filter((d) => d !== key);
  } else {
    appData.markedDays.push(key);
  }

  renderCalendar();
  scheduleSave();
}

function renderWater() {
  if ($("water-num")) $("water-num").textContent = appData.water || 0;

  const row = $("cups-row");
  if (!row) return;

  row.innerHTML = Array.from({ length: 8 }, (_, i) => `
    <button type="button" aria-label="Set water to ${i + 1} cups"
      onclick="setWater(${i + 1})"
      style="border:0;background:none;font-size:24px;cursor:pointer">
      ${(appData.water || 0) > i ? "💧" : "🥛"}
    </button>
  `).join("");
}

function setWater(value) {
  appData.water = value;
  renderWater();
  renderSummary();
  scheduleSave();
}

function resetWater() {
  appData.water = 0;
  renderWater();
  renderSummary();
  scheduleSave();
}

function calcSleep() {
  const bed = $("s-bed")?.value || "22:30";
  const wake = $("s-wake")?.value || "06:45";

  appData.sleep.bed = bed;
  appData.sleep.wake = wake;

  const [bh, bm] = bed.split(":").map(Number);
  const [wh, wm] = wake.split(":").map(Number);

  let minutes = wh * 60 + wm - (bh * 60 + bm);
  if (minutes < 0) minutes += 24 * 60;

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if ($("sleep-dur")) $("sleep-dur").textContent = `${hours}h ${mins}m`;

  if ($("sleep-note")) {
    $("sleep-note").textContent =
      hours >= 7 && hours <= 9
        ? "🌿 A restful amount of sleep"
        : hours < 7
          ? "🌙 Consider making room for more rest"
          : "🌱 Notice how you feel after this amount of sleep";
  }

  scheduleSave();
}

function renderSleep() {
  if ($("s-bed")) $("s-bed").value = appData.sleep.bed || "22:30";
  if ($("s-wake")) $("s-wake").value = appData.sleep.wake || "06:45";
  if ($("dream-input")) $("dream-input").value = appData.sleep.notes || "";

  const stars = $("sleep-stars");
  if (stars) {
    stars.innerHTML = [1, 2, 3, 4, 5].map((n) => `
      <button type="button" onclick="rateSleep(${n})"
        style="border:0;background:none;font-size:24px;cursor:pointer">
        ${n <= (appData.sleep.rating || 0) ? "⭐" : "☆"}
      </button>
    `).join("");
  }

  calcSleep();
}

function rateSleep(value) {
  appData.sleep.rating = value;
  renderSleep();
  scheduleSave();
}

function renderQuote() {
  const item = quotes[(appData.quoteIndex || 0) % quotes.length];
  if ($("hq-text")) $("hq-text").textContent = `"${item[0]}"`;
  if ($("hq-by")) $("hq-by").textContent = `— ${item[1]}`;
}

function nextQuote() {
  appData.quoteIndex = ((appData.quoteIndex || 0) + 1) % quotes.length;
  renderQuote();
  scheduleSave();
}

function renderAffirmation() {
  if ($("aff-text")) {
    $("aff-text").textContent =
      affirmations[(appData.affirmationIndex || 0) % affirmations.length];
  }
}

function nextAff() {
  appData.affirmationIndex =
    ((appData.affirmationIndex || 0) + 1) % affirmations.length;
  renderAffirmation();
  scheduleSave();
}

function renderPrompts() {
  const container = $("prompts-body");
  if (!container) return;

  container.innerHTML = prompts.map((prompt) => `
    <button type="button" class="btn btn-soft btn-mini"
      style="display:block;width:100%;margin:6px 0;text-align:left"
      onclick="usePrompt('${escapeAttribute(prompt)}')">
      ${escapeHTML(prompt)}
    </button>
  `).join("");
}

function usePrompt(prompt) {
  if ($("j-text")) {
    $("j-text").value += ($("j-text").value ? "\n\n" : "") + prompt + "\n";
    jAutoSave();
  }
  goPage("journal", document.querySelectorAll(".nt")[2]);
}

function toggleWidget(id) {
  const el = $(id);
  if (!el) return;

  el.style.display = el.style.display === "none" ? "" : "none";
  const hidden = el.style.display === "none";

  appData.widgetsHidden = appData.widgetsHidden.filter((x) => x !== id);
  if (hidden) appData.widgetsHidden.push(id);

  scheduleSave();
}

function renderWidgets() {
  document.querySelectorAll(".widget[id]").forEach((el) => {
    if (appData.widgetsRemoved.includes(el.id)) {
      el.style.display = "none";
    } else {
      el.style.display = appData.widgetsHidden.includes(el.id) ? "none" : "";
    }
  });
  renderPrompts();
}

function confirmDelete(id, name) {
  openModal(`Remove ${escapeHTML(name)}?`, `
    <p>This will hide this widget from your Bloom page.</p>
    <button class="btn btn-rose" onclick="removeWidget('${escapeAttribute(id)}')">
      Remove widget
    </button>
    <button class="btn btn-soft" onclick="closeModal()">Cancel</button>
  `);
}

function removeWidget(id) {
  if (!appData.widgetsRemoved.includes(id)) appData.widgetsRemoved.push(id);
  closeModal();
  renderWidgets();
  scheduleSave();
}

function restoreWidgets() {
  appData.widgetsRemoved = [];
  appData.widgetsHidden = [];
  renderWidgets();
  scheduleSave();
  toast("🌸", "Widgets restored", "Your widgets are back.");
}

function handleImages(event) {
  const files = Array.from(event.target.files || []);

  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;

    const reader = new FileReader();
    reader.onload = () => {
      selectedImageUrls.push(reader.result);
      renderImages();
    };
    reader.readAsDataURL(file);
  }

  toast("🖼️", "Images selected", "Images are previewed in this browser.");
}

function renderImages() {
  const container = $("img-preview");
  if (!container) return;

  container.innerHTML = selectedImageUrls.map((src, index) => `
    <div style="display:inline-block;margin:5px">
      <img src="${src}" alt="Journal image"
        style="width:100px;height:100px;object-fit:cover;border-radius:10px">
      <button class="wc-btn del" onclick="removeImage(${index})">Remove</button>
    </div>
  `).join("");
}

function removeImage(index) {
  selectedImageUrls.splice(index, 1);
  renderImages();
}

function toggleLock() {
  journalUnlocked = !journalUnlocked;

  if ($("j-lock-overlay")) {
    $("j-lock-overlay").style.display = journalUnlocked ? "none" : "flex";
  }
  if ($("j-text")) $("j-text").readOnly = !journalUnlocked;
  if ($("lock-btn")) $("lock-btn").textContent = journalUnlocked ? "🔓 Lock" : "🔒 Unlock";
  if ($("lock-toggle-btn")) {
    $("lock-toggle-btn").textContent = journalUnlocked ? "🔓 Lock Entry" : "🔒 Unlock Entry";
  }
  if ($("j-pass-hint")) {
    $("j-pass-hint").textContent = journalUnlocked ? "not locked" : "locked";
  }
}

function tryUnlock() {
  journalUnlocked = true;
  if ($("j-lock-overlay")) $("j-lock-overlay").style.display = "none";
  if ($("j-text")) $("j-text").readOnly = false;
  if ($("lock-btn")) $("lock-btn").textContent = "🔓 Lock";
  if ($("lock-toggle-btn")) $("lock-toggle-btn").textContent = "🔓 Lock Entry";
  if ($("j-pass-hint")) $("j-pass-hint").textContent = "not locked";

  toast("🔓", "Journal unlocked", "This is a visual lock only.");
}

function toggleBreath() {
  if (breathRunning) {
    stopBreath();
    if ($("breath-start-btn")) $("breath-start-btn").textContent = "▶ Start";
    if ($("breath-phase")) $("breath-phase").textContent = "Paused";
    return;
  }

  breathRunning = true;
  breathStep = 0;
  breathRemaining = 4;

  if ($("breath-start-btn")) $("breath-start-btn").textContent = "Ⅱ Pause";
  runBreathStep();
}

function runBreathStep() {
  if (!breathRunning) return;

  const phases = [
    { name: "Inhale", seconds: 4 },
    { name: "Hold", seconds: 4 },
    { name: "Exhale", seconds: 6 }
  ];

  const phase = phases[breathStep];

  if ($("breath-phase")) $("breath-phase").textContent = phase.name;
  if ($("breath-num")) $("breath-num").textContent = breathRemaining;

  breathTimer = setTimeout(() => {
    if (!breathRunning) return;

    breathRemaining--;

    if (breathRemaining <= 0) {
      breathStep++;

      if (breathStep >= phases.length) {
        breathStep = 0;
        const count = Number($("breath-cycles")?.textContent || 0) + 1;
        if ($("breath-cycles")) $("breath-cycles").textContent = count;
      }

      breathRemaining = phases[breathStep].seconds;
    }

    runBreathStep();
  }, 1000);
}

function stopBreath() {
  breathRunning = false;
  clearTimeout(breathTimer);
}

function resetBreath() {
  stopBreath();
  breathStep = 0;
  breathRemaining = 4;

  if ($("breath-num")) $("breath-num").textContent = "4";
  if ($("breath-phase")) $("breath-phase").textContent = "Tap to begin";
  if ($("breath-cycles")) $("breath-cycles").textContent = "0";
  if ($("breath-start-btn")) $("breath-start-btn").textContent = "▶ Start";
}

function openModal(title, content) {
  if ($("modal-title")) $("modal-title").textContent = title;
  if ($("modal-body")) $("modal-body").innerHTML = content;
  if ($("modal")) $("modal").classList.add("open");
}

function closeModal() {
  if ($("modal")) $("modal").classList.remove("open");
}

function toast(icon, title, message) {
  if ($("t-icon")) $("t-icon").textContent = icon;
  if ($("t-title")) $("t-title").textContent = title;
  if ($("t-msg")) $("t-msg").textContent = message;

  const el = $("toast-el");
  if (!el) return;

  el.classList.add("show");
  clearTimeout(el._toastTimer);
  el._toastTimer = setTimeout(() => el.classList.remove("show"), 3000);
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function escapeAttribute(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

window.addEventListener("DOMContentLoaded", async () => {
  if (!window.supabase) {
    alert("Supabase library did not load. Check your internet connection.");
    return;
  }

  setAuthMode("login");

  const { data, error } = await supabaseClient.auth.getSession();

  if (error) {
    console.error("[Bloom session]", error);
    return;
  }

  if (data.session?.user) {
    await enterApp(data.session.user);
  } else {
    $("auth-screen").style.display = "flex";
    $("app").style.display = "none";
  }

  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      currentUser = null;
      $("app").style.display = "none";
      $("auth-screen").style.display = "flex";
    }
  });
});