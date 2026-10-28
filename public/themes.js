export const themes = [
  {
    id: "original",
    name: "家計森林",
    note: "原有綠色 · 溫暖清爽",
    side: "#fcfdf9",
    page: "#f5f6f2",
    surface: "#ffffff",
    ink: "#233c36",
    muted: "#65756b",
    accent: "#205747",
    secondary: "#78986b",
    soft: "#e8efe6",
    line: "#dce4d9",
  },
  {
    id: "coast",
    name: "珊瑚海岸",
    note: "深海藍 × 珊瑚橘",
    side: "#17364b",
    page: "#fff8f2",
    surface: "#ffffff",
    ink: "#263e49",
    muted: "#657c80",
    accent: "#b34b36",
    secondary: "#238477",
    soft: "#eef7f5",
    line: "#d9e6e3",
  },
  {
    id: "garden",
    name: "花園派對",
    note: "森林綠 × 莓果紅",
    side: "#233f38",
    page: "#fbf9ef",
    surface: "#ffffff",
    ink: "#34453b",
    muted: "#717965",
    accent: "#a33664",
    secondary: "#357a66",
    soft: "#f5edf3",
    line: "#e4dfd3",
  },
  {
    id: "studio",
    name: "創意工坊",
    note: "靛紫 × 孔雀藍",
    side: "#302b50",
    page: "#f7f7fc",
    surface: "#ffffff",
    ink: "#353951",
    muted: "#70768e",
    accent: "#126f80",
    secondary: "#7953a5",
    soft: "#edf5f6",
    line: "#dce1ed",
  },
  {
    id: "sunset",
    name: "日落沙丘",
    note: "酒紅 × 靛藍",
    side: "#492b3b",
    page: "#fff8ef",
    surface: "#ffffff",
    ink: "#453540",
    muted: "#7f6977",
    accent: "#365ca8",
    secondary: "#a44c66",
    soft: "#f1edf7",
    line: "#e7dce2",
  },
  {
    id: "mint",
    name: "薄荷糖果",
    note: "深青綠 × 覆盆莓",
    side: "#17484b",
    page: "#f3fbf7",
    surface: "#ffffff",
    ink: "#29464b",
    muted: "#607c7a",
    accent: "#a83e70",
    secondary: "#327fc0",
    soft: "#f9edf4",
    line: "#d6e8e1",
  },
  {
    id: "nordic",
    name: "北歐拼色",
    note: "霧藍 × 磚紅",
    side: "#2e4055",
    page: "#faf8f3",
    surface: "#ffffff",
    ink: "#384555",
    muted: "#6d7881",
    accent: "#ac4937",
    secondary: "#697536",
    soft: "#f0f2e6",
    line: "#e0e2d6",
  },
  {
    id: "midnight",
    name: "極光夜色",
    note: "午夜藍 × 薄荷青 · 深色",
    side: "#11182b",
    page: "#141d32",
    surface: "#1d263c",
    ink: "#e8eaf5",
    muted: "#b4bdd7",
    accent: "#89daca",
    secondary: "#c2a6f2",
    soft: "#30354d",
    line: "#46506d",
    dark: true,
  },
];
export function readTheme(storage, key) {
  try {
    return themes.find((t) => t.id === storage.getItem(key)) || themes[0];
  } catch {
    return themes[0];
  }
}
let user,
  current = themes[0],
  dialog,
  trigger;
