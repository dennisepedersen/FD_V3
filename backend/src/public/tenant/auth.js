(function () {
  const STORAGE_KEY = "fielddesk_access_token";
  const AUTH_ERROR_CODES = new Set([
    "missing_authorization_header",
    "invalid_authorization_header",
    "invalid_token",
    "expired_token",
    "invalid_token_type",
    "tenant_context_mismatch",
    "tenant_user_not_found",
  ]);

  function getToken() {
    return window.localStorage.getItem(STORAGE_KEY);
  }

  function setToken(token) {
    window.localStorage.setItem(STORAGE_KEY, token);
  }

  function clearToken() {
    window.localStorage.removeItem(STORAGE_KEY);
  }

  function logout() {
    clearToken();
    window.location.href = "/login";
  }

  function requireToken() {
    const token = getToken();
    if (!token) {
      window.location.href = "/login";
      return null;
    }
    return token;
  }

  function isAuthError(error) {
    if (!error) {
      return false;
    }
    if (error.status === 401 || error.status === 403) {
      return true;
    }
    return Boolean(error.code && AUTH_ERROR_CODES.has(error.code));
  }

  function handleAuthFailure(error) {
    if (!isAuthError(error)) {
      return false;
    }
    logout();
    return true;
  }

  function getErrorMessage(error, fallback) {
    if (!error) {
      return fallback;
    }
    if (error.message && typeof error.message === "string") {
      return error.message;
    }
    return fallback;
  }

  function getProjectIdFromPath() {
    const path = String(window.location.pathname || "");
    const match = path.match(/^\/project\/([^/]+)$/);
    if (!match || !match[1]) {
      return null;
    }
    return decodeURIComponent(match[1]);
  }

  function mapProjectToQuickViewModel(raw) {
    if (!raw) {
      return null;
    }

    function asString(value) {
      if (value === null || value === undefined) {
        return null;
      }
      const parsed = String(value).trim();
      return parsed ? parsed : null;
    }

    function asNumber(value) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    function asDate(value) {
      if (!value) {
        return null;
      }
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    function daysSince(date) {
      if (!date) {
        return null;
      }
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const diffMs = startOfToday.getTime() - startOfDate.getTime();
      if (diffMs < 0) {
        return 0;
      }
      return Math.floor(diffMs / 86400000);
    }

    const statusRaw = asString(raw.status);
    const isClosed = raw.is_closed === true
      || String(raw.status || "").toLowerCase() === "closed"
      || String(raw.status || "").toLowerCase() === "lukket";

    const activityDate = asDate(raw.activity_date) || asDate(raw.last_registration) || asDate(raw.last_fitter_hour_date);
    const updatedDate = asDate(raw.updated_at || raw.source_updated_at);
    const daysSinceActivity = daysSince(activityDate);
    const daysSinceLastRegistration = asNumber(raw.calculated_days_since_last_registration);

    let statusTone = "neutral";
    let statusLabel = isClosed ? "Lukket" : (statusRaw || "Aktiv");

    if (!isClosed && typeof daysSinceActivity === "number" && daysSinceActivity >= 60) {
      statusTone = "critical";
      statusLabel = `OBS (${daysSinceActivity} dage)`;
    } else if (!isClosed && typeof daysSinceActivity === "number" && daysSinceActivity >= 30) {
      statusTone = "warning";
      statusLabel = `Stille (${daysSinceActivity} dage)`;
    }

    const hasWip = raw.coverage != null || raw.margin != null || raw.costs != null
      || raw.ongoing != null || raw.billed != null || raw.ready_to_bill != null
      || raw.last_registration != null || raw.last_fitter_hour_date != null
      || raw.hours_budget != null;

    return {
      projectId: asString(raw.project_id),
      reference: asString(raw.external_project_ref),
      projectName: asString(raw.name),
      status: {
        raw: statusRaw,
        label: statusLabel,
        tone: statusTone,
      },
      isClosed,
      responsible: {
        code: asString(raw.responsible_code),
        name: asString(raw.responsible_name),
        teamLeaderCode: asString(raw.team_leader_code),
        teamLeaderName: asString(raw.team_leader_name),
      },
      relation: {
        isSubproject: raw.is_subproject === true,
        parentProjectEkId: asString(raw.parent_project_ek_id),
      },
      dates: {
        lastActivityDate: activityDate,
        updatedDate,
        lastRegistrationDate: asDate(raw.last_registration),
        lastFitterHourDate: asDate(raw.last_fitter_hour_date),
        daysSinceActivity,
        daysSinceLastRegistration: daysSinceLastRegistration !== null ? daysSinceLastRegistration : daysSinceActivity,
      },
      economy: {
        _hasWip: hasWip,
        coveragePercent: asNumber(raw.coverage),
        budget: {
          hours: asNumber(raw.hours_budget),
          totalExpected: asNumber(raw.total_turn_over_exp),
        },
        wip: {
          costs: asNumber(raw.costs),
          ongoing: asNumber(raw.ongoing),
          billed: asNumber(raw.billed),
          margin: asNumber(raw.margin),
          readyToBill: asNumber(raw.ready_to_bill),
        },
      },
    };
  }

  function mapProjectToFittersSection(rawProject, options) {
    const isLoaded = Boolean(options && options.isLoaded);
    if (!isLoaded) {
      return {
        items: [],
        totalCount: null,
        hasData: false,
        isPending: false,
        emptyReason: "not_loaded",
      };
    }

    if (!rawProject) {
      return {
        items: [],
        totalCount: 0,
        hasData: false,
        isPending: false,
        emptyReason: "no_fitters",
      };
    }

    function asString(value) {
      if (value === null || value === undefined) {
        return null;
      }
      const parsed = String(value).trim();
      return parsed ? parsed : null;
    }

    const candidates = Array.isArray(rawProject.fitters)
      ? rawProject.fitters
      : Array.isArray(rawProject.fitterList)
        ? rawProject.fitterList
        : [];

    const items = [];
    const seen = new Set();

    function makeKey(item) {
      return [
        asString(item.id),
        asString(item.employeeCode),
        asString(item.name),
      ].join("|");
    }

    function addItem(item) {
      const key = makeKey(item);
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      items.push(item);
    }

    // Only add items from actual fitter arrays, never from responsible/team_leader fields
    candidates.forEach((row) => {
      if (!row || typeof row !== "object") {
        return;
      }
      addItem({
        id: asString(row.id || row.fitterID || row.fitterId),
        employeeCode: asString(row.employeeCode || row.code || row.fitterCode || row.initials),
        name: asString(row.name || row.employeeName || row.fitterName),
        role: asString(row.role || row.relation || "Tekniker"),
        relationType: "fitter",
        isResponsible: false,
        isTeamLeader: false,
        isPending: false,
        source: "v3",
      });
    });

    const hasData = items.length > 0;
    const hasFitterArrayInPayload = Object.prototype.hasOwnProperty.call(rawProject, "fitters")
      || Object.prototype.hasOwnProperty.call(rawProject, "fitterList");

    if (!hasData && !hasFitterArrayInPayload) {
      return {
        items: [],
        totalCount: null,
        hasData: false,
        isPending: true,
        emptyReason: "missing_enrichment",
      };
    }

    if (!hasData) {
      return {
        items: [],
        totalCount: 0,
        hasData: false,
        isPending: false,
        emptyReason: "no_fitters",
      };
    }

    return {
      items,
      totalCount: items.length,
      hasData: true,
      isPending: false,
      emptyReason: "none",
    };
  }

  function mapProjectToFitterHoursSection(rawProject, options) {
    const isLoaded = Boolean(options && options.isLoaded);
    if (!isLoaded) {
      return {
        items: [],
        summary: {
          totalHours: null,
          latestEntryDate: null,
          entryCount: null,
          groupedByEmployee: [],
        },
        hasData: false,
        isPending: false,
        emptyReason: "not_loaded",
      };
    }

    if (!rawProject) {
      return {
        items: [],
        summary: {
          totalHours: 0,
          latestEntryDate: null,
          entryCount: 0,
          groupedByEmployee: [],
        },
        hasData: false,
        isPending: false,
        emptyReason: "no_hours",
      };
    }

    function asString(value) {
      if (value === null || value === undefined) {
        return null;
      }
      const parsed = String(value).trim();
      return parsed ? parsed : null;
    }

    function asNumber(value) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    function asDate(value) {
      if (!value) {
        return null;
      }
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const rawRows = Array.isArray(rawProject.fitterhours)
      ? rawProject.fitterhours
      : Array.isArray(rawProject.fitterHours)
        ? rawProject.fitterHours
        : Array.isArray(rawProject.hours)
          ? rawProject.hours
          : [];

    const items = rawRows
      .filter((row) => row && typeof row === "object")
      .map((row) => ({
        id: asString(row.id || row.fitterHourID || row.fitterHourId),
        date: asString(row.date || row.registrationDate || row.workDate),
        employeeCode: asString(row.employeeCode || row.fitterCode || row.initials),
        employeeName: asString(row.employeeName || row.fitterName || row.name),
        hours: asNumber(row.hours || row.registeredHours || row.totalHours),
        note: asString(row.note || row.description),
        source: "v3",
        isPending: false,
      }));

    const hasArrayInPayload = Object.prototype.hasOwnProperty.call(rawProject, "fitterhours")
      || Object.prototype.hasOwnProperty.call(rawProject, "fitterHours")
      || Object.prototype.hasOwnProperty.call(rawProject, "hours");

    if (items.length === 0 && !hasArrayInPayload) {
      return {
        items: [],
        summary: {
          totalHours: null,
          latestEntryDate: null,
          entryCount: null,
          groupedByEmployee: [],
        },
        hasData: false,
        isPending: true,
        emptyReason: "missing_enrichment",
      };
    }

    if (items.length === 0) {
      return {
        items: [],
        summary: {
          totalHours: 0,
          latestEntryDate: null,
          entryCount: 0,
          groupedByEmployee: [],
        },
        hasData: false,
        isPending: false,
        emptyReason: "no_hours",
      };
    }

    const groupedMap = new Map();
    let totalHours = 0;
    let latestDate = null;

    items.forEach((item) => {
      if (typeof item.hours === "number") {
        totalHours += item.hours;
      }
      const parsedDate = asDate(item.date);
      if (parsedDate && (!latestDate || parsedDate > latestDate)) {
        latestDate = parsedDate;
      }

      const key = `${item.employeeCode || ""}|${item.employeeName || ""}`;
      const prev = groupedMap.get(key) || {
        employeeCode: item.employeeCode,
        employeeName: item.employeeName,
        totalHours: 0,
        entryCount: 0,
      };
      prev.entryCount += 1;
      prev.totalHours += typeof item.hours === "number" ? item.hours : 0;
      groupedMap.set(key, prev);
    });

    return {
      items,
      summary: {
        totalHours,
        latestEntryDate: latestDate ? latestDate.toISOString() : null,
        entryCount: items.length,
        groupedByEmployee: Array.from(groupedMap.values()),
      },
      hasData: true,
      isPending: false,
      emptyReason: "none",
    };
  }

  function getSectionEmptyStateText(sectionName, emptyReason) {
    if (emptyReason === "not_loaded") {
      return `${sectionName} er ikke hentet endnu.`;
    }
    if (emptyReason === "missing_enrichment") {
      return `${sectionName} afventer enrichment.`;
    }
    if (emptyReason === "no_fitters") {
      return "Ingen teknikere registreret.";
    }
    if (emptyReason === "no_hours") {
      return "Ingen timer registreret.";
    }
    return "Ingen data.";
  }

  async function apiFetch(url, options) {
    const token = getToken();
    const response = await window.fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options && options.headers ? options.headers : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }

    if (!response.ok) {
      const code = payload && payload.error && payload.error.message
        ? payload.error.message
        : null;
      const error = new Error(code || `request_failed_${response.status}`);
      error.status = response.status;
      error.code = code;
      throw error;
    }

    return payload;
  }

  function showError(message) {
    const errorBox = document.getElementById("errorBox");
    if (!errorBox) {
      return;
    }
    errorBox.hidden = false;
    errorBox.textContent = message;
  }

  function hideError() {
    const errorBox = document.getElementById("errorBox");
    if (!errorBox) {
      return;
    }
    errorBox.hidden = true;
    errorBox.textContent = "";
  }

  async function initLoginPage() {
    const form = document.getElementById("loginForm");
    if (!form) {
      return;
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      hideError();

      const login = document.getElementById("login").value.trim();
      const password = document.getElementById("password").value;

      try {
        const data = await apiFetch("/v1/auth/login", {
          method: "POST",
          headers: {},
          body: JSON.stringify({ login, password }),
        });

        if (!data || !data.access_token) {
          throw new Error("missing_access_token");
        }

        setToken(data.access_token);
        window.location.href = "/app";
      } catch (error) {
        showError(getErrorMessage(error, "login_failed"));
      }
    });
  }

  async function initAppPage() {
    const projectsContainer = document.getElementById("projectsContainer");
    if (!projectsContainer) {
      return;
    }

    if (!requireToken()) {
      return;
    }

    const userPill = document.getElementById("userPill");
    const logoutBtn = document.getElementById("logoutBtn");
    const sortSelect = document.getElementById("sortSelect");
    const listMetaText = document.getElementById("listMetaText");
    const scopeRow = document.getElementById("scopeRow");
    const scopeChips = document.getElementById("scopeChips");
    const refreshSyncBtn = document.getElementById("refreshSyncBtn");
    const syncFilterSelect = document.getElementById("syncFilterSelect");
    const syncSortSelect = document.getElementById("syncSortSelect");
    const syncEndpointList = document.getElementById("syncEndpointList");
    const syncBootstrapText = document.getElementById("syncBootstrapText");
    const syncDeltaText = document.getElementById("syncDeltaText");
    const syncLastSuccessText = document.getElementById("syncLastSuccessText");
    const syncBacklogText = document.getElementById("syncBacklogText");
    const syncNextRetryText = document.getElementById("syncNextRetryText");
    const syncRowsText = document.getElementById("syncRowsText");
    const syncOverallText = document.getElementById("syncOverallText");
    const drawerShell = document.getElementById("drawerShell");
    const drawerOverlay = document.getElementById("drawerOverlay");
    const drawerCloseBtn = document.getElementById("drawerCloseBtn");
    const drawerCloseSecondaryBtn = document.getElementById("drawerCloseSecondaryBtn");
    const drawerTitle = document.getElementById("drawerTitle");
    const drawerRef = document.getElementById("drawerRef");
    const drawerBody = document.getElementById("drawerBody");
    const openProjectPageLink = document.getElementById("openProjectPageLink");

    const state = {
      me: null,
      projects: [],
      sortMode: sortSelect && sortSelect.value ? sortSelect.value : "ref_asc",
      ownerOptions: [],
      selectedOwnerIds: new Set(["__ALL__"]),
      ownerLabelMap: new Map(),
      drawerProjectId: null,
      showingClosedFallback: false,
      syncEndpointStates: [],
      syncFilterMode: "all",
      syncSortMode: "endpoint",
    };

    const ACTIVITY_FIELD_CANDIDATES = [
      "last_activity_at",
      "last_activity",
      "last_activity_date",
      "activity_at",
      "activity_date",
    ];
    const PIPELINE_TRACE_REFS = new Set(["80229", "80229-001"]);
    const PROJECT_LIST_DEBUG_ENABLED = true;

    function normalizeRef(ref) {
      return String(ref || "").trim();
    }

    function summarizeTrackedProjects(projects) {
      const rows = [];
      (Array.isArray(projects) ? projects : []).forEach((project) => {
        const ref = normalizeRef(project && project.external_project_ref);
        if (!PIPELINE_TRACE_REFS.has(ref)) {
          return;
        }
        rows.push({
          ref,
          project_id: project && project.project_id ? String(project.project_id) : "",
          status: project && project.status ? String(project.status) : null,
          is_closed: project && Object.prototype.hasOwnProperty.call(project, "is_closed")
            ? project.is_closed
            : null,
          owner_user_id: project && project.owner_user_id ? String(project.owner_user_id) : "",
        });
      });
      return rows;
    }

    function logProjectPipeline(stage, projects, extra) {
      if (!PROJECT_LIST_DEBUG_ENABLED) {
        return;
      }

      const list = Array.isArray(projects) ? projects : [];
      const tracked = summarizeTrackedProjects(list);
      const payload = {
        stage,
        count: list.length,
        tracked,
        extra: extra || null,
      };
      console.info("[projects-mine-pipeline]", payload);
    }

    function toDate(value) {
      if (!value) {
        return null;
      }
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return null;
      }
      return date;
    }

    function getActivityDate(project) {
      if (!project) {
        return null;
      }
      for (let i = 0; i < ACTIVITY_FIELD_CANDIDATES.length; i += 1) {
        const field = ACTIVITY_FIELD_CANDIDATES[i];
        if (Object.prototype.hasOwnProperty.call(project, field)) {
          return toDate(project[field]);
        }
      }
      return null;
    }

    function getInactivityDays(activityDate) {
      if (!activityDate) {
        return null;
      }
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfActivity = new Date(
        activityDate.getFullYear(),
        activityDate.getMonth(),
        activityDate.getDate()
      );
      const diffMs = startOfToday.getTime() - startOfActivity.getTime();
      if (diffMs < 0) {
        return 0;
      }
      return Math.floor(diffMs / 86400000);
    }

    function formatActivityDate(date) {
      if (!date) {
        return "-";
      }
      try {
        return new Intl.DateTimeFormat("da-DK", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        }).format(date);
      } catch (_error) {
        return date.toISOString().slice(0, 10);
      }
    }

    function formatDateTimeValue(value) {
      if (!value) return "-";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return String(value);
      }
      try {
        return new Intl.DateTimeFormat("da-DK", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }).format(date);
      } catch (_error) {
        return date.toISOString();
      }
    }

    function isClosedStatus(project) {
      if (project && project.is_closed === true) {
        return true;
      }
      if (project && project.is_closed === false) {
        return false;
      }
      const status = String(project && project.status ? project.status : "").trim().toLowerCase();
      return status === "closed" || status === "lukket";
    }

    function normalizeSyncType(value) {
      const type = String(value || "").trim().toLowerCase();
      if (type === "bootstrap" || type === "delta") {
        return type;
      }
      return "unknown";
    }

    function mapEffectiveStatusLabel(row) {
      const value = String(row && row.effective_status ? row.effective_status : row && row.status ? row.status : "").toLowerCase();
      if (value === "not_implemented") return "Ikke implementeret";
      if (value === "historical_failed") return "Historisk fejl";
      if (value === "stale") return "Stale";
      if (value === "running") return "Kører";
      if (value === "failed") return "Fejlet";
      if (value === "success") return "Success";
      if (value === "partial") return "Delvis";
      return value || "-";
    }

    function mapTouchedLabel(row) {
      if (row && row.touched_by_current_job) {
        return "Touched i aktuelt job";
      }
      return "Historisk";
    }

    function computeOverallStatusFromEndpoints(rows) {
      const values = (Array.isArray(rows) ? rows : []).map((row) =>
        String(row && row.effective_status ? row.effective_status : row && row.status ? row.status : "").toLowerCase()
      );

      if (values.some((value) => value === "failed" || value === "stale")) {
        return "failed";
      }
      if (values.some((value) => value === "running")) {
        return "running";
      }
      if (values.some((value) => value === "success" || value === "partial" || value === "not_implemented")) {
        return "success";
      }
      return "idle";
    }

    function renderSyncEndpointList() {
      if (!syncEndpointList) {
        return;
      }

      let rows = Array.isArray(state.syncEndpointStates) ? state.syncEndpointStates.slice() : [];
      const filterMode = state.syncFilterMode;

      if (filterMode === "bootstrap") {
        rows = rows.filter((row) => normalizeSyncType(row.sync_type) === "bootstrap");
      } else if (filterMode === "delta") {
        rows = rows.filter((row) => normalizeSyncType(row.sync_type) === "delta");
      } else if (filterMode === "issues") {
        rows = rows.filter((row) => {
          const pending = Number(row.pending_backlog || 0);
          const failed = Number(row.failed_backlog || 0);
          const status = String(row.effective_status || row.status || "").toLowerCase();
          return pending > 0 || failed > 0 || status === "failed" || status === "partial";
        });
      }

      if (state.syncSortMode === "activity_desc") {
        rows.sort((a, b) => {
          const left = new Date(a.last_attempt_at || a.last_successful_sync_at || 0).getTime();
          const right = new Date(b.last_attempt_at || b.last_successful_sync_at || 0).getTime();
          return right - left;
        });
      } else {
        rows.sort((a, b) => String(a.endpoint_key || "").localeCompare(String(b.endpoint_key || ""), "da", { sensitivity: "base" }));
      }

      syncEndpointList.innerHTML = "";
      if (rows.length === 0) {
        const empty = document.createElement("div");
        empty.className = "syncEndpointCard";
        empty.textContent = "Ingen endpoint-status for valgt filter.";
        syncEndpointList.appendChild(empty);
        return;
      }

      rows.forEach((row) => {
        const card = document.createElement("div");
        card.className = "syncEndpointCard";

        const title = document.createElement("div");
        title.className = "syncEndpointTitle";

        const endpointName = document.createElement("span");
        endpointName.textContent = String(row.endpoint_key || "-");

        const endpointStatus = document.createElement("span");
        endpointStatus.textContent = `${mapEffectiveStatusLabel(row)} · ${normalizeSyncType(row.sync_type)}`;

        title.appendChild(endpointName);
        title.appendChild(endpointStatus);

        const line1 = document.createElement("div");
        line1.className = "syncEndpointMeta";
        line1.textContent = `Pages: ${row.pages_processed_last_job || 0} (job) / ${row.pages_processed || 0} (total) · Rows: ${row.rows_persisted_last_job || 0} persisted (job), ${row.rows_fetched || 0} fetched (total)`;

        const line2 = document.createElement("div");
        line2.className = "syncEndpointMeta";
        line2.textContent = `${mapTouchedLabel(row)} · Seneste succes: ${formatDateTimeValue(row.last_successful_sync_at)} · Næste retry: ${formatDateTimeValue(row.next_retry_at)} · Pending/failed backlog: ${Number(row.pending_backlog || 0)}/${Number(row.failed_backlog || 0)}`;

        card.appendChild(title);
        card.appendChild(line1);
        card.appendChild(line2);
        syncEndpointList.appendChild(card);
      });
    }

    function getStatusView(project) {
      const activityDate = getActivityDate(project);
      const inactivityDays = getInactivityDays(activityDate);

      if (isClosedStatus(project)) {
        return {
          tone: "neutral",
          label: "Lukket",
          activityDate,
          inactivityDays,
        };
      }

      if (typeof inactivityDays === "number" && inactivityDays >= 60) {
        return {
          tone: "critical",
          label: `OBS (${inactivityDays} dage)`,
          activityDate,
          inactivityDays,
        };
      }

      if (typeof inactivityDays === "number" && inactivityDays >= 30) {
        return {
          tone: "warning",
          label: `Stille (${inactivityDays} dage)`,
          activityDate,
          inactivityDays,
        };
      }

      return {
        tone: "neutral",
        label: "Aktiv",
        activityDate,
        inactivityDays,
      };
    }

    function refSortValue(ref) {
      const value = String(ref || "").trim();
      const numeric = Number.parseInt(value.replace(/[^0-9]/g, ""), 10);
      if (Number.isNaN(numeric)) {
        return null;
      }
      return numeric;
    }

    function compareByReference(a, b) {
      const left = refSortValue(a && a.external_project_ref);
      const right = refSortValue(b && b.external_project_ref);

      if (left !== null && right !== null && left !== right) {
        return left - right;
      }

      const leftRef = String(a && a.external_project_ref ? a.external_project_ref : "");
      const rightRef = String(b && b.external_project_ref ? b.external_project_ref : "");
      return leftRef.localeCompare(rightRef, "da", { sensitivity: "base", numeric: true });
    }

    function compareByActivity(a, b) {
      const left = getActivityDate(a);
      const right = getActivityDate(b);
      const leftTime = left ? left.getTime() : 0;
      const rightTime = right ? right.getTime() : 0;
      return leftTime - rightTime;
    }

    function sortProjects(projects) {
      const sorted = projects.slice();
      if (state.sortMode === "ref_desc") {
        sorted.sort((a, b) => compareByReference(b, a));
        return sorted;
      }
      if (state.sortMode === "activity_desc") {
        sorted.sort((a, b) => compareByActivity(b, a));
        return sorted;
      }
      if (state.sortMode === "activity_asc") {
        sorted.sort((a, b) => compareByActivity(a, b));
        return sorted;
      }
      sorted.sort((a, b) => compareByReference(a, b));
      return sorted;
    }

    function getOwnerId(project) {
      return String(project && project.owner_user_id ? project.owner_user_id : "").trim();
    }

    function getOwnerDisplayName(project) {
      if (!project) {
        return "Ukendt ejer";
      }

      const ownerId = getOwnerId(project);
      const candidates = [
        project.owner_name,
        project.owner_display_name,
        project.owner_full_name,
        project.owner_email,
      ];

      for (let i = 0; i < candidates.length; i += 1) {
        const value = String(candidates[i] || "").trim();
        if (value) {
          return value;
        }
      }

      if (!ownerId) {
        return "Ukendt ejer";
      }

      if (state.me && String(state.me.id) === ownerId) {
        return "Mig";
      }

      if (!state.ownerLabelMap.has(ownerId)) {
        const nextNumber = state.ownerLabelMap.size + 1;
        state.ownerLabelMap.set(ownerId, `Bruger ${nextNumber}`);
      }

      return state.ownerLabelMap.get(ownerId);
    }

    function ownerLabel(project) {
      const ownerId = project && project.owner_user_id ? String(project.owner_user_id) : "";
      if (!ownerId) {
        return "Ukendt ejer";
      }
      return getOwnerDisplayName(project);
    }

    function hasTeamLeaderValue(project) {
      const candidates = [
        project && project.team_leader_name,
        project && project.teamLeaderName,
      ];
      for (let i = 0; i < candidates.length; i += 1) {
        const value = String(candidates[i] || "").trim();
        if (value) {
          return true;
        }
      }
      return false;
    }

    function getTeamLeaderValue(project) {
      const candidates = [
        project && project.team_leader_name,
        project && project.teamLeaderName,
      ];
      for (let i = 0; i < candidates.length; i += 1) {
        const value = String(candidates[i] || "").trim();
        if (value) {
          return value;
        }
      }
      return "";
    }

    function getFilteredProjects() {
      logProjectPipeline("raw-api", state.projects, {
        selected_owner_ids: Array.from(state.selectedOwnerIds),
      });

      const openProjects = state.projects.filter((project) => !isClosedStatus(project));
      logProjectPipeline("open-only", openProjects, {
        raw_count: state.projects.length,
      });

      const sourceProjects = openProjects.length > 0 ? openProjects : state.projects.slice();
      state.showingClosedFallback = openProjects.length === 0 && state.projects.length > 0;

      const mappedProjects = sourceProjects.map((project) => project);
      logProjectPipeline("after-mapping", mappedProjects, {
        showing_closed_fallback: state.showingClosedFallback,
      });

      const ownerSet = new Map();
      mappedProjects.forEach((project) => {
        const ownerId = getOwnerId(project);
        if (ownerId) {
          ownerSet.set(ownerId, ownerLabel(project));
        }
      });

      state.ownerOptions = Array.from(ownerSet.entries())
        .map(([id, label]) => ({ id, label }))
        .sort((a, b) => a.label.localeCompare(b.label, "da", { sensitivity: "base" }));

      if (state.ownerOptions.length < 2) {
        state.selectedOwnerIds = new Set(["__ALL__"]);
      }

      const sortedProjects = sortProjects(mappedProjects);
      logProjectPipeline("after-sorting", sortedProjects, {
        sort_mode: state.sortMode,
      });

      const allSelected = state.selectedOwnerIds.has("__ALL__");
      if (allSelected) {
        logProjectPipeline("after-filtering", sortedProjects, {
          filter_mode: "all-owners",
        });
        return sortedProjects;
      }

      const selectedSet = state.selectedOwnerIds;
      const filtered = sortedProjects.filter((project) => selectedSet.has(getOwnerId(project)));
      logProjectPipeline("after-filtering", filtered, {
        filter_mode: "owner-selection",
        selected_owner_ids: Array.from(selectedSet),
      });
      return filtered;
    }

    function makeBadge(statusView) {
      const badge = document.createElement("span");
      badge.className = "badge badgeNeutral";
      if (statusView.tone === "warning") {
        badge.className = "badge badgeWarning";
      }
      if (statusView.tone === "critical") {
        badge.className = "badge badgeCritical";
      }
      badge.textContent = statusView.label;
      return badge;
    }

    function openDrawer() {
      if (!drawerShell) {
        return;
      }
      drawerShell.classList.add("open");
      drawerShell.setAttribute("aria-hidden", "false");
      document.body.classList.add("drawer-open");
    }

    function closeDrawer() {
      if (!drawerShell) {
        return;
      }
      drawerShell.classList.remove("open");
      drawerShell.setAttribute("aria-hidden", "true");
      document.body.classList.remove("drawer-open");
      state.drawerProjectId = null;
    }

    function renderDrawerFields(fields, hasError) {
      if (!drawerBody) {
        return;
      }
      drawerBody.innerHTML = "";
      fields.forEach((field) => {
        const wrapper = document.createElement("div");
        wrapper.className = hasError ? "drawerField drawerError" : "drawerField";

        const label = document.createElement("span");
        label.className = "drawerLabel";
        label.textContent = field.label;

        const value = document.createElement("span");
        value.className = "drawerValue";
        value.textContent = field.value;

        wrapper.appendChild(label);
        wrapper.appendChild(value);
        drawerBody.appendChild(wrapper);
      });
    }

    function renderDrawerLoading(project) {
      if (drawerTitle) {
        drawerTitle.textContent = project && project.name ? project.name : "Sag";
      }
      if (drawerRef) {
        const refValue = project && project.external_project_ref ? project.external_project_ref : "-";
        drawerRef.textContent = `Ref: ${refValue}`;
      }
      renderDrawerFields([
        { label: "Status", value: "Indlæser..." },
        { label: "Sidste aktivitet", value: "Indlæser..." },
      ], false);
    }

    function mapProjectToDrawerViewModel(raw) {
      return mapProjectToQuickViewModel(raw);
    }

    function renderDrawerWithViewModel(vm, summary) {
      if (!drawerBody) return;
      drawerBody.innerHTML = '';

      function fmtD(dt) {
        if (!dt) return null;
        try { return new Intl.DateTimeFormat('da-DK', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(dt); }
        catch (_) { return null; }
      }

      function fmtN(num, decimals) {
        if (num === null || num === undefined) return null;
        return num.toLocaleString('da-DK', { minimumFractionDigits: decimals || 0, maximumFractionDigits: decimals || 0 });
      }

      function makeSection(title) {
        const el = document.createElement('div');
        el.className = 'drawerSection';
        if (title) {
          const h = document.createElement('p');
          h.className = 'drawerSectionTitle';
          h.textContent = title;
          el.appendChild(h);
        }
        return el;
      }

      function makeField(label, value) {
        const wrap = document.createElement('div');
        wrap.className = 'drawerField';
        const l = document.createElement('span');
        l.className = 'drawerLabel';
        l.textContent = label;
        const v = document.createElement('span');
        if (value === null || value === undefined || value === '') {
          v.className = 'drawerValue drawerValueMuted';
          v.textContent = '\u2014';
        } else {
          v.className = 'drawerValue';
          v.textContent = String(value);
        }
        wrap.appendChild(l);
        wrap.appendChild(v);
        return wrap;
      }

      function makePending(label) {
        const wrap = document.createElement('div');
        wrap.className = 'drawerPendingField';
        const l = document.createElement('span');
        l.className = 'drawerPendingLabel';
        l.textContent = label;
        const badge = document.createElement('span');
        badge.className = 'drawerPendingBadge';
        badge.textContent = 'Afventer data';
        wrap.appendChild(l);
        wrap.appendChild(badge);
        return wrap;
      }

      function makeGrid() {
        const grid = document.createElement('div');
        grid.className = 'drawerFieldGrid';
        for (let i = 0; i < arguments.length; i++) { grid.appendChild(arguments[i]); }
        return grid;
      }

      // Status badges
      const statusSection = makeSection(null);
      const badgeRow = document.createElement('div');
      badgeRow.className = 'drawerBadges';

      const days = vm.dates.daysSinceLastRegistration;
      let statusLabel, statusCls;
      if (vm.isClosed) {
        statusLabel = 'Lukket'; statusCls = 'badgeNeutral';
      } else if (days !== null && days >= 60) {
        statusLabel = 'OBS (' + days + ' dage)'; statusCls = 'badgeCritical';
      } else if (days !== null && days >= 30) {
        statusLabel = 'Stille (' + days + ' dage)'; statusCls = 'badgeWarning';
      } else {
        statusLabel = 'Aktiv'; statusCls = 'badgeNeutral';
      }
      const sb = document.createElement('span');
      sb.className = 'badge ' + statusCls;
      sb.textContent = statusLabel;
      badgeRow.appendChild(sb);

      if (vm.relation.isSubproject) {
        const ub = document.createElement('span');
        ub.className = 'badge badgeNeutral';
        ub.textContent = 'Underprojekt';
        badgeRow.appendChild(ub);
      }
      statusSection.appendChild(badgeRow);
      drawerBody.appendChild(statusSection);

      // Ansvarlig
      const responsibleSection = makeSection('Ansvarlig');
      const respLine = [vm.responsible.code, vm.responsible.name].filter(Boolean).join(' \u00b7 ') || null;
      responsibleSection.appendChild(makeField('Ansvarlig', respLine));
      const tlLine = [vm.responsible.teamLeaderCode, vm.responsible.teamLeaderName].filter(Boolean).join(' \u00b7 ') || null;
      if (tlLine) {
        responsibleSection.appendChild(makeField('Teamleder', tlLine));
      }
      drawerBody.appendChild(responsibleSection);

      // Relation
      if (vm.relation.isSubproject || vm.relation.parentProjectEkId) {
        const relSection = makeSection('Relation');
        relSection.appendChild(makeField('Overordnet projekt (EK nr.)', vm.relation.parentProjectEkId));
        relSection.appendChild(makePending('Overordnet ref. / antal underprojekter'));
        drawerBody.appendChild(relSection);
      }

      // Datoer
      const datesSection = makeSection('Datoer');
      datesSection.appendChild(makeGrid(
        makeField('Sidste aktivitet', fmtD(vm.dates.lastActivityDate)),
        makeField('Sidst opdateret', fmtD(vm.dates.updatedDate)),
        makeField('Seneste registrering', fmtD(vm.dates.lastRegistrationDate)),
        makeField('Seneste montørtime', fmtD(vm.dates.lastFitterHourDate))
      ));
      if (vm.dates.daysSinceLastRegistration !== null) {
        datesSection.appendChild(makeField('Dage siden registrering', String(vm.dates.daysSinceLastRegistration)));
      }
      datesSection.appendChild(makeGrid(
        makePending('Startdato'),
        makePending('Slutdato')
      ));
      drawerBody.appendChild(datesSection);

      // Budget & WIP
      const econSection = makeSection('Budget & WIP');
      if (vm.economy._hasWip) {
        econSection.appendChild(makeGrid(
          makeField('D\u00e6kning', vm.economy.coveragePercent !== null ? fmtN(vm.economy.coveragePercent, 1) + ' %' : null),
          makeField('Margin', vm.economy.wip.margin !== null ? fmtN(vm.economy.wip.margin, 0) + ' kr.' : null),
          makeField('Kost', vm.economy.wip.costs !== null ? fmtN(vm.economy.wip.costs, 0) + ' kr.' : null),
          makeField('Igangv\u00e6rende', vm.economy.wip.ongoing !== null ? fmtN(vm.economy.wip.ongoing, 0) + ' kr.' : null),
          makeField('Faktureret', vm.economy.wip.billed !== null ? fmtN(vm.economy.wip.billed, 0) + ' kr.' : null),
          makeField('Klar fakturering', vm.economy.wip.readyToBill !== null ? fmtN(vm.economy.wip.readyToBill, 0) + ' kr.' : null)
        ));
        econSection.appendChild(makeGrid(
          makeField('Budget timer', vm.economy.budget.hours !== null ? fmtN(vm.economy.budget.hours, 1) + ' t.' : null),
          makeField('Forventet omsætning', vm.economy.budget.totalExpected !== null ? fmtN(vm.economy.budget.totalExpected, 0) + ' kr.' : null)
        ));
      } else {
        econSection.appendChild(makePending('Budget & WIP'));
        if (vm.economy.budget.totalExpected !== null) {
          econSection.appendChild(makeField('Forventet omsætning (V4)', fmtN(vm.economy.budget.totalExpected, 0) + ' kr.'));
        }
      }
      drawerBody.appendChild(econSection);

      // Timer & Teknikere
      const timerSection = makeSection('Timer & Teknikere');
      if (summary && typeof summary === 'object') {
        const totalHoursNum = summary.total_project_relevant_hours !== null && summary.total_project_relevant_hours !== undefined
          ? Number(summary.total_project_relevant_hours)
          : null;
        const totalHoursLabel = totalHoursNum !== null
          ? totalHoursNum.toLocaleString('da-DK', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' t.'
          : null;
        timerSection.appendChild(makeField('Projekttimer', totalHoursLabel));
        const fitterNames = Array.isArray(summary.fitter_names) ? summary.fitter_names : [];
        if (fitterNames.length > 0) {
          timerSection.appendChild(makeField('Teknikere (' + fitterNames.length + ')', fitterNames.join(' \u00b7 ')));
        } else {
          timerSection.appendChild(makeField('Teknikere', 'Ingen'));
        }
      } else {
        const noTimerMsg = document.createElement('p');
        noTimerMsg.className = 'sectionState';
        noTimerMsg.textContent = 'Kunne ikke hente timer';
        timerSection.appendChild(noTimerMsg);
      }
      drawerBody.appendChild(timerSection);

      // Kunde — V3 pending
      const customerSection = makeSection('Kunde');
      customerSection.appendChild(makePending('Kundenavn'));
      customerSection.appendChild(makePending('Kontaktperson / telefon / e-mail'));
      drawerBody.appendChild(customerSection);

      // Adresse — V3 pending
      const addressSection = makeSection('Adresse');
      addressSection.appendChild(makePending('Adresse'));
      drawerBody.appendChild(addressSection);
    }

    function renderDrawerProject(project, summary) {
      const vm = mapProjectToDrawerViewModel(project);
      if (!vm) {
        renderDrawerError('Projektdata kunne ikke vises.');
        return;
      }
      if (drawerTitle) {
        drawerTitle.textContent = vm.projectName || 'Sag';
      }
      if (drawerRef) {
        drawerRef.textContent = 'Ref: ' + (vm.reference || '-');
      }
      if (openProjectPageLink && vm.projectId) {
        openProjectPageLink.href = '/project/' + encodeURIComponent(vm.projectId);
      }
      renderDrawerWithViewModel(vm, summary);
    }

    function renderDrawerNotFound() {
      if (drawerTitle) {
        drawerTitle.textContent = "Sag";
      }
      if (drawerRef) {
        drawerRef.textContent = "Ref: -";
      }
      renderDrawerFields([
        { label: "Fejl", value: "Projektet blev ikke fundet eller du har ikke adgang." },
      ], true);
    }

    function renderDrawerError(message) {
      renderDrawerFields([
        { label: "Fejl", value: message },
      ], true);
    }

    async function openProjectDrawer(project) {
      if (!project || !project.project_id) {
        return;
      }

      state.drawerProjectId = String(project.project_id);
      if (openProjectPageLink) {
        openProjectPageLink.href = `/project/${encodeURIComponent(state.drawerProjectId)}`;
      }
      renderDrawerLoading(project);
      openDrawer();

      const [projectResult, summaryResult] = await Promise.allSettled([
        apiFetch(`/api/projects/${encodeURIComponent(state.drawerProjectId)}`, { method: "GET" }),
        apiFetch(`/api/projects/${encodeURIComponent(state.drawerProjectId)}/fitterhours/summary`, { method: "GET" }),
      ]);

      if (projectResult.status === "rejected") {
        const error = projectResult.reason;
        if (handleAuthFailure(error)) return;
        if (error && error.status === 404) {
          renderDrawerNotFound();
          return;
        }
        renderDrawerError(`Kunne ikke hente projektet: ${getErrorMessage(error, "request_failed")}`);
        return;
      }

      const detail = projectResult.value && projectResult.value.project ? projectResult.value.project : null;
      if (!detail) {
        renderDrawerError("Projektdata mangler.");
        return;
      }

      const summary = summaryResult.status === "fulfilled" && summaryResult.value
        ? summaryResult.value.summary
        : null;

      renderDrawerProject(detail, summary);
    }

    function setSelectedOwners(ownerIds) {
      if (!Array.isArray(ownerIds) || ownerIds.length === 0) {
        state.selectedOwnerIds = new Set(["__ALL__"]);
        return;
      }

      if (ownerIds.includes("__ALL__")) {
        state.selectedOwnerIds = new Set(["__ALL__"]);
        return;
      }

      const valid = ownerIds.filter((id) => state.ownerOptions.some((option) => option.id === id));
      if (valid.length === 0) {
        state.selectedOwnerIds = new Set(["__ALL__"]);
        return;
      }

      state.selectedOwnerIds = new Set(valid);
    }

    function renderScopeChips() {
      if (!scopeRow || !scopeChips) {
        return;
      }

      if (state.ownerOptions.length < 2) {
        scopeRow.hidden = true;
        scopeChips.innerHTML = "";
        return;
      }

      scopeRow.hidden = false;
      scopeChips.innerHTML = "";

      function createChip(label, id) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "scopeChip";
        const allSelected = state.selectedOwnerIds.has("__ALL__");
        const isActive = id === "__ALL__" ? allSelected : (!allSelected && state.selectedOwnerIds.has(id));
        if (isActive) {
          chip.classList.add("active");
        }
        chip.textContent = label;
        chip.addEventListener("click", () => {
          if (id === "__ALL__") {
            setSelectedOwners(["__ALL__"]);
            renderProjects();
            return;
          }

          const current = state.selectedOwnerIds.has("__ALL__")
            ? new Set()
            : new Set(state.selectedOwnerIds);

          if (current.has(id)) {
            current.delete(id);
          } else {
            current.add(id);
          }

          setSelectedOwners(Array.from(current));
          renderProjects();
        });
        scopeChips.appendChild(chip);
      }

      createChip("Vis alle", "__ALL__");
      state.ownerOptions.forEach((option) => {
        createChip(option.label, option.id);
      });
    }

    function createProjectCard(project) {
      const statusView = getStatusView(project);
      const card = document.createElement("button");
      card.type = "button";
      card.className = "projectCard";
      if (project && project.project_id) {
        card.dataset.projectId = String(project.project_id);
      }

      const name = document.createElement("h3");
      name.className = "projectName";
      name.textContent = project && project.name ? project.name : "(uden navn)";

      const ref = document.createElement("p");
      ref.className = "projectRef";
      ref.textContent = `Ref: ${project && project.external_project_ref ? project.external_project_ref : "-"}`;

      const lineTwo = document.createElement("div");
      lineTwo.className = "projectLineTwo";

      const activity = document.createElement("span");
      activity.className = "activityText";
      activity.textContent = `Sidste aktivitet: ${formatActivityDate(statusView.activityDate)}`;

      lineTwo.appendChild(activity);
      lineTwo.appendChild(makeBadge(statusView));

      card.appendChild(name);
      card.appendChild(ref);
      card.appendChild(lineTwo);

      card.addEventListener("click", () => {
        openProjectDrawer(project);
      });

      return card;
    }

    function renderProjects() {
      const visibleProjects = getFilteredProjects();
      projectsContainer.innerHTML = "";
      renderScopeChips();

      const selectedCount = state.selectedOwnerIds.has("__ALL__")
        ? state.ownerOptions.length
        : state.selectedOwnerIds.size;
      const groupMode = selectedCount > 1;

      if (listMetaText) {
        const modeText = groupMode ? "Grupperet visning" : "Enkelt visning";
        const caseLabel = state.showingClosedFallback ? "lukkede sager" : "aktive sager";
        listMetaText.textContent = `${visibleProjects.length} ${caseLabel} · ${modeText}`;
      }

      if (visibleProjects.length === 0) {
        const emptyState = document.createElement("div");
        emptyState.className = "emptyState";
        emptyState.textContent = "Ingen sager fundet.";
        projectsContainer.appendChild(emptyState);
        return;
      }

      if (!groupMode) {
        visibleProjects.forEach((project) => {
          projectsContainer.appendChild(createProjectCard(project));
        });
        const renderedCards = projectsContainer.querySelectorAll(".projectCard").length;
        logProjectPipeline("after-grouping-dedup", visibleProjects, {
          group_mode: false,
          dedup_applied: false,
        });
        logProjectPipeline("final-render", visibleProjects, {
          rendered_cards: renderedCards,
        });
        return;
      }

      const groups = new Map();
      visibleProjects.forEach((project) => {
        const group = ownerLabel(project);
        if (!groups.has(group)) {
          groups.set(group, []);
        }
        groups.get(group).push(project);
      });

      const groupNames = Array.from(groups.keys()).sort((a, b) =>
        a.localeCompare(b, "da", { sensitivity: "base" })
      );

      groupNames.forEach((groupName) => {
        const groupProjects = groups.get(groupName) || [];
        const block = document.createElement("section");
        block.className = "groupBlock";

        const header = document.createElement("h2");
        header.className = "groupHeader";
        header.innerHTML = `<strong>${groupName}</strong><span>${groupProjects.length} sager</span>`;

        block.appendChild(header);
        groupProjects.forEach((project) => {
          block.appendChild(createProjectCard(project));
        });

        projectsContainer.appendChild(block);
      });

      const groupedCount = Array.from(groups.values()).reduce((sum, items) => sum + items.length, 0);
      const renderedCards = projectsContainer.querySelectorAll(".projectCard").length;
      logProjectPipeline("after-grouping-dedup", visibleProjects, {
        group_mode: true,
        dedup_applied: false,
        grouped_count: groupedCount,
      });
      logProjectPipeline("final-render", visibleProjects, {
        rendered_cards: renderedCards,
      });
    }

    async function loadProjects() {
      projectsContainer.innerHTML = "";
      if (listMetaText) {
        listMetaText.textContent = "Indlæser sager...";
      }

      try {
        const response = await apiFetch("/api/projects?scope=mine", { method: "GET" });
        state.projects = response && Array.isArray(response.projects) ? response.projects : [];
        state.ownerLabelMap.clear();
        logProjectPipeline("raw-api-fetch", state.projects, {
          endpoint: "/api/projects?scope=mine",
        });
        renderProjects();
      } catch (error) {
        if (handleAuthFailure(error)) {
          return;
        }
        const message = `Kunne ikke hente sager: ${getErrorMessage(error, "request_failed")}`;
        projectsContainer.textContent = message;
        if (listMetaText) {
          listMetaText.textContent = "Fejl under indlæsning";
        }
      }
    }

    async function loadSyncStatus() {
      if (syncOverallText) syncOverallText.textContent = "Indlæser...";
      if (syncBootstrapText) syncBootstrapText.textContent = "Indlæser...";
      if (syncDeltaText) syncDeltaText.textContent = "Indlæser...";
      if (syncLastSuccessText) syncLastSuccessText.textContent = "Indlæser...";
      if (syncBacklogText) syncBacklogText.textContent = "Indlæser...";
      if (syncNextRetryText) syncNextRetryText.textContent = "Indlæser...";
      if (syncRowsText) syncRowsText.textContent = "Indlæser...";

      try {
        const response = await apiFetch("/api/sync/status", { method: "GET" });
        const bootstrap = response && response.bootstrap ? response.bootstrap : null;
        const delta = response && response.delta ? response.delta : null;
        const endpointStates = response && Array.isArray(response.endpoint_states)
          ? response.endpoint_states
          : [];
        const endpointSummary = response && response.endpoint_summary ? response.endpoint_summary : null;
        const backlog = response && response.backlog ? response.backlog : null;

        const persistedRows = endpointStates.reduce((sum, row) => {
          const value = Number(row && row.rows_persisted ? row.rows_persisted : 0);
          return sum + (Number.isFinite(value) ? value : 0);
        }, 0);

        const latestSuccessCandidates = [];
        endpointStates.forEach((row) => {
          if (row && row.last_successful_sync_at) {
            latestSuccessCandidates.push(row.last_successful_sync_at);
          }
        });

        const latestSuccess = latestSuccessCandidates
          .map((value) => new Date(value))
          .filter((date) => !Number.isNaN(date.getTime()))
          .sort((a, b) => b.getTime() - a.getTime())[0];

        if (syncBootstrapText) {
          const progress = bootstrap
            ? `${bootstrap.pages_processed || 0} sider / ${bootstrap.rows_processed || 0} rows`
            : "-";
          syncBootstrapText.textContent = progress;
        }

        if (syncDeltaText) {
          const progress = delta
            ? `${delta.pages_processed || 0} sider / ${delta.rows_processed || 0} rows`
            : "-";
          syncDeltaText.textContent = progress;
        }

        if (syncLastSuccessText) {
          syncLastSuccessText.textContent = latestSuccess ? formatDateTimeValue(latestSuccess) : "-";
        }

        if (syncBacklogText) {
          const pending = backlog ? Number(backlog.pending_count || 0) : 0;
          const failed = backlog ? Number(backlog.failed_count || 0) : 0;
          syncBacklogText.textContent = `${pending} pending, ${failed} failed`;
        }

        if (syncNextRetryText) {
          syncNextRetryText.textContent = backlog && backlog.next_retry_at
            ? formatDateTimeValue(backlog.next_retry_at)
            : "-";
        }

        if (syncRowsText) {
          syncRowsText.textContent = String(persistedRows);
        }

        if (syncOverallText) {
          const overall = endpointSummary && endpointSummary.overall_status
            ? String(endpointSummary.overall_status)
            : computeOverallStatusFromEndpoints(endpointStates);
          const touched = endpointSummary ? Number(endpointSummary.touched_count || 0) : 0;
          const skipped = endpointSummary ? Number(endpointSummary.skipped_count || 0) : 0;
          const failed = endpointSummary ? Number(endpointSummary.failed_count || 0) : 0;
          syncOverallText.textContent = `${overall} · touched ${touched} · skipped ${skipped} · failed ${failed}`;
        }

        state.syncEndpointStates = endpointStates;
        renderSyncEndpointList();
      } catch (error) {
        if (handleAuthFailure(error)) {
          return;
        }

        if (syncBootstrapText) syncBootstrapText.textContent = "Utilgængelig";
        if (syncDeltaText) syncDeltaText.textContent = "Utilgængelig";
        if (syncLastSuccessText) syncLastSuccessText.textContent = "-";
        if (syncBacklogText) syncBacklogText.textContent = "-";
        if (syncNextRetryText) syncNextRetryText.textContent = "-";
        if (syncRowsText) syncRowsText.textContent = "-";
        if (syncOverallText) syncOverallText.textContent = "Utilgængelig";
        state.syncEndpointStates = [];
        renderSyncEndpointList();
      }
    }

    try {
      const me = await apiFetch("/api/me", { method: "GET" });
      state.me = me && me.user ? me.user : null;
      if (userPill) {
        const name = state.me && state.me.name ? state.me.name : "Ukendt bruger";
        const role = state.me && state.me.role ? state.me.role : "rolle ukendt";
        userPill.textContent = `${name} · ${role}`;
      }
    } catch (error) {
      if (handleAuthFailure(error)) {
        return;
      }
      if (userPill) {
        userPill.textContent = `Kunne ikke hente bruger: ${getErrorMessage(error, "request_failed")}`;
      }
      return;
    }

    if (sortSelect) {
      sortSelect.addEventListener("change", () => {
        state.sortMode = sortSelect.value;
        renderProjects();
      });
    }

    if (syncFilterSelect) {
      syncFilterSelect.addEventListener("change", () => {
        state.syncFilterMode = syncFilterSelect.value;
        renderSyncEndpointList();
      });
    }

    if (syncSortSelect) {
      syncSortSelect.addEventListener("change", () => {
        state.syncSortMode = syncSortSelect.value;
        renderSyncEndpointList();
      });
    }

    if (drawerCloseBtn) {
      drawerCloseBtn.addEventListener("click", closeDrawer);
    }

    if (drawerCloseSecondaryBtn) {
      drawerCloseSecondaryBtn.addEventListener("click", closeDrawer);
    }

    if (drawerOverlay) {
      drawerOverlay.addEventListener("click", closeDrawer);
    }

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && drawerShell && drawerShell.classList.contains("open")) {
        closeDrawer();
      }
    });

    await Promise.all([loadProjects(), loadSyncStatus()]);

    if (refreshSyncBtn) {
      refreshSyncBtn.addEventListener("click", () => {
        loadSyncStatus();
      });
    }

    if (openProjectPageLink) {
      openProjectPageLink.addEventListener("click", () => {
        closeDrawer();
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener("click", function () {
        logout();
      });
    }
  }

  function renderProjectDetail(vm) {
    function el(id) {
      return document.getElementById(id);
    }

    function setValue(id, value) {
      const node = el(id);
      if (!node) {
        return;
      }
      const safe = value === null || value === undefined || value === "" ? "\u2014" : String(value);
      node.textContent = safe;
      if (safe === "\u2014") {
        node.classList.add("fieldValueMuted");
      } else {
        node.classList.remove("fieldValueMuted");
      }
    }

    function formatDate(value) {
      if (!value) {
        return null;
      }
      try {
        return new Intl.DateTimeFormat("da-DK", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        }).format(value);
      } catch (_error) {
        return null;
      }
    }

    function formatMoney(value) {
      if (value === null || value === undefined) {
        return null;
      }
      return `${Number(value).toLocaleString("da-DK", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      })} kr.`;
    }

    const headerRef = el("projectHeaderRef");
    const headerName = el("projectHeaderName");
    const statusBadge = el("projectStatusBadge");
    const economySection = el("economySection");

    if (headerRef) {
      headerRef.textContent = `Ref: ${vm && vm.reference ? vm.reference : "-"}`;
    }

    if (headerName) {
      headerName.textContent = vm && vm.projectName ? vm.projectName : "(uden navn)";
    }

    if (statusBadge) {
      const toneClass = vm && vm.status && vm.status.tone === "critical"
        ? "badgeCritical"
        : vm && vm.status && vm.status.tone === "warning"
          ? "badgeWarning"
          : "badgeNeutral";
      statusBadge.className = `badge ${toneClass}`;
      statusBadge.textContent = vm && vm.status && vm.status.label ? vm.status.label : "Aktiv";
    }

    const responsibleText = vm
      ? [vm.responsible.code, vm.responsible.name].filter(Boolean).join(" · ")
      : null;
    const teamLeaderText = vm
      ? [vm.responsible.teamLeaderCode, vm.responsible.teamLeaderName].filter(Boolean).join(" · ")
      : null;

    setValue("detailResponsible", responsibleText);
    setValue("detailTeamLeader", teamLeaderText);
    setValue("detailParentProject", vm && vm.relation ? vm.relation.parentProjectEkId : null);
    setValue("detailActivityDate", vm && vm.dates ? formatDate(vm.dates.lastActivityDate) : null);
    setValue("detailUpdatedDate", vm && vm.dates ? formatDate(vm.dates.updatedDate) : null);
    setValue(
      "detailDaysSinceActivity",
      vm && vm.dates && typeof vm.dates.daysSinceActivity === "number"
        ? String(vm.dates.daysSinceActivity)
        : null
    );

    if (economySection) {
      economySection.hidden = !(vm && vm.economy && vm.economy._hasWip);
    }

    setValue("detailMargin", vm && vm.economy ? formatMoney(vm.economy.wip.margin) : null);
    setValue("detailCost", vm && vm.economy ? formatMoney(vm.economy.wip.costs) : null);
    setValue("detailOngoing", vm && vm.economy ? formatMoney(vm.economy.wip.ongoing) : null);
    setValue("detailBilled", vm && vm.economy ? formatMoney(vm.economy.wip.billed) : null);
  }

  function renderFittersSection(sectionVm) {
    const stateNode = document.getElementById("fittersState");
    const listNode = document.getElementById("fittersList");
    if (!stateNode || !listNode) {
      return;
    }

    listNode.innerHTML = "";

    if (!sectionVm || !sectionVm.hasData) {
      stateNode.hidden = false;
      stateNode.textContent = getSectionEmptyStateText("Teknikerdata", sectionVm ? sectionVm.emptyReason : "not_loaded");
      return;
    }

    stateNode.hidden = true;

    sectionVm.items.forEach((item) => {
      const card = document.createElement("div");
      card.className = "itemCard";

      const title = document.createElement("p");
      title.className = "itemTitle";
      title.textContent = item.name || "Ukendt tekniker";

      const meta = document.createElement("p");
      meta.className = "itemMeta";
      meta.textContent = [item.employeeCode, item.role].filter(Boolean).join(" · ") || "—";

      const badgeRow = document.createElement("div");
      badgeRow.className = "miniBadgeRow";

      if (item.isResponsible) {
        const b = document.createElement("span");
        b.className = "miniBadge";
        b.textContent = "Ansvarlig";
        badgeRow.appendChild(b);
      }

      if (item.isTeamLeader) {
        const b = document.createElement("span");
        b.className = "miniBadge";
        b.textContent = "Teamleder";
        badgeRow.appendChild(b);
      }

      if (item.isPending) {
        const b = document.createElement("span");
        b.className = "miniBadge miniBadgePending";
        b.textContent = "Afventer enrichment";
        badgeRow.appendChild(b);
      }

      card.appendChild(title);
      card.appendChild(meta);
      if (badgeRow.childElementCount > 0) {
        card.appendChild(badgeRow);
      }
      listNode.appendChild(card);
    });
  }

  function renderFitterHoursSection(sectionVm) {
    const stateNode = document.getElementById("hoursState");
    const listNode = document.getElementById("hoursList");
    const totalNode = document.getElementById("hoursTotal");
    const countNode = document.getElementById("hoursCount");
    const latestNode = document.getElementById("hoursLatest");
    if (!stateNode || !listNode || !totalNode || !countNode || !latestNode) {
      return;
    }

    function setSummary(node, value) {
      const safe = value === null || value === undefined || value === "" ? "\u2014" : String(value);
      node.textContent = safe;
    }

    function formatDate(value) {
      if (!value) {
        return null;
      }
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        return null;
      }
      try {
        return new Intl.DateTimeFormat("da-DK", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        }).format(parsed);
      } catch (_error) {
        return null;
      }
    }

    function formatHours(value) {
      if (value === null || value === undefined) {
        return null;
      }
      return Number(value).toLocaleString("da-DK", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      });
    }

    listNode.innerHTML = "";

    setSummary(totalNode, sectionVm && sectionVm.summary ? formatHours(sectionVm.summary.totalHours) : null);
    setSummary(countNode, sectionVm && sectionVm.summary ? sectionVm.summary.entryCount : null);
    setSummary(latestNode, sectionVm && sectionVm.summary ? formatDate(sectionVm.summary.latestEntryDate) : null);

    if (!sectionVm || !sectionVm.hasData) {
      stateNode.hidden = false;
      stateNode.textContent = getSectionEmptyStateText("Timer", sectionVm ? sectionVm.emptyReason : "not_loaded");
      return;
    }

    stateNode.hidden = true;

    sectionVm.items.forEach((item) => {
      const card = document.createElement("div");
      card.className = "itemCard";

      const title = document.createElement("p");
      title.className = "itemTitle";
      title.textContent = [formatDate(item.date), item.employeeName || item.employeeCode].filter(Boolean).join(" · ") || "Timeregistrering";

      const meta = document.createElement("p");
      meta.className = "itemMeta";
      meta.textContent = `${formatHours(item.hours) || "—"} timer`;

      card.appendChild(title);
      card.appendChild(meta);

      if (item.note) {
        const note = document.createElement("p");
        note.className = "itemMeta";
        note.textContent = item.note;
        card.appendChild(note);
      }

      listNode.appendChild(card);
    });
  }

  function renderFittersSectionFromBreakdown(breakdown) {
    if (!breakdown || !Array.isArray(breakdown.fitters)) {
      renderFittersSection({
        items: [],
        totalCount: 0,
        hasData: false,
        isPending: false,
        emptyReason: breakdown === null ? "no_fitters" : "not_loaded",
      });
      return;
    }

    const items = breakdown.fitters
      .map(function (f) {
        return {
          id: f.fitter_id || null,
          employeeCode: null,
          name: f.fitter_name || "Ukendt tekniker",
          role: f.total_hours !== null && f.total_hours !== undefined
            ? Number(f.total_hours).toLocaleString("da-DK", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " t."
            : null,
          relationType: "fitter",
          isResponsible: false,
          isTeamLeader: false,
          isPending: false,
          source: "business",
        };
      })
      .sort(function (a, b) {
        return (a.name || "").localeCompare(b.name || "", "da");
      });

    renderFittersSection({
      items: items,
      totalCount: items.length,
      hasData: items.length > 0,
      isPending: false,
      emptyReason: items.length === 0 ? "no_fitters" : "none",
    });
  }

  function renderHoursSectionFromBreakdown(breakdown) {
    if (!breakdown) {
      renderFitterHoursSection({
        items: [],
        summary: { totalHours: null, latestEntryDate: null, entryCount: null, groupedByEmployee: [] },
        hasData: false,
        isPending: false,
        emptyReason: "no_hours",
      });
      return;
    }

    const fitters = Array.isArray(breakdown.fitters) ? breakdown.fitters : [];
    const totalHours = breakdown.total_project_relevant_hours !== null && breakdown.total_project_relevant_hours !== undefined
      ? Number(breakdown.total_project_relevant_hours)
      : null;

    if (fitters.length === 0) {
      renderFitterHoursSection({
        items: [],
        summary: { totalHours: totalHours !== null ? totalHours : 0, latestEntryDate: null, entryCount: null, groupedByEmployee: [] },
        hasData: false,
        isPending: false,
        emptyReason: "no_hours",
      });
      return;
    }

    const items = fitters.map(function (f) {
      return {
        id: f.fitter_key || f.fitter_id || null,
        date: null,
        employeeCode: null,
        employeeName: f.fitter_name || "Ukendt tekniker",
        hours: f.total_hours !== null && f.total_hours !== undefined ? Number(f.total_hours) : null,
        note: null,
        source: "business",
        isPending: false,
      };
    });

    renderFitterHoursSection({
      items: items,
      summary: { totalHours: totalHours, latestEntryDate: null, entryCount: null, groupedByEmployee: [] },
      hasData: true,
      isPending: false,
      emptyReason: "none",
    });
  }

  function renderProjectDetailError(message) {
    const headerName = document.getElementById("projectHeaderName");
    const statusBadge = document.getElementById("projectStatusBadge");
    if (headerName) {
      headerName.textContent = message;
    }
    if (statusBadge) {
      statusBadge.className = "badge badgeCritical";
      statusBadge.textContent = "Fejl";
    }
  }

  async function initProjectPage() {
    if (!requireToken()) {
      return;
    }

    const logoutBtn = document.getElementById("logoutBtn");
    const projectId = getProjectIdFromPath();

    if (!projectId) {
      renderProjectDetailError("Ugyldig sagssti");
      return;
    }

    try {
      const [projectResult, breakdownResult] = await Promise.allSettled([
        apiFetch(`/api/projects/${encodeURIComponent(projectId)}`, { method: "GET" }),
        apiFetch(`/api/projects/${encodeURIComponent(projectId)}/fitterhours/breakdown`, { method: "GET" }),
      ]);

      if (projectResult.status === "rejected") {
        throw projectResult.reason;
      }

      const rawProject = projectResult.value && projectResult.value.project ? projectResult.value.project : null;
      const vm = mapProjectToQuickViewModel(rawProject);
      if (!vm) {
        renderProjectDetailError("Projektdata mangler");
      } else {
        renderProjectDetail(vm);
      }

      const breakdown = breakdownResult.status === "fulfilled" && breakdownResult.value
        ? breakdownResult.value.breakdown
        : null;
      renderFittersSectionFromBreakdown(breakdown);
      renderHoursSectionFromBreakdown(breakdown);
    } catch (error) {
      if (handleAuthFailure(error)) {
        return;
      }
      renderProjectDetailError(`Kunne ikke hente sag: ${getErrorMessage(error, "request_failed")}`);
      renderFittersSectionFromBreakdown(null);
      renderHoursSectionFromBreakdown(null);
    }

    if (logoutBtn) {
      logoutBtn.addEventListener("click", function () {
        logout();
      });
    }
  }

  if (document.body && document.body.dataset.page === "login") {
    initLoginPage();
  }

  if (document.body && document.body.dataset.page === "app") {
    initAppPage();
  }

  if (document.body && document.body.dataset.page === "project") {
    initProjectPage();
  }
})();
