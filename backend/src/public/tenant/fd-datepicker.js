(function () {
  "use strict";

  const root = typeof window !== "undefined" ? window : globalThis;
  const DAY_MS = 86400000;
  const MONTHS_DA = [
    "januar",
    "februar",
    "marts",
    "april",
    "maj",
    "juni",
    "juli",
    "august",
    "september",
    "oktober",
    "november",
    "december",
  ];
  const WEEKDAYS_DA = ["man", "tir", "ons", "tor", "fre", "lør", "søn"];
  const DECORATION_STYLES = new Set(["range", "disabled", "dot", "underline", "info"]);

  function parseISODate(value) {
    const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
    return { year, month, day };
  }

  function dateKey(date) {
    return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
  }

  function formatISODate(date) {
    const parsed = typeof date === "string" ? parseISODate(date) : date;
    return parsed ? dateKey(parsed) : "";
  }

  function toUtcTime(date) {
    return Date.UTC(date.year, date.month - 1, date.day);
  }

  function fromUtcTime(time) {
    const next = new Date(time);
    return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
  }

  function compareISO(left, right) {
    const a = parseISODate(left);
    const b = parseISODate(right);
    if (!a || !b) return 0;
    return Math.sign(toUtcTime(a) - toUtcTime(b));
  }

  function addDays(value, amount) {
    const parsed = typeof value === "string" ? parseISODate(value) : value;
    if (!parsed) return "";
    return dateKey(fromUtcTime(toUtcTime(parsed) + Number(amount || 0) * DAY_MS));
  }

  function addMonths(value, amount) {
    const parsed = typeof value === "string" ? parseISODate(value) : value;
    if (!parsed) return null;
    const first = new Date(Date.UTC(parsed.year, parsed.month - 1 + Number(amount || 0), 1));
    const year = first.getUTCFullYear();
    const month = first.getUTCMonth() + 1;
    return { year, month, day: Math.min(parsed.day, daysInMonth(year, month)) };
  }

  function daysInMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  function startOfMonth(value) {
    const parsed = typeof value === "string" ? parseISODate(value) : value;
    return parsed ? { year: parsed.year, month: parsed.month, day: 1 } : null;
  }

  function calendarGridStart(monthDate) {
    const first = startOfMonth(monthDate);
    if (!first) return null;
    const weekday = new Date(Date.UTC(first.year, first.month - 1, 1)).getUTCDay();
    const mondayOffset = (weekday + 6) % 7;
    return parseISODate(addDays(first, -mondayOffset));
  }

  function getMonthGrid(monthDate) {
    const start = calendarGridStart(monthDate);
    if (!start) return [];
    const cells = [];
    for (let index = 0; index < 42; index += 1) {
      const iso = addDays(start, index);
      const parsed = parseISODate(iso);
      cells.push({
        iso,
        date: parsed,
        inMonth: parsed && parsed.month === monthDate.month,
      });
    }
    return cells;
  }

  function formatDisplayDate(value) {
    const parsed = parseISODate(value);
    if (!parsed) return "";
    return `${parsed.day}. ${MONTHS_DA[parsed.month - 1]} ${parsed.year}`;
  }

  function formatCompactDate(value) {
    const parsed = parseISODate(value);
    if (!parsed) return "";
    return `${parsed.day}. ${MONTHS_DA[parsed.month - 1].slice(0, 3)} ${parsed.year}`;
  }

  function normalizeDecorations(decorations) {
    return (Array.isArray(decorations) ? decorations : [])
      .map((item, index) => {
        const start = formatISODate(item && (item.start || item.date));
        const end = formatISODate(item && (item.end || item.start || item.date));
        const styles = Array.isArray(item && item.styles)
          ? item.styles
          : [item && (item.style || item.kind)];
        const normalizedStyles = Array.from(new Set(styles.filter((style) => DECORATION_STYLES.has(String(style)))));
        if (item && item.disabled === true && !normalizedStyles.includes("disabled")) normalizedStyles.push("disabled");
        if (!start || !end) return null;
        const ordered = compareISO(start, end) <= 0 ? { start, end } : { start: end, end: start };
        return {
          id: String(item.id || `${ordered.start}:${ordered.end}:${index}`),
          start: ordered.start,
          end: ordered.end,
          label: String(item.label || ""),
          info: String(item.info || ""),
          styles: normalizedStyles.length > 0 ? normalizedStyles : ["info"],
          priority: Number.isFinite(Number(item.priority)) ? Number(item.priority) : 0,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.priority - a.priority);
  }

  function decorationsForDate(iso, decorations) {
    return normalizeDecorations(decorations).filter((item) => compareISO(item.start, iso) <= 0 && compareISO(iso, item.end) <= 0);
  }

  function createRangeSelection(current, iso) {
    const picked = formatISODate(iso);
    if (!picked) return { start: "", end: "" };
    const start = formatISODate(current && current.start);
    const end = formatISODate(current && current.end);
    if (!start || end) return { start: picked, end: "" };
    return compareISO(picked, start) < 0 ? { start: picked, end: start } : { start, end: picked };
  }

  function isMobilePanel() {
    if (!root.matchMedia) return false;
    return root.matchMedia("(hover: none), (max-width: 767px)").matches;
  }

  function dispatchInputEvents(input) {
    if (!input || typeof input.dispatchEvent !== "function") return;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function ensureStyles(documentRef) {
    if (!documentRef || documentRef.getElementById("fd-datepicker-styles")) return;
    const style = documentRef.createElement("style");
    style.id = "fd-datepicker-styles";
    style.textContent = `
      .fdDateInput {
        width: 100%;
        min-height: 40px;
        border: 1px solid rgba(5, 150, 105, 0.18);
        border-radius: 12px;
        padding: 0 12px;
        background: #ffffff;
        color: #0e1018;
        font: inherit;
        font-size: 16px;
        text-align: left;
        cursor: pointer;
      }
      .fdDateInput:hover,
      .fdDateInput:focus-visible {
        border-color: #059669;
        outline: 3px solid rgba(5, 150, 105, 0.16);
        outline-offset: 1px;
      }
      .fdDateInput:disabled {
        background: #edf4f1;
        color: #596b66;
        cursor: not-allowed;
      }
      .fdDatePickerOverlay {
        position: fixed;
        inset: 0;
        z-index: 140;
        pointer-events: none;
      }
      .fdDatePickerBackdrop {
        position: fixed;
        inset: 0;
        background: rgba(4, 10, 22, 0.18);
        pointer-events: auto;
      }
      .fdDatePickerPanel {
        position: absolute;
        width: min(360px, calc(100vw - 24px));
        max-height: min(620px, calc(100vh - 24px));
        overflow: auto;
        display: grid;
        gap: 12px;
        padding: 14px;
        border: 1px solid rgba(5, 150, 105, 0.18);
        border-radius: 14px;
        background: #ffffff;
        color: #0e1018;
        box-shadow: 0 24px 70px rgba(14, 16, 24, 0.22);
        pointer-events: auto;
      }
      .fdDatePickerHeader,
      .fdDatePickerActions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .fdDatePickerTitle {
        margin: 0;
        font-size: 16px;
        font-weight: 800;
        text-align: center;
      }
      .fdDatePickerIconBtn,
      .fdDatePickerAction {
        min-height: 40px;
        border: 1px solid rgba(5, 150, 105, 0.18);
        border-radius: 10px;
        background: #ffffff;
        color: #0e1018;
        font: inherit;
        font-size: 16px;
        cursor: pointer;
      }
      .fdDatePickerIconBtn {
        width: 42px;
        padding: 0;
      }
      .fdDatePickerAction {
        padding: 0 12px;
      }
      .fdDatePickerActionPrimary {
        border-color: #059669;
        background: #059669;
        color: #ffffff;
      }
      .fdDatePickerWeekdays,
      .fdDatePickerGrid {
        display: grid;
        grid-template-columns: repeat(7, minmax(0, 1fr));
        gap: 4px;
      }
      .fdDatePickerWeekday {
        color: #64736f;
        font-size: 12px;
        font-weight: 800;
        text-align: center;
      }
      .fdDatePickerDay {
        position: relative;
        min-width: 0;
        min-height: 42px;
        border: 1px solid transparent;
        border-radius: 10px;
        background: transparent;
        color: #0e1018;
        font: inherit;
        font-size: 16px;
        cursor: pointer;
      }
      .fdDatePickerDayOther {
        color: #8a9894;
      }
      .fdDatePickerDayRange {
        background: #ecfdf5;
      }
      .fdDatePickerDayUnderline::after {
        content: "";
        position: absolute;
        right: 9px;
        bottom: 6px;
        left: 9px;
        height: 2px;
        border-radius: 999px;
        background: #059669;
      }
      .fdDatePickerDayDot::before {
        content: "";
        position: absolute;
        top: 6px;
        right: 7px;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #2563eb;
      }
      .fdDatePickerDayInfo {
        border-color: rgba(37, 99, 235, 0.28);
      }
      .fdDatePickerDaySelected {
        background: #059669;
        color: #ffffff;
        font-weight: 800;
      }
      .fdDatePickerDay:disabled {
        color: #8a9894;
        background: #f1f5f9;
        cursor: not-allowed;
        text-decoration: line-through;
      }
      .fdDatePickerDay:focus-visible,
      .fdDatePickerIconBtn:focus-visible,
      .fdDatePickerAction:focus-visible {
        outline: 3px solid rgba(5, 150, 105, 0.22);
        outline-offset: 1px;
      }
      .fdDatePickerInfoPanel {
        min-height: 36px;
        border-top: 1px solid rgba(5, 150, 105, 0.12);
        padding-top: 10px;
        color: #334155;
        font-size: 13px;
        line-height: 1.4;
      }
      @media (hover: none), (max-width: 767px) {
        .fdDatePickerOverlay {
          display: grid;
          align-items: end;
        }
        .fdDatePickerBackdrop {
          background: rgba(4, 10, 22, 0.34);
        }
        .fdDatePickerPanel {
          position: relative;
          inset: auto;
          width: 100%;
          max-height: min(88vh, 680px);
          border-radius: 18px 18px 0 0;
          padding: 16px;
        }
        .fdDateInput,
        .fdDatePickerIconBtn,
        .fdDatePickerAction,
        .fdDatePickerDay {
          font-size: 16px;
        }
        .fdDatePickerDay {
          min-height: 46px;
        }
      }
    `;
    documentRef.head.appendChild(style);
  }

  class PickerBase {
    constructor(options) {
      this.options = options || {};
      this.document = this.options.document || (root.document || null);
      this.decorations = normalizeDecorations(this.options.decorations);
      this.mode = this.options.mode || "single";
      this.isOpen = false;
      this.anchor = null;
      this.overlay = null;
      this.activeInfo = "";
      this.viewMonth = startOfMonth(this.options.initialMonth || this.getInitialISO() || formatISODateFromSystemDate());
      if (this.document) ensureStyles(this.document);
    }

    getInitialISO() {
      return "";
    }

    createTrigger(label, input) {
      const button = this.document.createElement("button");
      button.type = "button";
      button.className = "fdDateInput";
      button.setAttribute("aria-haspopup", "dialog");
      button.setAttribute("aria-expanded", "false");
      button.addEventListener("click", () => this.open(button));
      button.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.open(button);
        }
      });
      input.insertAdjacentElement("afterend", button);
      this.hideNativeInput(input);
      button.setAttribute("aria-label", label);
      return button;
    }

    hideNativeInput(input) {
      if (!input || input.dataset.fdDatePickerAttached === "true") return;
      input.dataset.fdOriginalType = input.getAttribute("type") || "text";
      input.dataset.fdDatePickerAttached = "true";
      input.setAttribute("type", "hidden");
      input.tabIndex = -1;
    }

    setDecorations(decorations) {
      this.decorations = normalizeDecorations(decorations);
      this.render();
    }

    setDisabled(disabled) {
      (this.triggers || []).forEach((button) => {
        button.disabled = Boolean(disabled);
      });
    }

    refresh() {
      this.syncDraftFromInputs();
      this.updateTriggers();
      this.render();
    }

    open(anchor) {
      if (!this.document || this.isOpen || (anchor && anchor.disabled)) return;
      this.anchor = anchor || this.anchor || (this.triggers && this.triggers[0]);
      this.syncDraftFromInputs();
      this.isOpen = true;
      this.previousFocus = this.document.activeElement;
      this.overlay = this.document.createElement("div");
      this.overlay.className = "fdDatePickerOverlay";
      this.overlay.innerHTML = '<div class="fdDatePickerBackdrop"></div><section class="fdDatePickerPanel" role="dialog" aria-modal="true" aria-label="Vælg dato"></section>';
      this.overlay.querySelector(".fdDatePickerBackdrop").addEventListener("click", () => this.close(false));
      this.panel = this.overlay.querySelector(".fdDatePickerPanel");
      this.document.body.appendChild(this.overlay);
      (this.triggers || []).forEach((button) => button.setAttribute("aria-expanded", "true"));
      this.render();
      this.positionPanel();
      const selected = this.panel.querySelector(".fdDatePickerDaySelected") || this.panel.querySelector(".fdDatePickerDay:not(:disabled)");
      if (selected) selected.focus();
    }

    close(commit) {
      if (!this.isOpen) return;
      if (commit) this.commitDraft();
      if (this.overlay) this.overlay.remove();
      this.overlay = null;
      this.panel = null;
      this.isOpen = false;
      (this.triggers || []).forEach((button) => button.setAttribute("aria-expanded", "false"));
      this.updateTriggers();
      const focusTarget = this.anchor || this.previousFocus;
      if (focusTarget && typeof focusTarget.focus === "function") focusTarget.focus();
    }

    positionPanel() {
      if (!this.panel || !this.anchor || isMobilePanel()) return;
      const rect = this.anchor.getBoundingClientRect();
      const panelRect = this.panel.getBoundingClientRect();
      const margin = 12;
      let left = Math.min(Math.max(rect.left, margin), Math.max(margin, root.innerWidth - panelRect.width - margin));
      let top = rect.bottom + 8;
      if (top + panelRect.height > root.innerHeight - margin) top = Math.max(margin, rect.top - panelRect.height - 8);
      this.panel.style.left = `${left}px`;
      this.panel.style.top = `${top}px`;
    }

    moveMonth(amount) {
      this.viewMonth = addMonths(this.viewMonth, amount) || this.viewMonth;
      this.render();
      this.positionPanel();
    }

    moveFocus(currentISO, days) {
      const nextISO = addDays(currentISO, days);
      const parsed = parseISODate(nextISO);
      if (!parsed) return;
      if (parsed.month !== this.viewMonth.month || parsed.year !== this.viewMonth.year) this.viewMonth = startOfMonth(parsed);
      this.render();
      const nextButton = this.panel && this.panel.querySelector(`[data-date="${nextISO}"]`);
      if (nextButton) nextButton.focus();
    }

    render() {
      if (!this.panel) return;
      this.panel.replaceChildren();
      const header = this.document.createElement("div");
      header.className = "fdDatePickerHeader";
      const prev = this.createPanelButton("‹", "Forrige måned", () => this.moveMonth(-1), "fdDatePickerIconBtn");
      const title = this.document.createElement("h3");
      title.className = "fdDatePickerTitle";
      title.textContent = `${MONTHS_DA[this.viewMonth.month - 1]} ${this.viewMonth.year}`;
      const next = this.createPanelButton("›", "Næste måned", () => this.moveMonth(1), "fdDatePickerIconBtn");
      header.append(prev, title, next);

      const weekdays = this.document.createElement("div");
      weekdays.className = "fdDatePickerWeekdays";
      WEEKDAYS_DA.forEach((day) => {
        const item = this.document.createElement("div");
        item.className = "fdDatePickerWeekday";
        item.textContent = day;
        weekdays.appendChild(item);
      });

      const grid = this.document.createElement("div");
      grid.className = "fdDatePickerGrid";
      grid.setAttribute("role", "grid");
      getMonthGrid(this.viewMonth).forEach((cell) => grid.appendChild(this.createDayButton(cell)));

      const info = this.document.createElement("div");
      info.className = "fdDatePickerInfoPanel";
      info.setAttribute("aria-live", "polite");
      info.textContent = this.activeInfo || "Vælg en dato i kalenderen.";

      const actions = this.document.createElement("div");
      actions.className = "fdDatePickerActions";
      actions.append(
        this.createPanelButton("I dag", "Vælg i dag", () => this.pickToday(), "fdDatePickerAction"),
        this.createPanelButton("Ryd", "Ryd dato", () => this.clear(), "fdDatePickerAction"),
        this.createPanelButton("Annuller", "Annuller", () => this.close(false), "fdDatePickerAction"),
        this.createPanelButton("Vælg", "Vælg dato", () => this.close(true), "fdDatePickerAction fdDatePickerActionPrimary")
      );

      this.panel.append(header, weekdays, grid, info, actions);
    }

    createPanelButton(text, label, onClick, className) {
      const button = this.document.createElement("button");
      button.type = "button";
      button.className = className;
      button.textContent = text;
      button.setAttribute("aria-label", label);
      button.addEventListener("click", onClick);
      return button;
    }

    createDayButton(cell) {
      const button = this.document.createElement("button");
      const iso = cell.iso;
      const markers = decorationsForDate(iso, this.decorations);
      const disabled = markers.some((item) => item.styles.includes("disabled"));
      button.type = "button";
      button.className = "fdDatePickerDay";
      button.dataset.date = iso;
      button.textContent = String(cell.date.day);
      button.setAttribute("role", "gridcell");
      button.setAttribute("aria-label", formatDisplayDate(iso));
      if (!cell.inMonth) button.classList.add("fdDatePickerDayOther");
      if (markers.some((item) => item.styles.includes("range"))) button.classList.add("fdDatePickerDayRange");
      if (markers.some((item) => item.styles.includes("dot"))) button.classList.add("fdDatePickerDayDot");
      if (markers.some((item) => item.styles.includes("underline"))) button.classList.add("fdDatePickerDayUnderline");
      if (markers.some((item) => item.styles.includes("info"))) button.classList.add("fdDatePickerDayInfo");
      if (this.isSelected(iso)) {
        button.classList.add("fdDatePickerDaySelected");
        button.setAttribute("aria-selected", "true");
      }
      if (disabled) {
        button.disabled = true;
        button.setAttribute("aria-disabled", "true");
      }
      const infoText = markers.map((item) => [item.label, item.info].filter(Boolean).join(": ")).filter(Boolean).join(" | ");
      if (infoText) button.title = infoText;
      button.addEventListener("focus", () => this.setInfo(infoText));
      button.addEventListener("pointerenter", () => this.setInfo(infoText));
      button.addEventListener("click", () => this.pickDate(iso));
      button.addEventListener("keydown", (event) => this.handleDayKey(event, iso));
      return button;
    }

    setInfo(text) {
      this.activeInfo = text || "";
      if (!this.panel) return;
      const info = this.panel.querySelector(".fdDatePickerInfoPanel");
      if (info) info.textContent = this.activeInfo || "Vælg en dato i kalenderen.";
    }

    handleDayKey(event, iso) {
      const moves = {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: -7,
        ArrowDown: 7,
      };
      if (moves[event.key]) {
        event.preventDefault();
        this.moveFocus(iso, moves[event.key]);
      } else if (event.key === "Home") {
        event.preventDefault();
        const parsed = parseISODate(iso);
        const day = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
        this.moveFocus(iso, -((day + 6) % 7));
      } else if (event.key === "End") {
        event.preventDefault();
        const parsed = parseISODate(iso);
        const day = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
        this.moveFocus(iso, 6 - ((day + 6) % 7));
      } else if (event.key === "PageUp") {
        event.preventDefault();
        this.moveMonth(-1);
      } else if (event.key === "PageDown") {
        event.preventDefault();
        this.moveMonth(1);
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.close(false);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.pickDate(iso);
      }
    }

    pickToday() {
      this.pickDate(formatISODateFromSystemDate());
    }

    clear() {
      this.clearDraft();
      this.commitDraft();
      this.close(false);
    }
  }

  class FDDatePicker extends PickerBase {
    constructor(options) {
      super({ ...(options || {}), mode: "single" });
      this.input = options && options.input;
      this.draft = formatISODate(this.input && this.input.value);
      this.triggers = this.input ? [this.createTrigger(options.label || "Vælg dato", this.input)] : [];
      this.updateTriggers();
    }

    getInitialISO() {
      return this.input && this.input.value ? this.input.value : "";
    }

    syncDraftFromInputs() {
      this.draft = formatISODate(this.input && this.input.value);
      const parsed = parseISODate(this.draft);
      if (parsed) this.viewMonth = startOfMonth(parsed);
    }

    setValue(value) {
      if (this.input) this.input.value = formatISODate(value);
      this.refresh();
    }

    updateTriggers() {
      const label = this.draft ? formatCompactDate(this.draft) : "Vælg dato";
      this.triggers.forEach((button) => {
        button.textContent = label;
        button.disabled = Boolean(this.input && this.input.disabled);
      });
    }

    isSelected(iso) {
      return this.draft === iso;
    }

    pickDate(iso) {
      this.draft = formatISODate(iso);
      const parsed = parseISODate(this.draft);
      if (parsed) this.viewMonth = startOfMonth(parsed);
      this.render();
    }

    clearDraft() {
      this.draft = "";
    }

    commitDraft() {
      if (this.input) {
        this.input.value = this.draft;
        dispatchInputEvents(this.input);
      }
      if (typeof this.options.onChange === "function") this.options.onChange(this.draft);
    }
  }

  class FDDateRangePicker extends PickerBase {
    constructor(options) {
      super({ ...(options || {}), mode: "range" });
      this.startInput = options && options.startInput;
      this.endInput = options && options.endInput;
      this.draft = {
        start: formatISODate(this.startInput && this.startInput.value),
        end: formatISODate(this.endInput && this.endInput.value),
      };
      this.triggers = [];
      if (this.startInput) this.triggers.push(this.createTrigger(options.startLabel || "Vælg startdato", this.startInput));
      if (this.endInput) this.triggers.push(this.createTrigger(options.endLabel || "Vælg slutdato", this.endInput));
      this.updateTriggers();
    }

    getInitialISO() {
      return this.startInput && this.startInput.value ? this.startInput.value : "";
    }

    syncDraftFromInputs() {
      this.draft = {
        start: formatISODate(this.startInput && this.startInput.value),
        end: formatISODate(this.endInput && this.endInput.value),
      };
      const parsed = parseISODate(this.draft.start || this.draft.end);
      if (parsed) this.viewMonth = startOfMonth(parsed);
    }

    setRange(start, end) {
      if (this.startInput) this.startInput.value = formatISODate(start);
      if (this.endInput) this.endInput.value = formatISODate(end || start);
      this.refresh();
    }

    updateTriggers() {
      const start = this.draft.start ? formatCompactDate(this.draft.start) : "Fra dato";
      const end = this.draft.end ? formatCompactDate(this.draft.end) : "Til dato";
      const disabled = Boolean((this.startInput && this.startInput.disabled) || (this.endInput && this.endInput.disabled));
      if (this.triggers[0]) {
        this.triggers[0].textContent = start;
        this.triggers[0].disabled = disabled;
      }
      if (this.triggers[1]) {
        this.triggers[1].textContent = end;
        this.triggers[1].disabled = disabled;
      }
    }

    isSelected(iso) {
      if (this.draft.start === iso || this.draft.end === iso) return true;
      return this.draft.start && this.draft.end && compareISO(this.draft.start, iso) < 0 && compareISO(iso, this.draft.end) < 0;
    }

    pickDate(iso) {
      this.draft = createRangeSelection(this.draft, iso);
      const parsed = parseISODate(iso);
      if (parsed) this.viewMonth = startOfMonth(parsed);
      this.render();
    }

    clearDraft() {
      this.draft = { start: "", end: "" };
    }

    commitDraft() {
      if (this.startInput) {
        this.startInput.value = this.draft.start;
        dispatchInputEvents(this.startInput);
      }
      if (this.endInput) {
        this.endInput.value = this.draft.end || this.draft.start;
        dispatchInputEvents(this.endInput);
      }
      if (typeof this.options.onChange === "function") this.options.onChange(this.draft);
    }
  }

  function formatISODateFromSystemDate() {
    const now = new Date();
    return dateKey({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
  }

  root.FielddeskDatePicker = {
    FDDatePicker,
    FDDateRangePicker,
    normalizeDecorations,
    _test: {
      WEEKDAYS_DA,
      MONTHS_DA,
      parseISODate,
      formatISODate,
      addDays,
      addMonths,
      daysInMonth,
      startOfMonth,
      calendarGridStart,
      getMonthGrid,
      formatDisplayDate,
      normalizeDecorations,
      decorationsForDate,
      createRangeSelection,
    },
  };
})();