const key = () => `kinfolio-theme:${user || "guest"}`;
function apply(theme) {
  current = theme;
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  root.style.colorScheme = theme.dark ? "dark" : "light";
  const variables = {
    ...theme,
    subsurface: theme.id === "original" ? "#fcfdf9" : theme.surface,
    "on-accent": theme.dark ? "#122d2a" : "#ffffff",
    "side-text": theme.id === "original" ? "#233c36" : "#e8edf5",
    "side-muted": theme.id === "original" ? "#65756b" : "#b9cbd8",
    chart: theme.secondary,
    "chart-cost": theme.dark ? "#a6b6cd" : "#8a9580",
    positive: theme.dark ? "#8cd8ad" : "#287e62",
    red: theme.dark ? "#ffa4a4" : "#b34f4f",
    green: theme.dark ? "#8cd8ad" : "#205747",
    highlight: theme.secondary,
  };
  for (const [name, value] of Object.entries(variables))
    if (typeof value === "string" && value.startsWith("#"))
      root.style.setProperty("--" + name, value);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme.side);
  document.querySelectorAll("[data-theme-name]").forEach((el) => {
    el.textContent = theme.name;
  });
  dialog
    ?.querySelectorAll("[data-theme-choice]")
    .forEach((el) =>
      el.setAttribute(
        "aria-pressed",
        String(el.dataset.themeChoice === theme.id),
      ),
    );
}
export function setThemeUser(id) {
  if (user === id) return;
  user = id;
  try {
    apply(readTheme(localStorage, key()));
  } catch {
    apply(themes[0]);
  }
  if (dialog?.open) dialog.close();
}
export function themeTrigger() {
  return `<button class="theme-trigger" data-action="theme" aria-haspopup="dialog"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 0-4h-1a1.5 1.5 0 0 1 0-3h3a6 6 0 0 0 0-11Z"/><circle cx="7" cy="10" r="1"/><circle cx="10" cy="6" r="1"/><circle cx="15" cy="7" r="1"/></svg><span>主題配色<small data-theme-name>${current.name}</small></span><i aria-hidden="true"></i></button>`;
}
function openThemes(button) {
  trigger = button;
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.className = "theme-dialog";
    dialog.setAttribute("aria-labelledby", "theme-title");
    dialog.innerHTML = `<div class="theme-heading"><div><p>YOUR KINFOLIO, YOUR COLORS</p><h2 id="theme-title">選擇你的主題配色</h2></div><button data-theme-close aria-label="關閉主題配色">×</button></div><p class="theme-description">點選立即套用，讓家計更合你的喜好。</p><div class="theme-options" role="group" aria-label="主題配色">${themes.map((t) => `<button class="theme-option" data-theme-choice="${t.id}" aria-pressed="${current.id === t.id}"><span class="theme-preview" style="background:${t.page}" aria-hidden="true"><span style="background:${t.side}"><i style="background:${t.secondary}"></i></span><span><i style="background:${t.accent}"></i><i style="background:${t.secondary}"></i><i style="background:${t.surface};border:1px solid ${t.line}"></i></span></span><strong>${t.name}<span class="theme-check" aria-hidden="true">✓</span></strong><small>${t.note}</small></button>`).join("")}</div><div class="theme-footer"><small>配色依帳號記在目前瀏覽器中。</small><button class="button primary" data-theme-close>完成</button></div><p class="theme-save-status" role="status"></p>`;
    document.body.append(dialog);
    dialog.addEventListener("click", (e) => {
      const choice = e.target.closest("[data-theme-choice]");
      if (choice) {
        apply(themes.find((t) => t.id === choice.dataset.themeChoice));
        let message = "";
        try {
          localStorage.setItem(key(), current.id);
        } catch {
          message = "已套用配色，但瀏覽器無法儲存，重新整理後會恢復預設。";
        }
        dialog.querySelector(".theme-save-status").textContent = message;
      }
      if (e.target.closest("[data-theme-close]")) dialog.close();
    });
    let backdrop = false;
    const outside = (e) => {
      const r = dialog.getBoundingClientRect();
      return (
        e.target === dialog &&
        (e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom)
      );
    };
    dialog.addEventListener("pointerdown", (e) => {
      backdrop = e.button === 0 && outside(e);
    });
    dialog.addEventListener("pointercancel", () => {
      backdrop = false;
    });
    dialog.addEventListener("click", (e) => {
      if (backdrop && outside(e)) dialog.close();
      backdrop = false;
    });
    dialog.addEventListener("close", () => {
      backdrop = false;
      const target = trigger?.isConnected
        ? trigger
        : document.querySelector('[data-action="theme"]');
      target?.focus();
    });
  }
  apply(current);
  dialog.showModal();
}
if (typeof document !== "undefined") {
  document.addEventListener("click", (e) => {
    const button = e.target.closest('[data-action="theme"]');
    if (button) openThemes(button);
  });
  window.addEventListener("storage", (e) => {
    if (e.key === key() || e.key === null) {
      try {
        apply(readTheme(localStorage, key()));
      } catch {
        apply(themes[0]);
      }
    }
  });
}
