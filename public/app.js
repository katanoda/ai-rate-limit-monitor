const POLL_MS_FALLBACK = 2 * 60 * 1000;
let timerId = null;

function formatJst(iso) {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return (
    new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date) + " JST"
  );
}

function barClass(remainingPercent) {
  if (remainingPercent <= 15) return "danger";
  if (remainingPercent <= 40) return "warn";
  return "";
}

function renderWindow(cell, windowData) {
  const usedPercent = Math.max(0, Math.min(100, windowData.usedPercent ?? 0));
  const remainingPercent = Math.round((100 - usedPercent) * 10) / 10;

  cell.innerHTML = "";

  const percentLine = document.createElement("div");
  percentLine.className = "percent-line";
  percentLine.innerHTML = `<span>残り</span><span class="percent-value">${remainingPercent}%</span>`;
  cell.appendChild(percentLine);

  const track = document.createElement("div");
  track.className = "bar-track";
  const fill = document.createElement("div");
  fill.className = `bar-fill ${barClass(remainingPercent)}`.trim();
  fill.style.width = `${remainingPercent}%`;
  track.appendChild(fill);
  cell.appendChild(track);

  const resetLine = document.createElement("div");
  resetLine.className = "reset-line";
  resetLine.textContent = `リセット: ${formatJst(windowData.resetAt)}`;
  cell.appendChild(resetLine);
}

function renderNote(cell, text, isError) {
  cell.innerHTML = "";
  const note = document.createElement("div");
  note.className = isError ? "error-note" : "note";
  note.textContent = text;
  cell.appendChild(note);
}

function renderProvider(row, status) {
  const fiveHourCell = row.querySelector('[data-slot="fiveHour"]');
  const weeklyCell = row.querySelector('[data-slot="weekly"]');

  if (!status) {
    renderNote(fiveHourCell, "データ取得待ち...", false);
    renderNote(weeklyCell, "データ取得待ち...", false);
    return;
  }

  if (status.unsupported) {
    renderNote(fiveHourCell, status.error || "未対応", false);
    renderNote(weeklyCell, status.error || "未対応", false);
    return;
  }

  if (!status.ok) {
    renderNote(fiveHourCell, status.error || "取得失敗", true);
    renderNote(weeklyCell, status.error || "取得失敗", true);
    return;
  }

  if (status.fiveHour) {
    renderWindow(fiveHourCell, status.fiveHour);
  } else {
    renderNote(fiveHourCell, "現在は5時間制限なし", false);
  }

  if (status.weekly) {
    renderWindow(weeklyCell, status.weekly);
  } else {
    renderNote(weeklyCell, "データなし", false);
  }
}

async function refresh() {
  try {
    const res = await fetch("/api/limits", { cache: "no-store" });
    const data = await res.json();

    const updatedEl = document.getElementById("updated");
    updatedEl.textContent = data.updatedAt
      ? `最終更新: ${formatJst(data.updatedAt)}`
      : "取得中...";

    for (const row of document.querySelectorAll(".row")) {
      const provider = row.dataset.provider;
      renderProvider(row, data.providers?.[provider]);
    }

    schedule(data.pollIntervalMs || POLL_MS_FALLBACK);
  } catch (err) {
    document.getElementById("updated").textContent = "サーバーに接続できません";
    schedule(POLL_MS_FALLBACK);
  }
}

function schedule(intervalMs) {
  if (timerId) clearTimeout(timerId);
  timerId = setTimeout(refresh, intervalMs);
}

refresh();
