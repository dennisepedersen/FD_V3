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

  function isTenantAdmin(user) {
    return String(user && user.role ? user.role : "").trim().toLowerCase() === "tenant_admin";
  }

  function setAdminNavigationVisibility(user) {
    const showAdmin = isTenantAdmin(user);
    document.querySelectorAll("[data-admin-nav]").forEach((item) => {
      item.hidden = !showAdmin;
    });
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
    const match = path.match(/^\/(?:project|sager)\/([^/]+)$/);
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
      error.details = payload && payload.error ? payload.error.details : null;
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
    const loginSubmitBtn = document.getElementById("loginSubmitBtn");

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      hideError();

      const login = document.getElementById("login").value.trim();
      const password = document.getElementById("password").value;
      const rememberMe = Boolean(document.getElementById("rememberMe")?.checked);
      if (loginSubmitBtn) {
        loginSubmitBtn.disabled = true;
        loginSubmitBtn.textContent = "Logger ind...";
      }

      try {
        const data = await apiFetch("/v1/auth/login", {
          method: "POST",
          headers: {},
          body: JSON.stringify({ login, password, remember_me: rememberMe }),
        });

        if (!data || !data.access_token) {
          throw new Error("missing_access_token");
        }

        setToken(data.access_token);
        window.location.href = "/app";
      } catch (error) {
        showError(getErrorMessage(error, "login_failed"));
      } finally {
        if (loginSubmitBtn) {
          loginSubmitBtn.disabled = false;
          loginSubmitBtn.textContent = "Åbn Fielddesk";
        }
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
    const appShell = document.querySelector(".appShell");
    const brandInitials = document.getElementById("brandInitials");
    const brandUserName = document.getElementById("brandUserName");
    const logoutBtn = document.getElementById("logoutBtn");
    const dashboardView = document.getElementById("dashboardView");
    const calendarView = document.getElementById("calendarView");
    const resourceGroupsView = document.getElementById("resourceGroupsView");
    const projectsView = document.getElementById("projectsView");
    const viewLinks = Array.from(document.querySelectorAll("[data-view-link]"));
    const calendarTabs = Array.from(document.querySelectorAll("[data-calendar-tab]"));
    const calendarPanels = Array.from(document.querySelectorAll("[data-calendar-panel]"));
    const calendarAccessNotice = document.getElementById("calendarAccessNotice");
    const absenceOverviewSection = document.getElementById("absenceOverviewSection");
    const absenceRangeSection = document.getElementById("absenceRangeSection");
    const absenceListSection = document.getElementById("absenceListSection");
    const absenceCreateSection = document.getElementById("absenceCreateSection");
    const absenceFromInput = document.getElementById("absenceFromInput");
    const absenceToInput = document.getElementById("absenceToInput");
    const absenceRefreshBtn = document.getElementById("absenceRefreshBtn");
    const absenceRangeStatus = document.getElementById("absenceRangeStatus");
    const absenceListMeta = document.getElementById("absenceListMeta");
    const absenceList = document.getElementById("absenceList");
    const absenceCreateForm = document.getElementById("absenceCreateForm");
    const absenceFitterSelect = document.getElementById("absenceFitterSelect");
    const absenceResourceStatus = document.getElementById("absenceResourceStatus");
    const absenceTypeSelect = document.getElementById("absenceTypeSelect");
    const absenceVisibilitySelect = document.getElementById("absenceVisibilitySelect");
    const absenceStartDateInput = document.getElementById("absenceStartDateInput");
    const absenceEndDateInput = document.getElementById("absenceEndDateInput");
    const absenceNoteInput = document.getElementById("absenceNoteInput");
    const absenceCreateBtn = document.getElementById("absenceCreateBtn");
    const absenceFormStatus = document.getElementById("absenceFormStatus");
    const absenceTodayCount = document.getElementById("absenceTodayCount");
    const absenceTodayHint = document.getElementById("absenceTodayHint");
    const absenceRestWeekCount = document.getElementById("absenceRestWeekCount");
    const absenceRestWeekHint = document.getElementById("absenceRestWeekHint");
    const absenceNextWeekCount = document.getElementById("absenceNextWeekCount");
    const absenceNextWeekHint = document.getElementById("absenceNextWeekHint");
    const resourceGroupAccessNotice = document.getElementById("resourceGroupAccessNotice");
    const resourceGroupToolbarSection = document.getElementById("resourceGroupToolbarSection");
    const resourceGroupCreateSection = document.getElementById("resourceGroupCreateSection");
    const resourceGroupListSection = document.getElementById("resourceGroupListSection");
    const resourceGroupEditSection = document.getElementById("resourceGroupEditSection");
    const resourceGroupMembersSection = document.getElementById("resourceGroupMembersSection");
    const resourceGroupManagersSection = document.getElementById("resourceGroupManagersSection");
    const resourceGroupIncludeArchivedInput = document.getElementById("resourceGroupIncludeArchivedInput");
    const resourceGroupRefreshBtn = document.getElementById("resourceGroupRefreshBtn");
    const resourceGroupListStatus = document.getElementById("resourceGroupListStatus");
    const resourceGroupListMeta = document.getElementById("resourceGroupListMeta");
    const resourceGroupList = document.getElementById("resourceGroupList");
    const resourceGroupCreateForm = document.getElementById("resourceGroupCreateForm");
    const resourceGroupCreateNameInput = document.getElementById("resourceGroupCreateNameInput");
    const resourceGroupCreateDescriptionInput = document.getElementById("resourceGroupCreateDescriptionInput");
    const resourceGroupCreateBtn = document.getElementById("resourceGroupCreateBtn");
    const resourceGroupCreateStatus = document.getElementById("resourceGroupCreateStatus");
    const resourceGroupEditForm = document.getElementById("resourceGroupEditForm");
    const resourceGroupEditNameInput = document.getElementById("resourceGroupEditNameInput");
    const resourceGroupEditDescriptionInput = document.getElementById("resourceGroupEditDescriptionInput");
    const resourceGroupEditStatusSelect = document.getElementById("resourceGroupEditStatusSelect");
    const resourceGroupEditSaveBtn = document.getElementById("resourceGroupEditSaveBtn");
    const resourceGroupArchiveBtn = document.getElementById("resourceGroupArchiveBtn");
    const resourceGroupEditMeta = document.getElementById("resourceGroupEditMeta");
    const resourceGroupEditStatus = document.getElementById("resourceGroupEditStatus");
    const resourceGroupMemberAddForm = document.getElementById("resourceGroupMemberAddForm");
    const resourceGroupMemberFitterSelect = document.getElementById("resourceGroupMemberFitterSelect");
    const resourceGroupMemberPrimarySelect = document.getElementById("resourceGroupMemberPrimarySelect");
    const resourceGroupMemberAddBtn = document.getElementById("resourceGroupMemberAddBtn");
    const resourceGroupMemberAddStatus = document.getElementById("resourceGroupMemberAddStatus");
    const resourceGroupMemberResourceStatus = document.getElementById("resourceGroupMemberResourceStatus");
    const resourceGroupMembersMeta = document.getElementById("resourceGroupMembersMeta");
    const resourceGroupMembersList = document.getElementById("resourceGroupMembersList");
    const resourceGroupManagersMeta = document.getElementById("resourceGroupManagersMeta");
    const resourceGroupManagersList = document.getElementById("resourceGroupManagersList");
    const dashboardWelcomeName = document.getElementById("dashboardWelcomeName");
    const dashboardDateText = document.getElementById("dashboardDateText");
    const dashboardProjectCount = document.getElementById("dashboardProjectCount");
    const dashboardOpenCount = document.getElementById("dashboardOpenCount");
    const projectOpenCount = document.getElementById("projectOpenCount");
    const dashboardAttentionCount = document.getElementById("dashboardAttentionCount");
    const dashboardQaStatus = document.getElementById("dashboardQaStatus");
    const moduleProjectsMeta = document.getElementById("moduleProjectsMeta");
    const projectSearchInput = document.getElementById("projectSearchInput");
    const currentScopeValue = document.getElementById("currentScopeValue");
    const caseMobileSearchInput = document.getElementById("caseMobileSearchInput");
    const caseMobileAvatar = document.getElementById("caseMobileAvatar");
    const caseFab = document.getElementById("caseFab");
    const caseDesktopCreateBtn = document.getElementById("caseDesktopCreateBtn");
    const sortSelect = document.getElementById("sortSelect");
    const listMetaText = document.getElementById("listMetaText");
    const scopeRow = document.getElementById("scopeRow");
    const scopeChips = document.getElementById("scopeChips");
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
      currentView: "dashboard",
      searchQuery: projectSearchInput && projectSearchInput.value ? String(projectSearchInput.value).trim() : "",
      caseFilter: "mine",
      projectsLoading: false,
      projectLoadError: "",
      expandedProjectRefs: new Set(),
      calendar: {
        activeTab: "absences",
        resourceScope: "mine",
        absences: [],
        from: "",
        to: "",
        loadedKey: "",
        loading: false,
        accessDenied: false,
        resources: [],
        resourcesLoaded: false,
        resourcesLoadedScope: "",
        resourcesLoading: false,
      },
      resourceGroups: {
        groups: [],
        includeArchived: false,
        selectedGroupId: "",
        members: [],
        managers: [],
        resources: [],
        resourcesLoaded: false,
        resourcesLoading: false,
        groupsLoaded: false,
        groupsLoading: false,
        detailsLoading: false,
        accessDenied: false,
      },
    };


    const ACTIVITY_FIELD_CANDIDATES = [
      "last_activity_at",
      "last_activity",
      "last_activity_date",
      "activity_at",
      "activity_date",
    ];
    const PIPELINE_TRACE_REFS = new Set();
    const PROJECT_LIST_DEBUG_ENABLED = false;
    const CALENDAR_RESOURCE_SCOPE_CONFIG = Object.freeze({
      mine: Object.freeze({
        key: "mine",
        label: "Mine medarbejdere",
        enabled: true,
        visible: true,
        endpoint: "/api/calendar/resources",
      }),
      group: Object.freeze({
        key: "group",
        label: "Mine grupper",
        enabled: false,
        visible: false,
        endpoint: null,
      }),
      all: Object.freeze({
        key: "all",
        label: "Alle medarbejdere",
        enabled: false,
        visible: false,
        endpoint: null,
      }),
    });

    function setText(node, value) {
      if (node) {
        node.textContent = value;
      }
    }

    function compactUserName(name) {
      const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
      if (parts.length <= 2) {
        return parts.join(" ") || "Fielddesk";
      }
      return `${parts[0]} ${parts[1].charAt(0).toUpperCase()}. ${parts[parts.length - 1]}`;
    }

    function getLoginInitials(user) {
      const login = String(
        (user && (user.username || user.login_name || user.loginName))
          || (user && user.email ? String(user.email).split("@")[0] : "")
          || ""
      ).trim();

      if (login) {
        return login.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase() || "FD";
      }

      const nameParts = String(user && user.name ? user.name : "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      const initials = nameParts.map((part) => part.charAt(0)).join("").slice(0, 4).toUpperCase();
      return initials || "FD";
    }

    function renderUserChrome() {
      const user = state.me || {};
      const displayName = compactUserName(user.name || "Fielddesk");
      setText(brandInitials, getLoginInitials(user));
      setText(brandUserName, displayName);
    }

    function formatDateInput(date) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }

    function parseDateInput(value) {
      const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) {
        return null;
      }
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      const date = new Date(year, month - 1, day);
      if (
        date.getFullYear() !== year
        || date.getMonth() !== month - 1
        || date.getDate() !== day
      ) {
        return null;
      }
      return date;
    }

    function addDays(date, days) {
      const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      next.setDate(next.getDate() + days);
      return next;
    }

    function getWeekStart(date) {
      const day = date.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      return addDays(date, diff);
    }

    function getAbsenceDateDefaults() {
      const today = new Date();
      const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const nextWeekStart = addDays(getWeekStart(todayOnly), 7);
      return {
        today: todayOnly,
        from: formatDateInput(todayOnly),
        to: formatDateInput(addDays(nextWeekStart, 6)),
      };
    }

    function ensureCalendarDefaults() {
      if (!state.calendar.from || !state.calendar.to) {
        const defaults = getAbsenceDateDefaults();
        state.calendar.from = defaults.from;
        state.calendar.to = defaults.to;
      }
      if (absenceFromInput && !absenceFromInput.value) {
        absenceFromInput.value = state.calendar.from;
      }
      if (absenceToInput && !absenceToInput.value) {
        absenceToInput.value = state.calendar.to;
      }
      if (absenceStartDateInput && !absenceStartDateInput.value) {
        absenceStartDateInput.value = state.calendar.from;
      }
      if (absenceEndDateInput && !absenceEndDateInput.value) {
        absenceEndDateInput.value = state.calendar.from;
      }
    }

    function formatShortDate(value) {
      const date = parseDateInput(String(value || "").slice(0, 10));
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
        return formatDateInput(date);
      }
    }

    function getAbsenceTypeLabel(type) {
      const labels = {
        vacation: "Ferie",
        vacation_free: "Feriefri",
        course: "Kursus",
        sickness: "Sygdom",
        other: "Andet",
      };
      return labels[type] || String(type || "Ukendt");
    }

    function getAbsenceStatusLabel(status) {
      const labels = {
        draft: "Kladde",
        requested: "Anmodet",
        approved: "Godkendt",
        rejected: "Afvist",
        cancelled: "Annulleret",
      };
      return labels[status] || String(status || "Ukendt");
    }

    function getAbsencePersonLabel(absence) {
      return String(
        (absence && (absence.fitter_name || absence.fitter_username || absence.fitter_email || absence.fitter_id))
        || "Ukendt medarbejder"
      );
    }

    function getResourceOptionLabel(resource) {
      const label = String(resource && resource.label ? resource.label : "").trim();
      const name = String(resource && resource.name ? resource.name : "").trim();
      const initials = String(resource && resource.initials ? resource.initials : "").trim();
      const fallback = String(resource && resource.fitter_id ? resource.fitter_id : "").trim();
      if (label) {
        return initials && !label.includes(initials) ? `${label} (${initials})` : label;
      }
      if (name) {
        return initials && !name.includes(initials) ? `${name} (${initials})` : name;
      }
      return initials || fallback || "Ukendt medarbejder";
    }

    function getCalendarResourceScopeConfig() {
      return CALENDAR_RESOURCE_SCOPE_CONFIG;
    }

    function getCalendarResourceScopeDefinition(scope) {
      const normalized = String(scope || "mine").trim().toLowerCase();
      return getCalendarResourceScopeConfig()[normalized] || getCalendarResourceScopeConfig().mine;
    }

    function getActiveCalendarResourceScope() {
      const configuredScope = getCalendarResourceScopeDefinition(state.calendar.resourceScope);
      return configuredScope.enabled ? configuredScope.key : "mine";
    }

    function setActiveCalendarResourceScope(scope) {
      const nextScope = getCalendarResourceScopeDefinition(scope);
      state.calendar.resourceScope = nextScope.enabled ? nextScope.key : "mine";
      if (state.calendar.resourcesLoadedScope !== state.calendar.resourceScope) {
        state.calendar.resourcesLoaded = false;
      }
      return state.calendar.resourceScope;
    }

    function getCalendarResourceScopeEndpoint(scope) {
      const definition = getCalendarResourceScopeDefinition(scope);
      return definition.enabled ? definition.endpoint : null;
    }

    function renderResourceOptions() {
      if (!absenceFitterSelect) {
        return;
      }

      const previousValue = absenceFitterSelect.value;
      absenceFitterSelect.replaceChildren();

      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Vælg medarbejder";
      absenceFitterSelect.appendChild(placeholder);

      const resources = Array.isArray(state.calendar.resources) ? state.calendar.resources : [];
      resources.forEach((resource) => {
        const fitterId = String(resource && resource.fitter_id ? resource.fitter_id : "").trim();
        if (!fitterId) {
          return;
        }
        const option = document.createElement("option");
        option.value = fitterId;
        option.textContent = getResourceOptionLabel(resource);
        absenceFitterSelect.appendChild(option);
      });

      if (previousValue && resources.some((resource) => String(resource && resource.fitter_id) === previousValue)) {
        absenceFitterSelect.value = previousValue;
      }

      absenceFitterSelect.disabled = state.calendar.resourcesLoading || resources.length === 0;
      if (state.calendar.resourcesLoading) {
        setText(absenceResourceStatus, "Indlæser medarbejdere...");
      } else if (resources.length === 0 && state.calendar.resourcesLoaded) {
        setText(absenceResourceStatus, "Ingen aktive medarbejdere fundet.");
      } else if (resources.length > 0) {
        setText(absenceResourceStatus, resources.length === 1 ? "1 medarbejder fundet." : `${resources.length} medarbejdere fundet.`);
      }
    }

    function getResourceGroupStatusLabel(status) {
      return String(status || "").toLowerCase() === "archived" ? "Arkiveret" : "Aktiv";
    }

    function getManagerRoleLabel(role) {
      const labels = {
        owner: "Owner",
        manager: "Manager",
        viewer: "Viewer",
      };
      return labels[String(role || "").toLowerCase()] || "Ukendt";
    }

    function getResourceGroupMemberOptionLabel(resource) {
      const name = String(
        resource && (resource.name || resource.label || resource.fitter_id)
          ? (resource.name || resource.label || resource.fitter_id)
          : "Ukendt medarbejder"
      ).trim();
      const shortCode = String(resource && resource.short_code ? resource.short_code : "").trim().toUpperCase();
      const number = String(
        resource && (resource.old_reference || resource.salary_id || resource.fitter_id)
          ? (resource.old_reference || resource.salary_id || resource.fitter_id)
          : ""
      ).trim();
      const meta = [];
      if (shortCode) {
        meta.push(shortCode);
      }
      if (number && number !== shortCode) {
        meta.push(number);
      }
      const baseLabel = meta.length ? `${name} · ${meta.join(" · ")}` : name;
      const status = String(resource && resource.status ? resource.status : "").toLowerCase();
      if (status === "ended") {
        return `${baseLabel} - fratrådt`;
      }
      if (status === "inactive") {
        return `${baseLabel} - inaktiv`;
      }
      return baseLabel;
    }

    function getResourceGroupErrorMessage(error, fallback) {
      const code = error && error.code ? String(error.code) : "";
      const labels = {
        resource_group_access_denied: "Du har ikke adgang til ressourcegrupper.",
        resource_group_name_already_exists: "Der findes allerede en ressourcegruppe med det navn.",
        resource_group_name_required: "Navn er påkrævet.",
        invalid_resource_group_status: "Vælg en gyldig status.",
        invalid_resource_group_manager_role: "Vælg en gyldig manager-rolle.",
        resource_group_member_already_exists: "Medarbejderen er allerede i gruppen.",
        resource_group_manager_already_exists: "Brugeren er allerede manager på gruppen.",
        resource_group_not_found: "Ressourcegruppen blev ikke fundet.",
        resource_group_member_not_found: "Medlemmet blev ikke fundet.",
        resource_group_manager_not_found: "Manageren blev ikke fundet.",
        fitter_not_found: "Medarbejderen blev ikke fundet.",
        tenant_user_not_found: "Brugeren blev ikke fundet.",
        invalid_boolean: "Vælg ja eller nej.",
      };
      return labels[code] || getErrorMessage(error, fallback);
    }

    function getSelectedResourceGroup() {
      const selectedId = String(state.resourceGroups.selectedGroupId || "");
      return state.resourceGroups.groups.find((group) => String(group && group.id) === selectedId) || null;
    }

    function handleResourceGroupForbidden(error, statusElement) {
      if (!error || error.status !== 403) {
        return false;
      }
      state.resourceGroups.accessDenied = true;
      renderResourceGroupAccessState();
      setText(statusElement, getResourceGroupErrorMessage(error, "Du har ikke adgang til ressourcegrupper."));
      return true;
    }

    function renderResourceGroupAccessState() {
      const accessDenied = state.resourceGroups.accessDenied || !isTenantAdmin(state.me);
      if (resourceGroupAccessNotice) {
        resourceGroupAccessNotice.hidden = !accessDenied;
      }
      [
        resourceGroupToolbarSection,
        resourceGroupCreateSection,
        resourceGroupListSection,
        resourceGroupEditSection,
        resourceGroupMembersSection,
        resourceGroupManagersSection,
      ].forEach((section) => {
        if (section) {
          section.hidden = accessDenied || (
            (section === resourceGroupEditSection || section === resourceGroupMembersSection || section === resourceGroupManagersSection)
            && !getSelectedResourceGroup()
          );
        }
      });
    }

    function renderResourceGroupResourceOptions() {
      if (!resourceGroupMemberFitterSelect) {
        return;
      }

      const previousValue = resourceGroupMemberFitterSelect.value;
      resourceGroupMemberFitterSelect.replaceChildren();

      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Vælg medarbejder";
      resourceGroupMemberFitterSelect.appendChild(placeholder);

      const existingMemberIds = new Set(state.resourceGroups.members.map((member) => String(member && member.fitter_id)));
      const resources = Array.isArray(state.resourceGroups.resources) ? state.resourceGroups.resources : [];
      resources.forEach((resource) => {
        const fitterId = String(resource && resource.fitter_id ? resource.fitter_id : "").trim();
        if (!fitterId || existingMemberIds.has(fitterId)) {
          return;
        }
        const option = document.createElement("option");
        option.value = fitterId;
        option.textContent = getResourceGroupMemberOptionLabel(resource);
        resourceGroupMemberFitterSelect.appendChild(option);
      });

      if (previousValue) {
        resourceGroupMemberFitterSelect.value = previousValue;
      }

      const availableCount = Math.max(0, resourceGroupMemberFitterSelect.options.length - 1);
      resourceGroupMemberFitterSelect.disabled = state.resourceGroups.resourcesLoading || availableCount === 0;
      if (state.resourceGroups.resourcesLoading) {
        setText(resourceGroupMemberResourceStatus, "Indlæser medarbejdere...");
      } else if (resources.length === 0 && state.resourceGroups.resourcesLoaded) {
        setText(resourceGroupMemberResourceStatus, "Ingen medarbejdere fundet i det nuværende fitter-grundlag.");
      } else if (availableCount === 0 && state.resourceGroups.resourcesLoaded) {
        setText(resourceGroupMemberResourceStatus, "Alle tilgængelige medarbejdere i fitter-grundlaget er allerede i gruppen.");
      } else if (availableCount > 0) {
        setText(resourceGroupMemberResourceStatus, availableCount === 1 ? "1 medarbejder kan tilføjes." : `${availableCount} medarbejdere kan tilføjes.`);
      }
    }

    function renderResourceGroupList() {
      if (!resourceGroupList) {
        return;
      }
      resourceGroupList.replaceChildren();
      const groups = Array.isArray(state.resourceGroups.groups) ? state.resourceGroups.groups : [];
      setText(resourceGroupListMeta, groups.length === 1 ? "1 gruppe fundet." : `${groups.length} grupper fundet.`);

      if (groups.length === 0) {
        const empty = document.createElement("p");
        empty.className = "calendarMessage";
        empty.textContent = state.resourceGroups.includeArchived ? "Ingen ressourcegrupper fundet." : "Ingen aktive ressourcegrupper fundet.";
        resourceGroupList.appendChild(empty);
        return;
      }

      groups.forEach((group) => {
        const groupId = String(group && group.id ? group.id : "");
        const card = document.createElement("article");
        card.className = "resourceGroupCard";
        card.classList.toggle("active", groupId && groupId === state.resourceGroups.selectedGroupId);

        const header = document.createElement("div");
        header.className = "resourceGroupCardHeader";

        const title = document.createElement("p");
        title.className = "resourceGroupName";
        title.textContent = String(group && group.name ? group.name : "Unavngivet gruppe");

        const status = document.createElement("span");
        status.className = String(group && group.status) === "archived" ? "tag tagPreview" : "tag tagLive";
        status.textContent = getResourceGroupStatusLabel(group && group.status);

        header.append(title, status);

        const description = document.createElement("p");
        description.className = "resourceGroupNote";
        description.textContent = group && group.description ? String(group.description) : "Ingen beskrivelse.";

        const actions = document.createElement("div");
        actions.className = "resourceGroupActions";

        const selectButton = document.createElement("button");
        selectButton.className = "btn btnCompact";
        selectButton.type = "button";
        selectButton.textContent = "Åbn";
        selectButton.addEventListener("click", () => {
          selectResourceGroup(groupId);
        });
        actions.appendChild(selectButton);

        const archiveButton = document.createElement("button");
        archiveButton.className = "btn btnCompact";
        archiveButton.type = "button";
        archiveButton.textContent = String(group && group.status) === "archived" ? "Aktivér" : "Arkivér";
        archiveButton.addEventListener("click", () => {
          updateResourceGroupStatus(groupId, String(group && group.status) === "archived" ? "active" : "archived");
        });
        actions.appendChild(archiveButton);

        card.append(header, description, actions);
        resourceGroupList.appendChild(card);
      });
    }

    function fillResourceGroupEditForm() {
      const group = getSelectedResourceGroup();
      if (!group) {
        return;
      }
      if (resourceGroupEditNameInput) {
        resourceGroupEditNameInput.value = group.name || "";
      }
      if (resourceGroupEditDescriptionInput) {
        resourceGroupEditDescriptionInput.value = group.description || "";
      }
      if (resourceGroupEditStatusSelect) {
        resourceGroupEditStatusSelect.value = group.status === "archived" ? "archived" : "active";
      }
      setText(resourceGroupEditMeta, group.name || "Valgt gruppe");
      if (resourceGroupArchiveBtn) {
        resourceGroupArchiveBtn.textContent = group.status === "archived" ? "Aktivér" : "Arkivér";
      }
    }

    function renderResourceGroupMembers() {
      if (!resourceGroupMembersList) {
        return;
      }
      resourceGroupMembersList.replaceChildren();
      const group = getSelectedResourceGroup();
      const members = Array.isArray(state.resourceGroups.members) ? state.resourceGroups.members : [];
      setText(resourceGroupMembersMeta, group ? (members.length === 1 ? "1 medlem." : `${members.length} medlemmer.`) : "Vælg en gruppe.");
      renderResourceGroupResourceOptions();

      if (!group) {
        return;
      }
      if (members.length === 0) {
        const empty = document.createElement("p");
        empty.className = "calendarMessage";
        empty.textContent = "Ingen medlemmer i gruppen endnu.";
        resourceGroupMembersList.appendChild(empty);
        return;
      }

      members.forEach((member) => {
        const fitterId = String(member && member.fitter_id ? member.fitter_id : "");
        const card = document.createElement("article");
        card.className = "resourceGroupDetailCard";

        const header = document.createElement("div");
        header.className = "resourceGroupDetailHeader";

        const title = document.createElement("p");
        title.className = "resourceGroupDetailName";
        title.textContent = getResourceOptionLabel(member);

        const tag = document.createElement("span");
        tag.className = member && member.is_primary ? "tag tagLive" : "tag";
        tag.textContent = member && member.is_primary ? "Primær" : "Medlem";
        header.append(title, tag);

        const meta = document.createElement("p");
        meta.className = "resourceGroupMeta";
        meta.textContent = `Fitter ID: ${fitterId || "-"}`;

        const actions = document.createElement("div");
        actions.className = "resourceGroupActions";

        const primaryButton = document.createElement("button");
        primaryButton.className = "btn btnCompact";
        primaryButton.type = "button";
        primaryButton.textContent = member && member.is_primary ? "Sæt ikke primær" : "Sæt primær";
        primaryButton.addEventListener("click", () => {
          updateResourceGroupMember(fitterId, !(member && member.is_primary));
        });

        const removeButton = document.createElement("button");
        removeButton.className = "btn btnCompact";
        removeButton.type = "button";
        removeButton.textContent = "Fjern";
        removeButton.addEventListener("click", () => {
          removeResourceGroupMember(fitterId);
        });

        actions.append(primaryButton, removeButton);
        card.append(header, meta, actions);
        resourceGroupMembersList.appendChild(card);
      });
    }

    function renderResourceGroupManagers() {
      if (!resourceGroupManagersList) {
        return;
      }
      resourceGroupManagersList.replaceChildren();
      const group = getSelectedResourceGroup();
      const managers = Array.isArray(state.resourceGroups.managers) ? state.resourceGroups.managers : [];
      setText(resourceGroupManagersMeta, group ? (managers.length === 1 ? "1 manager." : `${managers.length} managers.`) : "Vælg en gruppe.");

      if (!group) {
        return;
      }
      if (managers.length === 0) {
        const empty = document.createElement("p");
        empty.className = "calendarMessage";
        empty.textContent = "Ingen managers på gruppen endnu.";
        resourceGroupManagersList.appendChild(empty);
        return;
      }

      managers.forEach((manager) => {
        const tenantUserId = String(manager && manager.tenant_user_id ? manager.tenant_user_id : "");
        const card = document.createElement("article");
        card.className = "resourceGroupDetailCard";

        const header = document.createElement("div");
        header.className = "resourceGroupDetailHeader";

        const title = document.createElement("p");
        title.className = "resourceGroupDetailName";
        title.textContent = String((manager && (manager.name || manager.email)) || "Ukendt bruger");

        const tag = document.createElement("span");
        tag.className = "tag tagLive";
        tag.textContent = getManagerRoleLabel(manager && manager.manager_role);
        header.append(title, tag);

        const meta = document.createElement("p");
        meta.className = "resourceGroupMeta";
        meta.textContent = `${manager && manager.email ? manager.email : "Ingen email"} · ${tenantUserId}`;

        const roleLabel = document.createElement("label");
        roleLabel.className = "resourceGroupField";
        roleLabel.textContent = "Rolle";
        const roleSelect = document.createElement("select");
        ["owner", "manager", "viewer"].forEach((role) => {
          const option = document.createElement("option");
          option.value = role;
          option.textContent = getManagerRoleLabel(role);
          roleSelect.appendChild(option);
        });
        roleSelect.value = String(manager && manager.manager_role ? manager.manager_role : "viewer");
        roleSelect.addEventListener("change", () => {
          updateResourceGroupManager(tenantUserId, roleSelect.value);
        });
        roleLabel.appendChild(roleSelect);

        const actions = document.createElement("div");
        actions.className = "resourceGroupActions";
        const removeButton = document.createElement("button");
        removeButton.className = "btn btnCompact";
        removeButton.type = "button";
        removeButton.textContent = "Fjern";
        removeButton.addEventListener("click", () => {
          removeResourceGroupManager(tenantUserId);
        });
        actions.appendChild(removeButton);

        card.append(header, meta, roleLabel, actions);
        resourceGroupManagersList.appendChild(card);
      });
    }

    function renderResourceGroupAdmin() {
      renderResourceGroupAccessState();
      renderResourceGroupList();
      fillResourceGroupEditForm();
      renderResourceGroupMembers();
      renderResourceGroupManagers();
    }

    async function loadResourceGroupResources(options) {
      if (!isTenantAdmin(state.me)) {
        return;
      }
      if (!(options && options.force) && state.resourceGroups.resourcesLoaded) {
        renderResourceGroupResourceOptions();
        return;
      }

      state.resourceGroups.resourcesLoading = true;
      renderResourceGroupResourceOptions();
      try {
        const response = await apiFetch("/api/resource-groups/member-resources", { method: "GET" });
        state.resourceGroups.resources = response && Array.isArray(response.resources) ? response.resources : [];
        state.resourceGroups.resourcesLoaded = true;
      } catch (error) {
        if (handleResourceGroupForbidden(error, resourceGroupMemberResourceStatus)) {
          return;
        }
        if (handleAuthFailure(error)) {
          return;
        }
        state.resourceGroups.resources = [];
        state.resourceGroups.resourcesLoaded = false;
        setText(resourceGroupMemberResourceStatus, `Kunne ikke hente medarbejdere: ${getResourceGroupErrorMessage(error, "request_failed")}`);
      } finally {
        state.resourceGroups.resourcesLoading = false;
        renderResourceGroupResourceOptions();
      }
    }

    async function loadResourceGroups(options) {
      renderResourceGroupAccessState();
      if (!isTenantAdmin(state.me)) {
        state.resourceGroups.accessDenied = true;
        renderResourceGroupAccessState();
        return;
      }

      if (!(options && options.force) && state.resourceGroups.groupsLoaded) {
        renderResourceGroupAdmin();
        return;
      }

      state.resourceGroups.groupsLoading = true;
      setText(resourceGroupListStatus, "Indlæser grupper...");
      setText(resourceGroupListMeta, "Indlæser grupper...");
      try {
        const query = state.resourceGroups.includeArchived ? "?include_archived=true" : "";
        const response = await apiFetch(`/api/resource-groups${query}`, { method: "GET" });
        state.resourceGroups.groups = response && Array.isArray(response.groups) ? response.groups : [];
        state.resourceGroups.groupsLoaded = true;
        state.resourceGroups.accessDenied = false;
        if (state.resourceGroups.selectedGroupId && !getSelectedResourceGroup()) {
          state.resourceGroups.selectedGroupId = "";
          state.resourceGroups.members = [];
          state.resourceGroups.managers = [];
        }
        setText(resourceGroupListStatus, state.resourceGroups.includeArchived ? "Viser aktive og arkiverede grupper." : "Viser aktive grupper.");
        renderResourceGroupAdmin();
      } catch (error) {
        if (error && error.status === 403) {
          state.resourceGroups.accessDenied = true;
          renderResourceGroupAccessState();
          return;
        }
        if (handleAuthFailure(error)) {
          return;
        }
        setText(resourceGroupListStatus, `Kunne ikke hente grupper: ${getResourceGroupErrorMessage(error, "request_failed")}`);
        setText(resourceGroupListMeta, "Fejl under indlæsning.");
      } finally {
        state.resourceGroups.groupsLoading = false;
      }
    }

    async function loadResourceGroupDetails(options) {
      const group = getSelectedResourceGroup();
      if (!group || !isTenantAdmin(state.me)) {
        renderResourceGroupAdmin();
        return;
      }
      if (state.resourceGroups.detailsLoading && !(options && options.force)) {
        return;
      }

      state.resourceGroups.detailsLoading = true;
      setText(resourceGroupMembersMeta, "Indlæser medlemmer...");
      setText(resourceGroupManagersMeta, "Indlæser managers...");
      try {
        const [membersResponse, managersResponse] = await Promise.all([
          apiFetch(`/api/resource-groups/${encodeURIComponent(group.id)}/members`, { method: "GET" }),
          apiFetch(`/api/resource-groups/${encodeURIComponent(group.id)}/managers`, { method: "GET" }),
          loadResourceGroupResources(),
        ]);
        state.resourceGroups.members = membersResponse && Array.isArray(membersResponse.members) ? membersResponse.members : [];
        state.resourceGroups.managers = managersResponse && Array.isArray(managersResponse.managers) ? managersResponse.managers : [];
        renderResourceGroupAdmin();
      } catch (error) {
        if (error && error.status === 403) {
          state.resourceGroups.accessDenied = true;
          renderResourceGroupAccessState();
          return;
        }
        if (handleAuthFailure(error)) {
          return;
        }
        const message = `Kunne ikke hente gruppedetaljer: ${getResourceGroupErrorMessage(error, "request_failed")}`;
        setText(resourceGroupMembersMeta, message);
        setText(resourceGroupManagersMeta, message);
      } finally {
        state.resourceGroups.detailsLoading = false;
      }
    }

    function selectResourceGroup(groupId) {
      state.resourceGroups.selectedGroupId = String(groupId || "");
      state.resourceGroups.members = [];
      state.resourceGroups.managers = [];
      setText(resourceGroupEditStatus, "");
      setText(resourceGroupMemberAddStatus, "");
      renderResourceGroupAdmin();
      loadResourceGroupDetails({ force: true });
    }

    function getResourceGroupCreateInput() {
      const name = resourceGroupCreateNameInput ? String(resourceGroupCreateNameInput.value || "").trim() : "";
      const description = resourceGroupCreateDescriptionInput ? String(resourceGroupCreateDescriptionInput.value || "").trim() : "";
      if (!name) {
        return { error: "Navn er påkrævet." };
      }
      return { input: { name, description: description || null } };
    }

    function getResourceGroupEditInput() {
      const name = resourceGroupEditNameInput ? String(resourceGroupEditNameInput.value || "").trim() : "";
      const description = resourceGroupEditDescriptionInput ? String(resourceGroupEditDescriptionInput.value || "").trim() : "";
      const status = resourceGroupEditStatusSelect ? String(resourceGroupEditStatusSelect.value || "").trim() : "active";
      if (!name) {
        return { error: "Navn er påkrævet." };
      }
      if (status !== "active" && status !== "archived") {
        return { error: "Vælg en gyldig status." };
      }
      return { input: { name, description: description || null, status } };
    }

    async function submitResourceGroupCreate(event) {
      event.preventDefault();
      const result = getResourceGroupCreateInput();
      if (result.error) {
        setText(resourceGroupCreateStatus, result.error);
        return;
      }

      if (resourceGroupCreateBtn) {
        resourceGroupCreateBtn.disabled = true;
      }
      setText(resourceGroupCreateStatus, "Opretter gruppe...");
      try {
        const response = await apiFetch("/api/resource-groups", {
          method: "POST",
          body: JSON.stringify(result.input),
        });
        const groupId = response && response.group && response.group.id ? String(response.group.id) : "";
        if (resourceGroupCreateForm) {
          resourceGroupCreateForm.reset();
        }
        setText(resourceGroupCreateStatus, "Gruppe oprettet.");
        state.resourceGroups.groupsLoaded = false;
        await loadResourceGroups({ force: true });
        if (groupId) {
          selectResourceGroup(groupId);
        }
      } catch (error) {
        if (handleResourceGroupForbidden(error, resourceGroupCreateStatus)) {
          return;
        }
        if (handleAuthFailure(error)) {
          return;
        }
        setText(resourceGroupCreateStatus, `Kunne ikke oprette gruppe: ${getResourceGroupErrorMessage(error, "request_failed")}`);
      } finally {
        if (resourceGroupCreateBtn) {
          resourceGroupCreateBtn.disabled = false;
        }
      }
    }

    async function submitResourceGroupEdit(event) {
      event.preventDefault();
      const group = getSelectedResourceGroup();
      if (!group) {
        setText(resourceGroupEditStatus, "Vælg en gruppe først.");
        return;
      }
      const result = getResourceGroupEditInput();
      if (result.error) {
        setText(resourceGroupEditStatus, result.error);
        return;
      }

      if (resourceGroupEditSaveBtn) {
        resourceGroupEditSaveBtn.disabled = true;
      }
      setText(resourceGroupEditStatus, "Gemmer ændringer...");
      try {
        await apiFetch(`/api/resource-groups/${encodeURIComponent(group.id)}`, {
          method: "PATCH",
          body: JSON.stringify(result.input),
        });
        setText(resourceGroupEditStatus, "Ændringer gemt.");
        state.resourceGroups.groupsLoaded = false;
        await loadResourceGroups({ force: true });
      } catch (error) {
        if (handleResourceGroupForbidden(error, resourceGroupEditStatus)) {
          return;
        }
        if (handleAuthFailure(error)) {
          return;
        }
        setText(resourceGroupEditStatus, `Kunne ikke gemme gruppe: ${getResourceGroupErrorMessage(error, "request_failed")}`);
      } finally {
        if (resourceGroupEditSaveBtn) {
          resourceGroupEditSaveBtn.disabled = false;
        }
      }
    }

    async function updateResourceGroupStatus(groupId, status) {
      const group = state.resourceGroups.groups.find((candidate) => String(candidate && candidate.id) === String(groupId));
      if (!group) {
        return;
      }
      setText(resourceGroupEditStatus, status === "archived" ? "Arkiverer gruppe..." : "Aktiverer gruppe...");
      try {
        await apiFetch(`/api/resource-groups/${encodeURIComponent(group.id)}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: group.name,
            description: group.description || null,
            status,
          }),
        });
        state.resourceGroups.groupsLoaded = false;
        await loadResourceGroups({ force: true });
      } catch (error) {
        if (handleResourceGroupForbidden(error, resourceGroupEditStatus)) {
          return;
        }
        if (handleAuthFailure(error)) {
          return;
        }
        setText(resourceGroupEditStatus, `Kunne ikke ændre status: ${getResourceGroupErrorMessage(error, "request_failed")}`);
      }
    }

    async function submitResourceGroupMemberAdd(event) {
      event.preventDefault();
      const group = getSelectedResourceGroup();
      const fitterId = resourceGroupMemberFitterSelect ? String(resourceGroupMemberFitterSelect.value || "").trim() : "";
      const isPrimary = resourceGroupMemberPrimarySelect ? String(resourceGroupMemberPrimarySelect.value || "") === "true" : false;
      if (!group) {
        setText(resourceGroupMemberAddStatus, "Vælg en gruppe først.");
        return;
      }
      if (!fitterId) {
        setText(resourceGroupMemberAddStatus, "Vælg medarbejder.");
        return;
      }

      if (resourceGroupMemberAddBtn) {
        resourceGroupMemberAddBtn.disabled = true;
      }
      setText(resourceGroupMemberAddStatus, "Tilføjer medlem...");
      try {
        await apiFetch(`/api/resource-groups/${encodeURIComponent(group.id)}/members`, {
          method: "POST",
          body: JSON.stringify({ fitter_id: fitterId, is_primary: isPrimary }),
        });
        setText(resourceGroupMemberAddStatus, "Medlem tilføjet.");
        if (resourceGroupMemberFitterSelect) {
          resourceGroupMemberFitterSelect.value = "";
        }
        await loadResourceGroupDetails({ force: true });
      } catch (error) {
        if (handleResourceGroupForbidden(error, resourceGroupMemberAddStatus)) {
          return;
        }
        if (handleAuthFailure(error)) {
          return;
        }
        setText(resourceGroupMemberAddStatus, `Kunne ikke tilføje medlem: ${getResourceGroupErrorMessage(error, "request_failed")}`);
      } finally {
        if (resourceGroupMemberAddBtn) {
          resourceGroupMemberAddBtn.disabled = false;
        }
      }
    }

    async function updateResourceGroupMember(fitterId, isPrimary) {
      const group = getSelectedResourceGroup();
      if (!group || !fitterId) {
        return;
      }
      setText(resourceGroupMemberAddStatus, "Opdaterer medlem...");
      try {
        await apiFetch(`/api/resource-groups/${encodeURIComponent(group.id)}/members/${encodeURIComponent(fitterId)}`, {
          method: "PATCH",
          body: JSON.stringify({ is_primary: isPrimary === true }),
        });
        await loadResourceGroupDetails({ force: true });
        setText(resourceGroupMemberAddStatus, "Medlem opdateret.");
      } catch (error) {
        if (handleResourceGroupForbidden(error, resourceGroupMemberAddStatus)) {
          return;
        }
        if (handleAuthFailure(error)) {
          return;
        }
        setText(resourceGroupMemberAddStatus, `Kunne ikke opdatere medlem: ${getResourceGroupErrorMessage(error, "request_failed")}`);
      }
    }

    async function removeResourceGroupMember(fitterId) {
      const group = getSelectedResourceGroup();
      if (!group || !fitterId) {
        return;
      }
      setText(resourceGroupMemberAddStatus, "Fjerner medlem...");
      try {
        await apiFetch(`/api/resource-groups/${encodeURIComponent(group.id)}/members/${encodeURIComponent(fitterId)}`, {
          method: "DELETE",
        });
        await loadResourceGroupDetails({ force: true });
        setText(resourceGroupMemberAddStatus, "Medlem fjernet.");
      } catch (error) {
        if (handleResourceGroupForbidden(error, resourceGroupMemberAddStatus)) {
          return;
        }
        if (handleAuthFailure(error)) {
          return;
        }
        setText(resourceGroupMemberAddStatus, `Kunne ikke fjerne medlem: ${getResourceGroupErrorMessage(error, "request_failed")}`);
      }
    }

    async function updateResourceGroupManager(tenantUserId, managerRole) {
      const group = getSelectedResourceGroup();
      if (!group || !tenantUserId) {
        return;
      }
      try {
        await apiFetch(`/api/resource-groups/${encodeURIComponent(group.id)}/managers/${encodeURIComponent(tenantUserId)}`, {
          method: "PATCH",
          body: JSON.stringify({ manager_role: managerRole }),
        });
        await loadResourceGroupDetails({ force: true });
      } catch (error) {
        if (handleResourceGroupForbidden(error, resourceGroupManagersMeta)) {
          return;
        }
        if (handleAuthFailure(error)) {
          return;
        }
        setText(resourceGroupManagersMeta, `Kunne ikke opdatere manager: ${getResourceGroupErrorMessage(error, "request_failed")}`);
      }
    }

    async function removeResourceGroupManager(tenantUserId) {
      const group = getSelectedResourceGroup();
      if (!group || !tenantUserId) {
        return;
      }
      try {
        await apiFetch(`/api/resource-groups/${encodeURIComponent(group.id)}/managers/${encodeURIComponent(tenantUserId)}`, {
          method: "DELETE",
        });
        await loadResourceGroupDetails({ force: true });
      } catch (error) {
        if (handleResourceGroupForbidden(error, resourceGroupManagersMeta)) {
          return;
        }
        if (handleAuthFailure(error)) {
          return;
        }
        setText(resourceGroupManagersMeta, `Kunne ikke fjerne manager: ${getResourceGroupErrorMessage(error, "request_failed")}`);
      }
    }

    function overlapsDateRange(absence, fromDate, toDate) {
      const start = parseDateInput(String(absence && absence.start_date ? absence.start_date : "").slice(0, 10));
      const end = parseDateInput(String(absence && absence.end_date ? absence.end_date : "").slice(0, 10));
      if (!start || !end || !fromDate || !toDate) {
        return false;
      }
      return start <= toDate && end >= fromDate;
    }

    function countAbsencesInRange(fromDate, toDate) {
      return state.calendar.absences.filter((absence) => overlapsDateRange(absence, fromDate, toDate)).length;
    }

    function renderAbsenceOverview() {
      const defaults = getAbsenceDateDefaults();
      const today = defaults.today;
      const currentWeekEnd = addDays(getWeekStart(today), 6);
      const restOfWeekStart = addDays(today, 1);
      const nextWeekStart = addDays(getWeekStart(today), 7);
      const nextWeekEnd = addDays(nextWeekStart, 6);
      const todayCount = countAbsencesInRange(today, today);
      const restCount = restOfWeekStart <= currentWeekEnd
        ? countAbsencesInRange(restOfWeekStart, currentWeekEnd)
        : 0;
      const nextCount = countAbsencesInRange(nextWeekStart, nextWeekEnd);

      setText(absenceTodayCount, String(todayCount));
      setText(absenceRestWeekCount, String(restCount));
      setText(absenceNextWeekCount, String(nextCount));
      setText(absenceTodayHint, todayCount === 1 ? "1 fravær i dag" : `${todayCount} fravær i dag`);
      setText(absenceRestWeekHint, restCount === 1 ? "1 fravær resten af ugen" : `${restCount} fravær resten af ugen`);
      setText(absenceNextWeekHint, nextCount === 1 ? "1 fravær næste uge" : `${nextCount} fravær næste uge`);
    }

    function renderAbsenceList() {
      if (!absenceList) {
        return;
      }
      absenceList.replaceChildren();
      const absences = Array.isArray(state.calendar.absences) ? state.calendar.absences : [];
      setText(absenceListMeta, absences.length === 1 ? "1 fravær fundet." : `${absences.length} fravær fundet.`);

      if (absences.length === 0) {
        const empty = document.createElement("p");
        empty.className = "calendarMessage";
        empty.textContent = "Ingen fravær fundet.";
        absenceList.appendChild(empty);
        return;
      }

      absences.forEach((absence) => {
        const card = document.createElement("article");
        card.className = "absenceCard";

        const header = document.createElement("div");
        header.className = "absenceCardHeader";

        const title = document.createElement("p");
        title.className = "absenceName";
        title.textContent = getAbsencePersonLabel(absence);

        const status = document.createElement("span");
        status.className = "tag tagLive";
        status.textContent = getAbsenceStatusLabel(absence && absence.status);

        header.append(title, status);

        const meta = document.createElement("p");
        meta.className = "absenceMeta";
        meta.textContent = `${getAbsenceTypeLabel(absence && absence.absence_type)} · ${formatShortDate(absence && absence.start_date)} til ${formatShortDate(absence && absence.end_date)}`;

        card.append(header, meta);

        if (absence && absence.note) {
          const note = document.createElement("p");
          note.className = "absenceNote";
          note.textContent = String(absence.note);
          card.appendChild(note);
        }

        absenceList.appendChild(card);
      });
    }

    function setCalendarMessage(message) {
      setText(absenceRangeStatus, message);
      setText(absenceListMeta, message);
    }

    function setCalendarTab(tab) {
      const nextTab = tab === "tasks" ? "tasks" : "absences";
      state.calendar.activeTab = nextTab;
      calendarTabs.forEach((button) => {
        const active = button.dataset.calendarTab === nextTab;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", active ? "true" : "false");
      });
      calendarPanels.forEach((panel) => {
        panel.hidden = panel.dataset.calendarPanel !== nextTab;
      });
      renderCalendarAccessState();
      if (nextTab === "absences") {
        loadCalendarResources();
        loadCalendarAbsences();
      }
    }

    function renderCalendarAccessState() {
      const accessDenied = state.calendar.accessDenied || !isTenantAdmin(state.me);
      const showAbsences = state.calendar.activeTab === "absences";
      if (calendarAccessNotice) {
        calendarAccessNotice.hidden = !(showAbsences && accessDenied);
      }
      [absenceOverviewSection, absenceRangeSection, absenceListSection, absenceCreateSection].forEach((section) => {
        if (section) {
          section.hidden = !showAbsences || accessDenied;
        }
      });
      if (accessDenied) {
        state.calendar.absences = [];
        renderAbsenceOverview();
        renderResourceOptions();
        if (absenceList) {
          absenceList.replaceChildren();
        }
      }
    }

    async function loadCalendarResourcesForScope(scope, options) {
      const requestedScope = getCalendarResourceScopeDefinition(scope);

      renderCalendarAccessState();
      if (!isTenantAdmin(state.me) || state.calendar.activeTab !== "absences") {
        return;
      }
      if (!requestedScope.enabled) {
        state.calendar.resources = [];
        state.calendar.resourcesLoaded = false;
        state.calendar.resourcesLoadedScope = "";
        renderResourceOptions();
        setText(absenceResourceStatus, "Ressourcevisningen er ikke aktiv endnu.");
        return;
      }

      const activeScope = setActiveCalendarResourceScope(requestedScope.key);
      const endpoint = getCalendarResourceScopeEndpoint(activeScope);
      if (!endpoint) {
        state.calendar.resources = [];
        state.calendar.resourcesLoaded = false;
        state.calendar.resourcesLoadedScope = "";
        renderResourceOptions();
        setText(absenceResourceStatus, "Ressourcevisningen er ikke aktiv endnu.");
        return;
      }
      if (!(options && options.force) && state.calendar.resourcesLoaded && state.calendar.resourcesLoadedScope === activeScope) {
        renderResourceOptions();
        return;
      }

      state.calendar.resourcesLoading = true;
      renderResourceOptions();

      try {
        const response = await apiFetch(endpoint, { method: "GET" });
        state.calendar.accessDenied = false;
        state.calendar.resources = response && Array.isArray(response.resources) ? response.resources : [];
        state.calendar.resourcesLoaded = true;
        state.calendar.resourcesLoadedScope = activeScope;
        renderCalendarAccessState();
        renderResourceOptions();
      } catch (error) {
        if (error && error.status === 403 && error.code === "calendar_absence_access_denied") {
          state.calendar.accessDenied = true;
          renderCalendarAccessState();
          return;
        }
        if (handleAuthFailure(error)) {
          return;
        }
        state.calendar.resources = [];
        state.calendar.resourcesLoaded = false;
        state.calendar.resourcesLoadedScope = "";
        renderResourceOptions();
        setText(absenceResourceStatus, `Kunne ikke hente medarbejdere: ${getErrorMessage(error, "request_failed")}`);
      } finally {
        state.calendar.resourcesLoading = false;
        renderResourceOptions();
      }
    }

    async function loadCalendarResources(options) {
      return loadCalendarResourcesForScope(getActiveCalendarResourceScope(), options);
    }

    function getCalendarRangeFromInputs() {
      const from = absenceFromInput && absenceFromInput.value ? absenceFromInput.value : state.calendar.from;
      const to = absenceToInput && absenceToInput.value ? absenceToInput.value : state.calendar.to;
      const fromDate = parseDateInput(from);
      const toDate = parseDateInput(to);
      if (!fromDate || !toDate) {
        return { error: "Vælg både fra- og til-dato i formatet YYYY-MM-DD." };
      }
      if (toDate < fromDate) {
        return { error: "Til dato må ikke være før fra dato." };
      }
      return { from, to };
    }

    async function loadCalendarAbsences(options) {
      ensureCalendarDefaults();
      renderCalendarAccessState();
      if (!isTenantAdmin(state.me) || state.calendar.activeTab !== "absences") {
        return;
      }

      const range = getCalendarRangeFromInputs();
      if (range.error) {
        setCalendarMessage(range.error);
        return;
      }

      const cacheKey = `${range.from}:${range.to}`;
      if (!(options && options.force) && state.calendar.loadedKey === cacheKey) {
        renderAbsenceOverview();
        renderAbsenceList();
        return;
      }

      state.calendar.loading = true;
      setText(absenceRangeStatus, "Henter fravær...");
      setText(absenceListMeta, "Indlæser fravær...");
      if (absenceRefreshBtn) {
        absenceRefreshBtn.disabled = true;
      }

      try {
        const response = await apiFetch(`/api/calendar/absences?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`, { method: "GET" });
        state.calendar.from = range.from;
        state.calendar.to = range.to;
        state.calendar.loadedKey = cacheKey;
        state.calendar.accessDenied = false;
        state.calendar.absences = response && Array.isArray(response.absences) ? response.absences : [];
        setText(absenceRangeStatus, `${formatShortDate(range.from)} til ${formatShortDate(range.to)}`);
        renderCalendarAccessState();
        renderAbsenceOverview();
        renderAbsenceList();
      } catch (error) {
        if (error && error.status === 403 && error.code === "calendar_absence_access_denied") {
          state.calendar.accessDenied = true;
          renderCalendarAccessState();
          return;
        }
        if (handleAuthFailure(error)) {
          return;
        }
        const message = `Kunne ikke hente fravær: ${getErrorMessage(error, "request_failed")}`;
        setCalendarMessage(message);
      } finally {
        state.calendar.loading = false;
        if (absenceRefreshBtn) {
          absenceRefreshBtn.disabled = false;
        }
      }
    }

    function validateAbsenceForm() {
      const fitterId = absenceFitterSelect ? String(absenceFitterSelect.value || "").trim() : "";
      const absenceType = absenceTypeSelect ? String(absenceTypeSelect.value || "").trim() : "";
      const visibilityScope = absenceVisibilitySelect ? String(absenceVisibilitySelect.value || "").trim() : "tenant_admin_only";
      const startDate = absenceStartDateInput ? String(absenceStartDateInput.value || "").trim() : "";
      const endDate = absenceEndDateInput ? String(absenceEndDateInput.value || "").trim() : "";
      const note = absenceNoteInput ? String(absenceNoteInput.value || "").trim() : "";
      const allowedTypes = new Set(["vacation", "vacation_free", "course", "sickness", "other"]);
      const allowedVisibility = new Set(["tenant_admin_only", "limited_availability", "manager_full", "finance_relevant", "custom"]);
      const start = parseDateInput(startDate);
      const end = parseDateInput(endDate);

      if (!fitterId) {
        return { error: "Vælg medarbejder." };
      }
      if (!allowedTypes.has(absenceType)) {
        return { error: "Vælg en kendt fraværstype." };
      }
      if (!start || !end) {
        return { error: "Startdato og slutdato er påkrævet." };
      }
      if (end < start) {
        return { error: "Slutdato må ikke være før startdato." };
      }
      if (note.length > 1000) {
        return { error: "Note må højst være 1000 tegn." };
      }
      if (!allowedVisibility.has(visibilityScope)) {
        return { error: "Vælg en kendt synlighed." };
      }

      return {
        input: {
          fitter_id: fitterId,
          absence_type: absenceType,
          start_date: startDate,
          end_date: endDate,
          note: note || null,
          visibility_scope: visibilityScope,
        },
      };
    }

    async function submitAbsenceForm(event) {
      event.preventDefault();
      if (!isTenantAdmin(state.me)) {
        state.calendar.accessDenied = true;
        renderCalendarAccessState();
        return;
      }

      const result = validateAbsenceForm();
      if (result.error) {
        setText(absenceFormStatus, result.error);
        return;
      }

      if (absenceCreateBtn) {
        absenceCreateBtn.disabled = true;
      }
      setText(absenceFormStatus, "Gemmer fravær...");

      try {
        await apiFetch("/api/calendar/absences", {
          method: "POST",
          body: JSON.stringify(result.input),
        });
        setText(absenceFormStatus, "Fravær gemt.");
        if (absenceNoteInput) {
          absenceNoteInput.value = "";
        }
        state.calendar.loadedKey = "";
        await loadCalendarAbsences({ force: true });
      } catch (error) {
        if (error && error.status === 403 && error.code === "calendar_absence_access_denied") {
          state.calendar.accessDenied = true;
          renderCalendarAccessState();
          return;
        }
        if (handleAuthFailure(error)) {
          return;
        }
        setText(absenceFormStatus, `Kunne ikke gemme fravær: ${getErrorMessage(error, "request_failed")}`);
      } finally {
        if (absenceCreateBtn) {
          absenceCreateBtn.disabled = false;
        }
      }
    }

    function getCurrentAppViewFromHash() {
      const hash = String(window.location.hash || "").replace(/^#/, "").toLowerCase();
      if (hash === "resource-groups") {
        return "resource-groups";
      }
      if (hash === "calendar") {
        return "calendar";
      }
      if (hash === "projects") {
        return "projects";
      }
      return "dashboard";
    }

    function setActiveAppView(view) {
      const activeView = view === "projects" || view === "calendar" || view === "resource-groups" ? view : "dashboard";
      state.currentView = activeView;

      if (dashboardView) {
        dashboardView.hidden = activeView !== "dashboard";
      }
      if (calendarView) {
        calendarView.hidden = activeView !== "calendar";
      }
      if (resourceGroupsView) {
        resourceGroupsView.hidden = activeView !== "resource-groups";
      }
      if (projectsView) {
        projectsView.hidden = activeView !== "projects";
      }

      viewLinks.forEach((link) => {
        const target = String(link.dataset.viewLink || "").toLowerCase();
        link.classList.toggle("active", target === activeView);
      });

      if (activeView === "calendar") {
        ensureCalendarDefaults();
        renderCalendarAccessState();
        if (state.calendar.activeTab === "absences") {
          loadCalendarResources();
          loadCalendarAbsences();
        }
      }
      if (activeView === "resource-groups") {
        renderResourceGroupAccessState();
        loadResourceGroups();
      }
    }

    function formatDashboardDate() {
      try {
        return new Intl.DateTimeFormat("da-DK", {
          weekday: "long",
          day: "2-digit",
          month: "long",
        }).format(new Date());
      } catch (_error) {
        return new Date().toISOString().slice(0, 10);
      }
    }

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

    function normalizeProjectRef(ref) {
      return String(ref || "").trim();
    }

    function getProjectRef(project) {
      return normalizeProjectRef(project && project.external_project_ref);
    }

    function getParentReferenceCandidates(ref) {
      const normalized = normalizeProjectRef(ref);
      const parts = normalized.split("-").map((part) => part.trim()).filter(Boolean);
      const candidates = [];
      for (let length = parts.length - 1; length >= 1; length -= 1) {
        candidates.push(parts.slice(0, length).join("-"));
      }
      return candidates;
    }

    function normalizeSearchText(value) {
      return String(value || "").trim().toLowerCase();
    }

    function projectSearchBlob(project) {
      return [
        project && project.external_project_ref,
        project && project.name,
        project && project.responsible_code,
        project && project.responsible_name,
        project && project.team_leader_code,
        project && project.team_leader_name,
      ].map(normalizeSearchText).filter(Boolean).join(" ");
    }

    function matchesProjectSearch(project) {
      const query = normalizeSearchText(state.searchQuery);
      if (!query) {
        return true;
      }
      return projectSearchBlob(project).includes(query);
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

    function getCurrentScopeLabel() {
      if (state.selectedOwnerIds.has("__ALL__")) {
        return "Mine";
      }

      const selected = Array.from(state.selectedOwnerIds);
      if (selected.length > 1) {
        return "Afdeling";
      }

      const selectedOwner = state.ownerOptions.find((option) => option.id === selected[0]);
      if (!selectedOwner) {
        return "Mine";
      }

      if (String(selectedOwner.label || "").toLowerCase() === "mig") {
        return "Mine";
      }

      return `Ansvarlig: ${selectedOwner.label}`;
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

      const searchedProjects = sortedProjects.filter(matchesProjectSearch);
      logProjectPipeline("after-search", searchedProjects, {
        search_active: Boolean(normalizeSearchText(state.searchQuery)),
      });

      const allSelected = state.selectedOwnerIds.has("__ALL__");
      if (allSelected) {
        logProjectPipeline("after-filtering", searchedProjects, {
          filter_mode: "all-owners",
        });
        return searchedProjects;
      }

      const selectedSet = state.selectedOwnerIds;
      const filtered = searchedProjects.filter((project) => selectedSet.has(getOwnerId(project)));
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
      if (vm.relation.isSubproject) {
        const relSection = makeSection('Relation');
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
        timerSection.appendChild(makeField('Syncede timer', totalHoursLabel));
        const timerNote = document.createElement('p');
        timerNote.className = 'sectionState';
        timerNote.textContent = summary.definition && summary.definition.description
          ? summary.definition.description
          : 'Baseret p\u00e5 syncede timeposter i Fielddesk. Ikke n\u00f8dvendigvis alle timer fra E-Komplet.';
        timerSection.appendChild(timerNote);
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

    function getProjectUrl(project) {
      return project && project.project_id
        ? `/project/${encodeURIComponent(String(project.project_id))}`
        : "";
    }

    function toggleProjectRef(ref) {
      if (!ref) {
        return;
      }
      if (state.expandedProjectRefs.has(ref)) {
        state.expandedProjectRefs.delete(ref);
      } else {
        state.expandedProjectRefs.add(ref);
      }
      renderProjects();
    }

    function createProjectCard(project, options) {
      const settings = options || {};
      const statusView = getStatusView(project);
      const hasChildren = Boolean(settings.hasChildren);
      const expanded = Boolean(settings.expanded);
      const card = document.createElement("article");
      card.className = "projectCard";
      if (project && project.project_id) {
        card.dataset.projectId = String(project.project_id);
      }
      if (hasChildren) {
        card.classList.add("projectCardParent");
        card.setAttribute("role", "button");
        card.setAttribute("tabindex", "0");
        card.setAttribute("aria-expanded", expanded ? "true" : "false");
      }

      const header = document.createElement("div");
      header.className = "projectCardHeader";

      const titleBlock = document.createElement("div");
      titleBlock.className = "projectCardTitle";

      const name = document.createElement("h3");
      name.className = "projectName";
      name.textContent = project && project.name ? project.name : "(uden navn)";

      const ref = document.createElement("p");
      ref.className = "projectRef";
      ref.textContent = `Ref: ${project && project.external_project_ref ? project.external_project_ref : "-"}`;

      titleBlock.appendChild(name);
      titleBlock.appendChild(ref);
      header.appendChild(titleBlock);

      if (hasChildren) {
        const indicator = document.createElement("span");
        indicator.className = "projectHierarchyIndicator";
        indicator.textContent = expanded ? "Skjul undersager" : "Vis undersager";
        header.appendChild(indicator);
      }

      const lineTwo = document.createElement("div");
      lineTwo.className = "projectLineTwo";

      const activity = document.createElement("span");
      activity.className = "activityText";
      activity.textContent = `Sidste aktivitet: ${formatActivityDate(statusView.activityDate)}`;

      lineTwo.appendChild(activity);
      lineTwo.appendChild(makeBadge(statusView));

      const actions = document.createElement("div");
      actions.className = "projectCardActions";

      const projectUrl = getProjectUrl(project);
      if (projectUrl) {
        const openLink = document.createElement("a");
        openLink.className = "projectAction projectActionPrimary";
        openLink.href = projectUrl;
        openLink.textContent = "Gå til sag";
        openLink.addEventListener("click", (event) => {
          event.stopPropagation();
        });
        actions.appendChild(openLink);
      }

      const quickView = document.createElement("button");
      quickView.type = "button";
      quickView.className = "projectAction";
      quickView.textContent = "Quick View";
      quickView.addEventListener("click", (event) => {
        event.stopPropagation();
        openProjectDrawer(project);
      });
      actions.appendChild(quickView);

      card.appendChild(header);
      card.appendChild(lineTwo);
      card.appendChild(actions);

      if (hasChildren) {
        const refValue = getProjectRef(project);
        card.addEventListener("click", () => {
          toggleProjectRef(refValue);
        });
        card.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") {
            return;
          }
          event.preventDefault();
          toggleProjectRef(refValue);
        });
      }

      return card;
    }

    function createHierarchyNode(project, type, children) {
      return {
        project,
        type,
        children: Array.isArray(children) ? children : [],
      };
    }

    function buildProjectHierarchy(projects) {
      const source = Array.isArray(projects) ? projects : [];
      const nodeByRef = new Map();
      const nodes = [];
      const topNodes = [];

      source.forEach((project) => {
        const ref = getProjectRef(project);
        const node = createHierarchyNode(project, "top", []);
        nodes.push(node);
        if (ref && !nodeByRef.has(ref)) {
          nodeByRef.set(ref, node);
        }
      });

      nodes.forEach((node) => {
        const ref = getProjectRef(node.project);
        const parentRef = getParentReferenceCandidates(ref).find((candidate) => nodeByRef.has(candidate));
        const parentNode = parentRef ? nodeByRef.get(parentRef) : null;
        if (parentNode && parentNode !== node) {
          node.type = "child";
          parentNode.children.push(node);
          return;
        }
        topNodes.push(node);
      });

      return topNodes;
    }

    function createProjectTreeRow(node, depth) {
      const row = document.createElement("div");
      row.className = `projectTreeRow projectTreeDepth${Math.min(Number(depth) || 0, 2)}`;

      const ref = getProjectRef(node && node.project);
      const hasChildren = Boolean(node && node.children && node.children.length > 0);
      const expanded = ref ? state.expandedProjectRefs.has(ref) : false;

      if (hasChildren) {
        row.classList.add("projectTreeRowParent");
      }

      row.appendChild(createProjectCard(node && node.project, { hasChildren, expanded }));
      return row;
    }

    function appendProjectHierarchy(nodes, target, depth) {
      (Array.isArray(nodes) ? nodes : []).forEach((node) => {
        const currentDepth = Number(depth) || 0;
        const ref = getProjectRef(node && node.project);
        const hasChildren = Boolean(node && node.children && node.children.length > 0);
        target.appendChild(createProjectTreeRow(node, currentDepth));
        if (hasChildren && state.expandedProjectRefs.has(ref)) {
          appendProjectHierarchy(node.children, target, currentDepth + 1);
        }
      });
    }

    function appendProjectList(projects, target) {
      const tree = document.createElement("div");
      tree.className = "projectTree";
      appendProjectHierarchy(buildProjectHierarchy(projects), tree, 0);
      target.appendChild(tree);
    }

    function renderDashboard() {
      const name = state.me && state.me.name ? String(state.me.name) : "Fielddesk";
      const firstName = name.split(" ").filter(Boolean)[0] || name;
      const totalProjects = state.projects.length;
      const openProjects = state.projects.filter((project) => !isClosedStatus(project));
      const attentionProjects = openProjects.filter((project) => {
        const statusView = getStatusView(project);
        return statusView.tone === "warning" || statusView.tone === "critical";
      });

      setText(dashboardWelcomeName, firstName);
      setText(dashboardDateText, formatDashboardDate());
      setText(dashboardProjectCount, String(totalProjects));
      setText(dashboardOpenCount, String(openProjects.length));
      setText(projectOpenCount, String(openProjects.length));
      setText(dashboardAttentionCount, String(attentionProjects.length));
      setText(dashboardQaStatus, totalProjects > 0 ? "Via sag" : "-");
      setText(currentScopeValue, getCurrentScopeLabel());
      setText(
        moduleProjectsMeta,
        totalProjects > 0
          ? `${openProjects.length} aktive sager · ${totalProjects} i alt`
          : "Ingen sager hentet endnu"
      );
    }

    function renderProjects() {
      const visibleProjects = getFilteredProjects();
      projectsContainer.innerHTML = "";
      renderScopeChips();
      renderDashboard();

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
        appendProjectList(visibleProjects, projectsContainer);
        const renderedCards = projectsContainer.querySelectorAll(".projectCard").length;
        logProjectPipeline("after-grouping-dedup", visibleProjects, {
          group_mode: false,
          dedup_applied: true,
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
        appendProjectList(groupProjects, block);

        projectsContainer.appendChild(block);
      });

      const groupedCount = Array.from(groups.values()).reduce((sum, items) => sum + items.length, 0);
      const renderedCards = projectsContainer.querySelectorAll(".projectCard").length;
      logProjectPipeline("after-grouping-dedup", visibleProjects, {
        group_mode: true,
        dedup_applied: true,
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


    function escapeHtml(value) {
      return String(value === null || value === undefined ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function firstText() {
      for (let i = 0; i < arguments.length; i += 1) {
        const value = String(arguments[i] === null || arguments[i] === undefined ? "" : arguments[i]).trim();
        if (value) return value;
      }
      return null;
    }

    function firstNumber() {
      for (let i = 0; i < arguments.length; i += 1) {
        const parsed = Number(arguments[i]);
        if (Number.isFinite(parsed)) return parsed;
      }
      return null;
    }

    function clampPercent(value) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return null;
      return Math.max(0, Math.min(100, parsed));
    }

    function formatMoney(value) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return null;
      try {
        return new Intl.NumberFormat("da-DK", { maximumFractionDigits: 0 }).format(parsed) + " kr.";
      } catch (_error) {
        return String(Math.round(parsed)) + " kr.";
      }
    }

    function formatCaseDate(value) {
      const date = toDate(value);
      if (!date) return null;
      return formatActivityDate(date);
    }

    function buildLocation(raw) {
      const direct = firstText(raw && raw.location, raw && raw.address, raw && raw.associatedAddress);
      const zip = firstText(raw && raw.zip, raw && raw.zip_code, raw && raw.postal_code);
      const city = firstText(raw && raw.city, raw && raw.town);
      if (direct && city && !direct.toLowerCase().includes(city.toLowerCase())) return direct + ", " + city;
      return direct || [zip, city].filter(Boolean).join(" ") || null;
    }

    function initialsFromName(value) {
      const text = String(value || "").trim();
      if (!text) return null;
      const compact = text.replace(/[^A-Za-zA-Z\u00c0-\u024F]/g, "").toUpperCase();
      if (compact.length <= 3 && compact.length > 0) return compact.slice(0, 2);
      const parts = text.split(/\s+/).filter(Boolean);
      if (parts.length === 1) return compact.slice(0, 2) || null;
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }

    function teamInitialsFromProject(raw) {
      const team = [];
      [
        firstText(raw && raw.responsible_name, raw && raw.responsible_code),
        firstText(raw && raw.team_leader_name, raw && raw.team_leader_code),
        firstText(raw && raw.owner_name, raw && raw.owner_display_name),
      ].forEach((value) => {
        const initials = initialsFromName(value);
        if (initials && !team.includes(initials)) team.push(initials);
      });
      return team.slice(0, 3);
    }

    function stableAvatarColor(initials) {
      const fixed = { MK: "#059669", JL: "#2563eb", TP: "#7c3aed", SR: "#d97706", AL: "#e11d48" };
      const key = String(initials || "").toUpperCase();
      if (fixed[key]) return fixed[key];
      const palette = ["#059669", "#2563eb", "#7c3aed", "#d97706", "#e11d48", "#0f766e"];
      let hash = 0;
      for (let i = 0; i < key.length; i += 1) hash = ((hash * 31) + key.charCodeAt(i)) >>> 0;
      return palette[hash % palette.length];
    }

    function progressToneClass(value) {
      if (value === null || value === undefined) return "low";
      if (value > 80) return "high";
      if (value >= 50) return "mid";
      return "low";
    }

    function mapProjectToCaseOverviewItem(raw) {
      const id = firstText(raw && raw.project_id, raw && raw.id, raw && raw.projectID);
      const number = firstText(raw && raw.external_project_ref, raw && raw.reference, raw && raw.project_ref) || "-";
      const name = firstText(raw && raw.name, raw && raw.project_name, raw && raw.projectName) || "Unavngivet sag";
      const obsDays = firstNumber(raw && raw.calculated_days_since_last_registration, raw && raw.CalculatedDaysSinceLastRegistration);
      const backendObs = String(firstText(raw && raw.operational_attention, raw && raw.status) || "").toLowerCase().includes("obs")
        || String(raw && raw.ready_to_bill) === "true";
      const backendCritical = String(firstText(raw && raw.operational_attention, raw && raw.status) || "").toLowerCase().includes("critical");
      const closed = isClosedStatus(raw);
      const status = backendCritical ? "kritisk" : (!closed && ((typeof obsDays === "number" && obsDays > 30) || backendObs) ? "obs" : "aktiv");
      const progressPercent = clampPercent(firstNumber(raw && raw.coverage, raw && raw.coverageInPercent, raw && raw.progressPercent));
      const spentPercent = clampPercent(firstNumber(raw && raw.coverage, raw && raw.spent_percent, raw && raw.spentPercent));
      const activityDate = getActivityDate(raw);
      return {
        id: id || number,
        raw,
        name,
        number,
        obsDays: typeof obsDays === "number" ? obsDays : null,
        status,
        phase: firstText(raw && raw.phase, raw && raw.activity_status),
        budget: formatMoney(firstNumber(raw && raw.budget_total, raw && raw.projectBudget, raw && raw.total_turn_over_exp)),
        spentPercent,
        deadline: formatCaseDate(firstText(raw && raw.end_date, raw && raw.endDate, raw && raw.deadline)),
        location: buildLocation(raw),
        team: teamInitialsFromProject(raw),
        co2: firstText(raw && raw.co2, raw && raw.co2_total),
        documentsCount: firstNumber(raw && raw.documents_count, raw && raw.documentsCount),
        commentsCount: firstNumber(raw && raw.comments_count, raw && raw.commentsCount),
        progressPercent,
        description: firstText(raw && raw.projectDescription, raw && raw.description),
        milestones: Array.isArray(raw && raw.milestones) ? raw.milestones : [],
        activity: [],
        activityDate,
        updatedDate: toDate(raw && (raw.source_updated_at || raw.updated_at)),
        responsibleText: firstText(raw && raw.responsible_name, raw && raw.responsible_code, raw && raw.team_leader_name, raw && raw.team_leader_code),
        isClosed: closed,
      };
    }

    function getCaseItems() {
      const openProjects = state.projects.filter((project) => !isClosedStatus(project));
      state.showingClosedFallback = openProjects.length === 0 && state.projects.length > 0;
      return (openProjects.length > 0 ? openProjects : state.projects.slice()).map(mapProjectToCaseOverviewItem);
    }

    function caseSearchBlob(item) {
      return [item.name, item.number, item.location, item.responsibleText, item.team.join(" ")]
        .map(normalizeSearchText)
        .filter(Boolean)
        .join(" ");
    }

    function getVisibleCaseItems() {
      const sortedRaw = sortProjects(state.projects.filter((project) => !isClosedStatus(project)));
      const source = sortedRaw.length > 0 ? sortedRaw : sortProjects(state.projects);
      let items = source.map(mapProjectToCaseOverviewItem);
      const query = normalizeSearchText(state.searchQuery);
      if (query) items = items.filter((item) => caseSearchBlob(item).includes(query));
      if (state.caseFilter === "obs") items = items.filter((item) => item.status === "obs" || item.status === "kritisk");
      return items;
    }

    function renderIcon(name) {
      const common = 'width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
      const icons = {
        dashboard: '<svg ' + common + '><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect></svg>',
        folder: '<svg ' + common + '><path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><path d="M3 7V5a2 2 0 0 1 2-2h4l2 4"></path></svg>',
        calendar: '<svg ' + common + '><rect x="3" y="4" width="18" height="18" rx="2"></rect><path d="M16 2v4"></path><path d="M8 2v4"></path><path d="M3 10h18"></path></svg>',
        settings: '<svg ' + common + '><path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5z"></path><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.4 1.08V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 8.6 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 0-1.08-.4H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 8.6a1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 1 1 7.04 3.9l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-.6 1.65 1.65 0 0 0 .4-1.08V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15.4 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.4.24.64.65.6 1.12V12c.04.47-.2.88-.6 1z"></path></svg>',
        search: '<svg ' + common + '><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>',
        bell: '<svg ' + common + '><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>',
        arrow: '<svg ' + common.replace('width="18" height="18"', 'width="11" height="11"') + '><path d="M7 7h10v10"></path><path d="M7 17 17 7"></path></svg>',
        filter: '<svg ' + common.replace('width="18" height="18"', 'width="14" height="14"') + '><path d="M3 5h18"></path><path d="M6 12h12"></path><path d="M10 19h4"></path></svg>',
        plus: '<svg ' + common.replace('width="18" height="18"', 'width="20" height="20"') + '><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>',
        pin: '<svg ' + common.replace('width="18" height="18"', 'width="10" height="10"') + '><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>',
        x: '<svg ' + common + '><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>',
        euro: '<svg ' + common.replace('width="18" height="18"', 'width="14" height="14"') + '><path d="M4 10h10"></path><path d="M4 14h9"></path><path d="M17 5a7 7 0 1 0 0 14"></path></svg>',
        chart: '<svg ' + common.replace('width="18" height="18"', 'width="14" height="14"') + '><path d="M3 3v18h18"></path><path d="M7 16V9"></path><path d="M12 16V5"></path><path d="M17 16v-3"></path></svg>',
        clock: '<svg ' + common.replace('width="18" height="18"', 'width="14" height="14"') + '><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg>',
        leaf: '<svg ' + common.replace('width="18" height="18"', 'width="14" height="14"') + '><path d="M11 20A7 7 0 0 1 4 13c0-6 8-10 16-10 0 8-4 16-10 16Z"></path><path d="M4 21c4-4 8-7 14-9"></path></svg>',
        paperclip: '<svg ' + common.replace('width="18" height="18"', 'width="14" height="14"') + '><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 1 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>',
        message: '<svg ' + common.replace('width="18" height="18"', 'width="14" height="14"') + '><path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path></svg>'
      };
      return icons[name] || "";
    }

    function renderInlineIcons(root) {
      (root || document).querySelectorAll("[data-icon]").forEach((node) => {
        node.innerHTML = renderIcon(node.dataset.icon);
      });
    }

    function renderAvatar(initials, size) {
      const safe = escapeHtml(initials || "D");
      return '<span class="fdAvatar" style="--fd-avatar-size:' + (size || 24) + 'px; background:' + stableAvatarColor(safe) + ';">' + safe + '</span>';
    }

    function renderAvatarGroup(team) {
      const initials = Array.isArray(team) && team.length ? team.slice(0, 3) : ["D"];
      return '<span class="fdAvatarGroup">' + initials.map((item) => renderAvatar(item, 24)).join("") + '</span>';
    }

    function renderProgressBar(value, sheet) {
      const percent = clampPercent(value) || 0;
      const tone = progressToneClass(value);
      return '<div class="fdProgressTrack' + (sheet ? ' sheet' : '') + '"><div class="fdProgressFill ' + tone + '" style="width:' + percent + '%"></div></div>';
    }

    function progressLabel(item) {
      return typeof item.progressPercent === "number" ? Math.round(item.progressPercent) + "%" : "--";
    }

    function projectDetailUrl(item) {
      return item && item.id ? "/sager/" + encodeURIComponent(String(item.id)) : "/sager";
    }

    function createCaseCard(item) {
      const tone = progressToneClass(item.progressPercent);
      const obs = item.status === "obs" || item.status === "kritisk";
      const article = document.createElement("article");
      article.className = "fdCaseCard";
      article.innerHTML =
        '<div class="fdCaseCardTop">' +
          '<span class="fdStatusDot ' + escapeHtml(item.status) + '"></span>' +
          '<div class="fdCaseCardTitleWrap">' +
            '<p class="fdCaseName">' + escapeHtml(item.name) + '</p>' +
            '<div class="fdCaseMetaLine"><span class="fdCaseNumber">Sag ' + escapeHtml(item.number) + '</span><span data-icon="pin"></span><span class="fdLocationText">' + escapeHtml(item.location || "--") + '</span></div>' +
          '</div>' +
          (obs ? '<span class="fdObsBadge">OBS</span>' : '') +
          '<span class="fdProgressText ' + tone + '">' + escapeHtml(progressLabel(item)) + '</span>' +
        '</div>' +
        renderProgressBar(item.progressPercent, false) +
        '<div class="fdCaseCardFooter">' +
          renderAvatarGroup(item.team) +
          (item.obsDays !== null ? '<span class="fdObsDays">' + escapeHtml(item.obsDays) + 'd</span>' : '') +
          '<div class="fdCardActions"><a class="fdCaseBtn secondary" href="' + projectDetailUrl(item) + '">Gå til sag</a><button class="fdCaseBtn primary" type="button" data-quick-view="' + escapeHtml(item.id) + '"><span data-icon="arrow"></span>Quick View</button></div>' +
        '</div>';
      renderInlineIcons(article);
      const quick = article.querySelector("[data-quick-view]");
      if (quick) quick.addEventListener("click", () => openProjectDrawer(item.raw));
      return article;
    }

    function createCaseRow(item) {
      const tone = progressToneClass(item.progressPercent);
      const obs = item.status === "obs" || item.status === "kritisk";
      const row = document.createElement("article");
      row.className = "fdCaseRow";
      row.innerHTML =
        '<div class="fdCaseRowLeft">' +
          '<span class="fdStatusDot ' + escapeHtml(item.status) + '"></span>' +
          '<div class="fdCaseRowTitleWrap">' +
            '<p class="fdCaseName">' + escapeHtml(item.name) + '</p>' +
            '<div class="fdCaseMetaLine"><span class="fdCaseNumber">Sag ' + escapeHtml(item.number) + '</span><span>·</span><span class="fdChangedText">Sidst aendret ' + escapeHtml(formatActivityDate(item.updatedDate || item.activityDate)) + '</span><span data-icon="pin"></span><span class="fdLocationText">' + escapeHtml(item.location || "--") + '</span></div>' +
          '</div>' +
          (obs ? '<span class="fdObsBadge">OBS</span>' : '') +
        '</div>' +
        '<div class="fdCaseRowMiddle"><div class="fdRowProgress">' + renderProgressBar(item.progressPercent, false) + '</div><span class="fdProgressText ' + tone + '">' + escapeHtml(progressLabel(item)) + '</span>' + renderAvatarGroup(item.team) + (item.obsDays !== null ? '<span class="fdObsDays">OBS ' + escapeHtml(item.obsDays) + ' dage</span>' : '') + '</div>' +
        '<div class="fdCaseRowActions"><a class="fdCaseBtn secondary" href="' + projectDetailUrl(item) + '">Gå til sag</a><button class="fdCaseBtn primary" type="button" data-quick-view="' + escapeHtml(item.id) + '"><span data-icon="arrow"></span>Quick View</button></div>';
      renderInlineIcons(row);
      const quick = row.querySelector("[data-quick-view]");
      if (quick) quick.addEventListener("click", () => openProjectDrawer(item.raw));
      return row;
    }

    function renderCaseFilters() {
      document.querySelectorAll("[data-case-filter]").forEach((button) => {
        const active = button.dataset.caseFilter === state.caseFilter;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", active ? "true" : "false");
      });
    }

    function currentCaseFilterLabel() {
      if (state.caseFilter === "obs") return "OBS";
      if (state.caseFilter === "all") return "Alle mine";
      return "Mine";
    }

    function renderProjects() {
      if (!projectsContainer) return;
      projectsContainer.innerHTML = "";
      renderCaseFilters();
      renderDashboard();

      if (state.projectsLoading) {
        setText(listMetaText, "Indlaeser sager...");
        const loader = document.createElement("div");
        loader.className = "fdLoadingList";
        loader.innerHTML = '<div class="fdSkeleton"></div><div class="fdSkeleton"></div><div class="fdSkeleton"></div>';
        projectsContainer.appendChild(loader);
        return;
      }

      if (state.projectLoadError) {
        setText(listMetaText, "Fejl under indlaesning");
        const error = document.createElement("div");
        error.className = "fdErrorState";
        error.innerHTML = '<strong>Kunne ikke hente sager</strong><span>' + escapeHtml(state.projectLoadError) + '</span><button class="fdRetryBtn" type="button">Prov igen</button>';
        const retry = error.querySelector("button");
        if (retry) retry.addEventListener("click", loadProjects);
        projectsContainer.appendChild(error);
        return;
      }

      const visibleItems = getVisibleCaseItems();
      const caseLabel = state.showingClosedFallback ? "sager" : "aktive sager";
      setText(listMetaText, visibleItems.length + " " + caseLabel + " i aktuel visning");

      if (visibleItems.length === 0) {
        const empty = document.createElement("div");
        empty.className = "fdEmptyState";
        empty.textContent = "Ingen sager at vise.";
        projectsContainer.appendChild(empty);
        return;
      }

      visibleItems.forEach((item) => {
        projectsContainer.appendChild(createCaseCard(item));
        projectsContainer.appendChild(createCaseRow(item));
      });
    }

    function renderDashboard() {
      const name = state.me && state.me.name ? String(state.me.name) : "Fielddesk";
      const firstName = name.split(" ").filter(Boolean)[0] || name;
      const items = getCaseItems();
      const activeItems = items.filter((item) => item.status === "aktiv");
      const attentionItems = items.filter((item) => item.status === "obs" || item.status === "kritisk");
      setText(dashboardWelcomeName, firstName);
      setText(dashboardDateText, formatDashboardDate());
      setText(dashboardProjectCount, String(getVisibleCaseItems().length));
      setText(dashboardOpenCount, String(activeItems.length));
      setText(projectOpenCount, String(activeItems.length));
      setText(dashboardAttentionCount, String(attentionItems.length));
      setText(dashboardQaStatus, items.length > 0 ? "Via sag" : "-");
      setText(currentScopeValue, currentCaseFilterLabel());
      setText(moduleProjectsMeta, items.length > 0 ? activeItems.length + " aktive sager · " + items.length + " i alt" : "Ingen sager hentet endnu");
    }

    async function loadProjects() {
      state.projectsLoading = true;
      state.projectLoadError = "";
      renderProjects();
      try {
        const response = await apiFetch("/api/projects?scope=mine", { method: "GET" });
        state.projects = response && Array.isArray(response.projects) ? response.projects : [];
        state.ownerLabelMap.clear();
      } catch (error) {
        if (handleAuthFailure(error)) return;
        state.projects = [];
        state.projectLoadError = getErrorMessage(error, "request_failed");
      } finally {
        state.projectsLoading = false;
        renderProjects();
      }
    }

    function getRoutePathForView(view) {
      if (view === "projects") return "/sager";
      if (view === "calendar") return "/kalender";
      if (view === "resource-groups") return "/indstillinger";
      return "/";
    }

    function getCurrentAppViewFromHash() {
      const path = String(window.location.pathname || "/").toLowerCase();
      if (path === "/sager" || path.indexOf("/sager/") === 0) return "projects";
      if (path === "/kalender") return "calendar";
      if (path === "/indstillinger") return "resource-groups";
      const hash = String(window.location.hash || "").replace(/^#/, "").toLowerCase();
      if (hash === "resource-groups") return "resource-groups";
      if (hash === "calendar") return "calendar";
      if (hash === "projects") return "projects";
      return "dashboard";
    }

    function setActiveAppView(view) {
      const activeView = view === "projects" || view === "calendar" || view === "resource-groups" ? view : "dashboard";
      state.currentView = activeView;
      if (appShell) appShell.classList.toggle("caseOverviewActive", activeView === "projects");
      if (dashboardView) dashboardView.hidden = activeView !== "dashboard";
      if (calendarView) calendarView.hidden = activeView !== "calendar";
      if (resourceGroupsView) resourceGroupsView.hidden = activeView !== "resource-groups";
      if (projectsView) projectsView.hidden = activeView !== "projects";
      viewLinks.forEach((link) => {
        const target = String(link.dataset.viewLink || "").toLowerCase();
        const isActive = target === activeView;
        link.classList.toggle("active", isActive);
        if (isActive) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      });
      if (activeView === "projects") renderProjects();
      if (activeView === "calendar") {
        ensureCalendarDefaults();
        renderCalendarAccessState();
        if (state.calendar.activeTab === "absences") {
          loadCalendarResources();
          loadCalendarAbsences();
        }
      }
      if (activeView === "resource-groups") {
        renderResourceGroupAccessState();
        loadResourceGroups();
      }
    }

    function navigateToView(view, options) {
      const path = getRoutePathForView(view);
      if (window.location.pathname !== path) {
        if (options && options.replace) window.history.replaceState({}, "", path);
        else window.history.pushState({}, "", path);
      }
      setActiveAppView(view);
    }

    function wireCaseNavigation() {
      viewLinks.forEach((link) => {
        if (link.dataset.fdRouteWired === "true") return;
        link.dataset.fdRouteWired = "true";
        const view = String(link.dataset.viewLink || "").toLowerCase();
        if (view === "projects" || view === "calendar" || view === "resource-groups" || view === "dashboard") {
          link.href = getRoutePathForView(view);
          link.addEventListener("click", (event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            navigateToView(view);
          });
        }
      });
    }

    function renderDrawerLoading(project) {
      const panel = document.querySelector(".drawerPanel");
      if (!panel) return;
      const item = mapProjectToCaseOverviewItem(project || {});
      panel.innerHTML = '<div class="drawerHandle"></div><div class="fdSheetHeader"><div class="fdSheetTitleBlock"><p class="fdSheetMeta">Indlaeser Quick View</p><h2 id="drawerTitle" class="fdSheetTitle">' + escapeHtml(item.name || "Sag") + '</h2></div><button class="iconBtn" type="button" aria-label="Luk" data-drawer-close><span data-icon="x"></span></button></div><div class="fdSheetBody"><div class="fdSkeleton"></div></div>';
      renderInlineIcons(panel);
      const close = panel.querySelector("[data-drawer-close]");
      if (close) close.addEventListener("click", closeDrawer);
    }

    function renderDrawerError(message) {
      const panel = document.querySelector(".drawerPanel");
      if (!panel) return;
      panel.innerHTML = '<div class="drawerHandle"></div><div class="fdSheetHeader"><div class="fdSheetTitleBlock"><p class="fdSheetMeta">Quick View</p><h2 id="drawerTitle" class="fdSheetTitle">Sag</h2></div><button class="iconBtn" type="button" aria-label="Luk" data-drawer-close><span data-icon="x"></span></button></div><div class="fdSheetBody"><div class="fdErrorState">' + escapeHtml(message || "Kunne ikke vise sag.") + '</div></div>';
      renderInlineIcons(panel);
      const close = panel.querySelector("[data-drawer-close]");
      if (close) close.addEventListener("click", closeDrawer);
    }

    function renderDrawerNotFound() {
      renderDrawerError("Projektet blev ikke fundet eller du har ikke adgang.");
    }

    function renderSheetTabContent(panel, item, tab) {
      if (!panel) return;
      if (tab === "activity") {
        const last = item.activityDate ? "Sidste aktivitet: " + formatActivityDate(item.activityDate) : "Ingen aktivitet at vise";
        panel.textContent = last;
        return;
      }
      if (tab === "docs") {
        if (typeof item.documentsCount === "number") panel.textContent = item.documentsCount + " dokumenter registreret.";
        else panel.textContent = "Ingen dokumenter at vise";
        return;
      }
      panel.textContent = item.description || "Ingen beskrivelse";
    }

    function wireSheetTabs(panel, item) {
      const content = panel.querySelector("[data-sheet-panel]");
      panel.querySelectorAll("[data-sheet-tab]").forEach((button) => {
        button.addEventListener("click", () => {
          panel.querySelectorAll("[data-sheet-tab]").forEach((candidate) => candidate.classList.toggle("active", candidate === button));
          renderSheetTabContent(content, item, button.dataset.sheetTab || "overview");
        });
      });
      renderSheetTabContent(content, item, "overview");
    }

    function renderDrawerProject(project, summary) {
      const panel = document.querySelector(".drawerPanel");
      if (!panel) return;
      const item = mapProjectToCaseOverviewItem(project || {});
      const tone = progressToneClass(item.progressPercent);
      const totalHours = summary && summary.total_project_relevant_hours !== null && summary.total_project_relevant_hours !== undefined
        ? Number(summary.total_project_relevant_hours).toLocaleString("da-DK", { maximumFractionDigits: 1 }) + " t."
        : null;
      const statusLabel = item.status === "obs" ? "OBS" : item.status === "kritisk" ? "Kritisk" : "Aktiv";
      panel.innerHTML =
        '<div class="drawerHandle"></div>' +
        '<div class="fdSheetHeader">' +
          '<div class="fdSheetTitleBlock"><div><span class="fdObsBadge">' + escapeHtml(statusLabel) + '</span> <span class="fdCaseNumber">Sag ' + escapeHtml(item.number) + '</span></div><h2 id="drawerTitle" class="fdSheetTitle">' + escapeHtml(item.name) + '</h2><p class="fdSheetMeta">' + escapeHtml([item.location, item.phase].filter(Boolean).join(" · ") || "Lokation/fase mangler") + '</p></div>' +
          '<button class="iconBtn" type="button" aria-label="Luk" data-drawer-close><span data-icon="x"></span></button>' +
        '</div>' +
        '<div class="fdSheetBody">' +
          '<div class="fdSheetStatGrid">' +
            '<div class="fdSheetStat"><span data-icon="euro"></span><span class="fdSheetLabel">Budget</span><span class="fdSheetStatValue">' + escapeHtml(item.budget || "--") + '</span></div>' +
            '<div class="fdSheetStat"><span data-icon="chart"></span><span class="fdSheetLabel">Forbrug</span><span class="fdSheetStatValue">' + escapeHtml(typeof item.spentPercent === "number" ? Math.round(item.spentPercent) + "%" : "--") + '</span></div>' +
            '<div class="fdSheetStat"><span data-icon="clock"></span><span class="fdSheetLabel">Deadline</span><span class="fdSheetStatValue">' + escapeHtml(item.deadline || "--") + '</span></div>' +
            '<div class="fdSheetStat"><span data-icon="leaf"></span><span class="fdSheetLabel">CO2</span><span class="fdSheetStatValue">' + escapeHtml(item.co2 || "--") + '</span></div>' +
          '</div>' +
          '<section class="fdSheetSection"><div class="fdSheetProgressTop"><p class="fdTinyLabel">Fremdrift</p><span class="fdProgressText ' + tone + '">' + escapeHtml(progressLabel(item)) + '</span></div>' + renderProgressBar(item.progressPercent, true) + '</section>' +
          '<section class="fdSheetTeamRow"><div><p class="fdTinyLabel">Team</p>' + renderAvatarGroup(item.team) + '</div><div class="fdSheetCounters"><span data-icon="paperclip"></span><span>' + escapeHtml(item.documentsCount !== null ? item.documentsCount : 0) + '</span><span data-icon="message"></span><span>' + escapeHtml(item.commentsCount !== null ? item.commentsCount : 0) + '</span></div></section>' +
          (totalHours ? '<section class="fdSheetSection"><p class="fdTinyLabel">Timer</p><p class="fdSheetPanel">' + escapeHtml(totalHours) + ' syncede timer. ' + escapeHtml(summary && summary.definition && summary.definition.description ? summary.definition.description : "") + '</p></section>' : '') +
          '<div class="fdSheetTabs" role="tablist"><button class="fdSheetTab active" type="button" data-sheet-tab="overview">Overblik</button><button class="fdSheetTab" type="button" data-sheet-tab="activity">Aktivitet</button><button class="fdSheetTab" type="button" data-sheet-tab="docs">Dokumenter</button></div>' +
          '<div class="fdSheetPanel" data-sheet-panel></div>' +
        '</div>' +
        '<div class="fdSheetFooter"><a id="openProjectPageLink" class="fdCaseBtn secondary" href="' + projectDetailUrl(item) + '">Gå til sag</a><span class="fdCaseBtn primary" aria-disabled="true">Registrer timer</span></div>';
      renderInlineIcons(panel);
      const close = panel.querySelector("[data-drawer-close]");
      if (close) close.addEventListener("click", closeDrawer);
      const openLink = panel.querySelector("#openProjectPageLink");
      if (openLink) openLink.addEventListener("click", closeDrawer);
      wireSheetTabs(panel, item);
    }

    try {
      const me = await apiFetch("/api/me", { method: "GET" });
      state.me = me && me.user ? me.user : null;
      renderUserChrome();
      if (caseMobileAvatar) {
        const avatarInitials = initialsFromName(state.me && state.me.name ? state.me.name : "D") || "D";
        caseMobileAvatar.textContent = avatarInitials.slice(0, 2);
        caseMobileAvatar.style.background = stableAvatarColor(avatarInitials);
      }
      setAdminNavigationVisibility(state.me);
      if (userPill) {
        const name = state.me && state.me.name ? state.me.name : "Ukendt bruger";
        const role = state.me && state.me.role ? state.me.role : "rolle ukendt";
        userPill.textContent = `${name} · ${role}`;
      }
      renderDashboard();
    } catch (error) {
      if (handleAuthFailure(error)) {
        return;
      }
      if (userPill) {
        userPill.textContent = `Kunne ikke hente bruger: ${getErrorMessage(error, "request_failed")}`;
      }
      return;
    }

    wireCaseNavigation();
    renderInlineIcons(document);
    navigateToView(getCurrentAppViewFromHash(), { replace: true });
    window.addEventListener("hashchange", () => {
      navigateToView(getCurrentAppViewFromHash(), { replace: true });
    });
    window.addEventListener("popstate", () => {
      setActiveAppView(getCurrentAppViewFromHash());
    });
    calendarTabs.forEach((button) => {
      button.addEventListener("click", () => {
        setCalendarTab(button.dataset.calendarTab);
      });
    });

    if (absenceRefreshBtn) {
      absenceRefreshBtn.addEventListener("click", () => {
        state.calendar.loadedKey = "";
        loadCalendarAbsences({ force: true });
      });
    }

    if (absenceFromInput) {
      absenceFromInput.addEventListener("change", () => {
        state.calendar.from = absenceFromInput.value || state.calendar.from;
      });
    }

    if (absenceToInput) {
      absenceToInput.addEventListener("change", () => {
        state.calendar.to = absenceToInput.value || state.calendar.to;
      });
    }

    if (absenceStartDateInput) {
      absenceStartDateInput.addEventListener("change", () => {
        if (absenceEndDateInput && !absenceEndDateInput.value) {
          absenceEndDateInput.value = absenceStartDateInput.value;
        }
      });
    }

    if (absenceCreateForm) {
      absenceCreateForm.addEventListener("submit", submitAbsenceForm);
    }

    if (resourceGroupIncludeArchivedInput) {
      resourceGroupIncludeArchivedInput.addEventListener("change", () => {
        state.resourceGroups.includeArchived = Boolean(resourceGroupIncludeArchivedInput.checked);
        state.resourceGroups.groupsLoaded = false;
        loadResourceGroups({ force: true });
      });
    }

    if (resourceGroupRefreshBtn) {
      resourceGroupRefreshBtn.addEventListener("click", () => {
        state.resourceGroups.groupsLoaded = false;
        loadResourceGroups({ force: true });
      });
    }

    if (resourceGroupCreateForm) {
      resourceGroupCreateForm.addEventListener("submit", submitResourceGroupCreate);
    }

    if (resourceGroupEditForm) {
      resourceGroupEditForm.addEventListener("submit", submitResourceGroupEdit);
    }

    if (resourceGroupArchiveBtn) {
      resourceGroupArchiveBtn.addEventListener("click", () => {
        const group = getSelectedResourceGroup();
        if (!group) {
          setText(resourceGroupEditStatus, "Vælg en gruppe først.");
          return;
        }
        updateResourceGroupStatus(group.id, group.status === "archived" ? "active" : "archived");
      });
    }

    if (resourceGroupMemberAddForm) {
      resourceGroupMemberAddForm.addEventListener("submit", submitResourceGroupMemberAdd);
    }

    if (sortSelect) {
      sortSelect.addEventListener("change", () => {
        state.sortMode = sortSelect.value;
        renderProjects();
      });
    }

    if (projectSearchInput) {
      projectSearchInput.addEventListener("input", () => {
        state.searchQuery = projectSearchInput.value || "";
        if (caseMobileSearchInput && caseMobileSearchInput.value !== state.searchQuery) {
          caseMobileSearchInput.value = state.searchQuery;
        }
        renderProjects();
      });
    }

    if (caseMobileSearchInput) {
      caseMobileSearchInput.addEventListener("input", () => {
        state.searchQuery = caseMobileSearchInput.value || "";
        if (projectSearchInput && projectSearchInput.value !== state.searchQuery) {
          projectSearchInput.value = state.searchQuery;
        }
        renderProjects();
      });
    }

    document.querySelectorAll("[data-case-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        state.caseFilter = button.dataset.caseFilter || "mine";
        renderProjects();
      });
    });

    [caseFab, caseDesktopCreateBtn].forEach((button) => {
      if (!button) return;
      button.addEventListener("click", () => {
        button.setAttribute("aria-disabled", "true");
      });
    });

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

    await loadProjects();

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

  function renderProjectDetail(vm, options) {
    const currentUser = options && options.currentUser ? options.currentUser : null;

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

    function setNote(id, value) {
      const node = el(id);
      if (!node) {
        return;
      }
      const safe = value === null || value === undefined || value === "" ? "" : String(value);
      node.textContent = safe;
      node.hidden = !safe;
    }

    function sameDate(left, right) {
      if (!left || !right) {
        return false;
      }
      return left.getTime() === right.getTime();
    }

    function getActivitySourceText(detailVm) {
      if (!detailVm || !detailVm.dates || !detailVm.dates.lastActivityDate) {
        return null;
      }
      const activityDate = detailVm.dates.lastActivityDate;
      const fromRegistration = sameDate(activityDate, detailVm.dates.lastRegistrationDate);
      const fromFitterHour = sameDate(activityDate, detailVm.dates.lastFitterHourDate);
      if (fromRegistration && fromFitterHour) {
        return "Fra seneste registrering og montørtime i Fielddesk.";
      }
      if (fromRegistration) {
        return "Fra seneste registrering i Fielddesk.";
      }
      if (fromFitterHour) {
        return "Fra seneste montørtime i Fielddesk.";
      }
      return "Fra projektets registrerede activity-felt.";
    }

    function normalizeIdentity(value) {
      return String(value || "").trim().toLowerCase();
    }

    function getCurrentUserCodes(user) {
      if (!user) {
        return [];
      }
      const candidates = [
        user.username,
        user.user_name,
        user.initials,
        user.login,
        user.email && String(user.email).split("@")[0],
      ];
      return candidates.map(normalizeIdentity).filter(Boolean);
    }

    function isCurrentUserResponsible(detailVm, user) {
      if (!detailVm || !detailVm.responsible || !user) {
        return false;
      }
      const responsibleCode = normalizeIdentity(detailVm.responsible.code);
      const responsibleName = normalizeIdentity(detailVm.responsible.name);
      const userCodes = getCurrentUserCodes(user);
      const userName = normalizeIdentity(user.name || user.full_name || user.display_name);
      return Boolean(
        (responsibleCode && userCodes.includes(responsibleCode))
        || (responsibleName && userName && responsibleName === userName)
      );
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
    const relationSection = el("relationSection");
    const detailResponsible = el("detailResponsible");

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

    const currentUserIsResponsible = isCurrentUserResponsible(vm, currentUser);

    setValue("detailResponsible", currentUserIsResponsible ? "Dig" : responsibleText);
    if (detailResponsible) {
      detailResponsible.classList.toggle("fieldValueStrong", currentUserIsResponsible);
    }
    setNote("detailResponsibleNote", currentUserIsResponsible && responsibleText ? responsibleText : null);
    setValue("detailTeamLeader", teamLeaderText);
    if (relationSection) {
      const parentLabel = vm && vm.relation && vm.relation.parentProjectEkId
        ? `EK parent ${vm.relation.parentProjectEkId}`
        : vm && vm.relation && vm.relation.isSubproject
          ? "Underprojekt uden verificeret parent-reference"
          : null;
      relationSection.hidden = !parentLabel;
      setValue("detailParentProject", parentLabel);
    }
    setValue("detailActivityDate", vm && vm.dates ? formatDate(vm.dates.lastActivityDate) : null);
    setNote("detailActivitySource", getActivitySourceText(vm));
    setValue("detailUpdatedDate", vm && vm.dates ? formatDate(vm.dates.updatedDate) : null);
    setValue("detailLastRegistration", vm && vm.dates ? formatDate(vm.dates.lastRegistrationDate) : null);
    setValue("detailLastFitterHour", vm && vm.dates ? formatDate(vm.dates.lastFitterHourDate) : null);
    setValue(
      "detailDaysSinceActivity",
      vm && vm.dates && typeof vm.dates.daysSinceActivity === "number"
        ? `${vm.dates.daysSinceActivity} dage`
        : null
    );

    if (economySection) {
      const hasVisibleEconomy = Boolean(vm && vm.economy && (
        vm.economy.wip.margin !== null
        || vm.economy.wip.costs !== null
        || vm.economy.wip.ongoing !== null
        || vm.economy.wip.billed !== null
      ));
      economySection.hidden = !hasVisibleEconomy;
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

    const appShell = document.querySelector(".appShell");
    const brandInitials = document.getElementById("brandInitials");
    const brandUserName = document.getElementById("brandUserName");
    const logoutBtn = document.getElementById("logoutBtn");
    const projectId = getProjectIdFromPath();
    const qaSection = document.getElementById("qaSection");
    const qaSummaryGrid = document.getElementById("qaSummaryGrid");
    const qaMetaText = document.getElementById("qaMetaText");
    const qaStateNode = document.getElementById("qaState");
    const qaThreadList = document.getElementById("qaThreadList");
    const qaNewThreadToggle = document.getElementById("qaNewThreadToggle");
    const qaViewAllBtn = document.getElementById("qaViewAllBtn");
    const qaNewThreadForm = document.getElementById("qaNewThreadForm");
    const qaNewThreadTitle = document.getElementById("qaNewThreadTitle");
    const qaNewThreadPriority = document.getElementById("qaNewThreadPriority");
    const qaNewThreadMessage = document.getElementById("qaNewThreadMessage");
    const qaCancelNewThreadBtn = document.getElementById("qaCancelNewThreadBtn");
    const qaCreateThreadBtn = document.getElementById("qaCreateThreadBtn");
    const qaDrawerShell = document.getElementById("qaDrawerShell");
    const qaDrawerOverlay = document.getElementById("qaDrawerOverlay");
    const qaDrawerCloseBtn = document.getElementById("qaDrawerCloseBtn");
    const qaDrawerTitle = document.getElementById("qaDrawerTitle");
    const qaDrawerMeta = document.getElementById("qaDrawerMeta");
    const qaDrawerBody = document.getElementById("qaDrawerBody");
    const qaMessageForm = document.getElementById("qaMessageForm");
    const qaMessageInput = document.getElementById("qaMessageInput");
    const qaAddMessageBtn = document.getElementById("qaAddMessageBtn");
    const qaAllThreadsView = document.getElementById("qaAllThreadsView");
    const qaAllThreadsBody = document.getElementById("qaAllThreadsBody");
    const qaAllSearchInput = document.getElementById("qaAllSearchInput");
    const qaAllSortSelect = document.getElementById("qaAllSortSelect");
    const qaUnsavedConfirm = document.getElementById("qaUnsavedConfirm");
    const qaStayBtn = document.getElementById("qaStayBtn");
    const qaDiscardBtn = document.getElementById("qaDiscardBtn");
    const equipmentSection = document.getElementById("equipmentSection");
    const equipmentMetaText = document.getElementById("equipmentMetaText");
    const equipmentSummaryGrid = document.getElementById("equipmentSummaryGrid");
    const equipmentStateNode = document.getElementById("equipmentState");
    const equipmentList = document.getElementById("equipmentList");
    const equipmentSearchInput = document.getElementById("equipmentSearchInput");
    const equipmentAddBtn = document.getElementById("equipmentAddBtn");
    const equipmentCheckBtn = document.getElementById("equipmentCheckBtn");
    const equipmentExportLink = document.getElementById("equipmentExportLink");
    const equipmentDrawerShell = document.getElementById("equipmentDrawerShell");
    const equipmentDrawerOverlay = document.getElementById("equipmentDrawerOverlay");
    const equipmentDrawerCloseBtn = document.getElementById("equipmentDrawerCloseBtn");
    const equipmentDrawerTitle = document.getElementById("equipmentDrawerTitle");
    const equipmentDrawerMeta = document.getElementById("equipmentDrawerMeta");
    const equipmentCameraForm = document.getElementById("equipmentCameraForm");
    const equipmentCameraIdInput = document.getElementById("equipmentCameraIdInput");
    const equipmentMacInput = document.getElementById("equipmentMacInput");
    const equipmentSerialInput = document.getElementById("equipmentSerialInput");
    const equipmentModelInput = document.getElementById("equipmentModelInput");
    const equipmentLocationInput = document.getElementById("equipmentLocationInput");
    const equipmentStatusSelect = document.getElementById("equipmentStatusSelect");
    const equipmentNoteInput = document.getElementById("equipmentNoteInput");
    const equipmentFormStatus = document.getElementById("equipmentFormStatus");
    const equipmentArchiveBtn = document.getElementById("equipmentArchiveBtn");
    const equipmentCancelBtn = document.getElementById("equipmentCancelBtn");
    const equipmentSaveBtn = document.getElementById("equipmentSaveBtn");
    const equipmentCheckView = document.getElementById("equipmentCheckView");
    const equipmentCheckInput = document.getElementById("equipmentCheckInput");
    const equipmentCheckSubmitBtn = document.getElementById("equipmentCheckSubmitBtn");
    const equipmentCheckStatus = document.getElementById("equipmentCheckStatus");
    const equipmentCheckResult = document.getElementById("equipmentCheckResult");

    if (!projectId) {
      renderProjectDetailError("Ugyldig sagssti");
      return;
    }

    const qaUi = Boolean(qaSummaryGrid && qaMetaText && qaStateNode && qaThreadList);
    const qaState = {
      summary: { NEW: 0, WAITING: 0, ANSWERED: 0, CLOSED: 0 },
      threads: [],
      detailThread: null,
      messages: [],
      activeThreadId: null,
      modalMode: null,
      pendingForceClose: false,
      allSearch: "",
      allSort: qaAllSortSelect && qaAllSortSelect.value ? qaAllSortSelect.value : "activity_desc",
      isLoadingThreads: false,
      isSaving: false,
    };

    const equipmentUi = Boolean(equipmentSection && equipmentSummaryGrid && equipmentStateNode && equipmentList);
    const equipmentStatuses = [
      { value: "registered", label: "Registreret", className: "qaBadgeNew" },
      { value: "planned", label: "Planlagt", className: "qaBadgeMuted" },
      { value: "mounted", label: "Monteret", className: "qaBadgeWaitingContext" },
      { value: "checked", label: "Kontrolleret", className: "qaBadgeAnswered" },
      { value: "deviation", label: "Afvigelse", className: "qaBadgeHigh" },
    ];
    const equipmentState = {
      cameras: [],
      summary: { registered: 0, planned: 0, mounted: 0, checked: 0, deviation: 0 },
      search: "",
      activeCameraId: null,
      mode: null,
      checkCamera: null,
      searchTimer: null,
      isLoading: false,
    };
    let projectPageUser = null;

    function compactProjectUserName(name) {
      const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
      if (parts.length <= 2) {
        return parts.join(" ") || "Fielddesk";
      }
      return `${parts[0]} ${parts[1].charAt(0).toUpperCase()}. ${parts[parts.length - 1]}`;
    }

    function getProjectLoginInitials(user) {
      const login = String(
        (user && (user.username || user.login_name || user.loginName))
          || (user && user.email ? String(user.email).split("@")[0] : "")
          || ""
      ).trim();

      if (login) {
        return login.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase() || "FD";
      }

      const nameParts = String(user && user.name ? user.name : "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      const initials = nameParts.map((part) => part.charAt(0)).join("").slice(0, 4).toUpperCase();
      return initials || "FD";
    }

    function renderProjectUserChrome(user) {
      if (brandInitials) {
        brandInitials.textContent = getProjectLoginInitials(user || {});
      }
      if (brandUserName) {
        brandUserName.textContent = compactProjectUserName(user && user.name ? user.name : "Fielddesk");
      }
    }

    const QA_STATUS_OPTIONS = [
      { value: "NEW", label: "Ny", className: "qaBadgeNew" },
      { value: "WAITING", label: "Venter", className: "qaBadgeWaiting" },
      { value: "ANSWERED", label: "Besvaret", className: "qaBadgeAnswered" },
      { value: "CLOSED", label: "Lukket", className: "qaBadgeClosed" },
    ];

    const QA_PRIORITY_OPTIONS = {
      low: { label: "Lav", className: "" },
      normal: { label: "Normal", className: "" },
      high: { label: "Hoj", className: "qaBadgeHigh" },
    };

    const QA_WAITING_CONTEXTS = {
      technician: "Afventer tekniker",
      fitter: "Afventer tekniker",
      installer: "Afventer tekniker",
      tekniker: "Afventer tekniker",
      project_manager: "Afventer projektleder",
      projectleader: "Afventer projektleder",
      project_leader: "Afventer projektleder",
      projektleder: "Afventer projektleder",
      customer: "Afventer kunde",
      client: "Afventer kunde",
      kunde: "Afventer kunde",
    };

    function getQaStatusView(status) {
      const normalized = String(status || "NEW").trim().toUpperCase();
      return QA_STATUS_OPTIONS.find((item) => item.value === normalized) || QA_STATUS_OPTIONS[0];
    }

    async function loadQaPermissions() {
      try {
        const response = await apiFetch("/api/me", { method: "GET" });
        projectPageUser = response && response.user ? response.user : null;
        renderProjectUserChrome(projectPageUser);
        setAdminNavigationVisibility(projectPageUser);
      } catch (error) {
        if (handleAuthFailure(error)) {
          return false;
        }
      }
      return true;
    }

    function getQaPriorityView(priority) {
      const normalized = String(priority || "normal").trim().toLowerCase();
      return QA_PRIORITY_OPTIONS[normalized] || QA_PRIORITY_OPTIONS.normal;
    }

    function getQaWaitingContextView(source) {
      const statusView = getQaStatusView(source && source.status);
      if (statusView.value !== "WAITING") {
        return { label: "Ingen afventer", className: "qaBadgeMuted", isActive: false };
      }

      const raw = source && (
        source.waiting_on
        || source.waitingOn
        || source.awaiting
        || source.awaiting_role
        || source.awaitingRole
        || source.waiting_context
        || source.waitingContext
        || source.assignee_type
        || source.assigneeType
      );
      const normalized = String(raw || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
      return {
        label: QA_WAITING_CONTEXTS[normalized] || "Afventer ikke angivet",
        className: "qaBadgeWaitingContext",
        isActive: true,
      };
    }

    function getQaPersonalView(thread) {
      const state = String(thread && thread.personal_state ? thread.personal_state : "").trim().toLowerCase();
      if (state === "new" || thread?.is_unread) {
        return { label: "Ulæst", className: "qaBadgeNew", isNew: true };
      }
      if (state === "sent") {
        return { label: "Sendt", className: "qaBadgeMuted", isNew: false };
      }
      if (state === "closed") {
        return { label: "Læst", className: "qaBadgeMuted", isNew: false };
      }
      return { label: "Set", className: "qaBadgeMuted", isNew: false };
    }

    function getQaActivityAt(thread) {
      const candidates = [
        thread && thread.updated_at,
        thread && thread.latest_message_at,
        thread && thread.created_at,
      ].filter(Boolean);
      let latest = null;
      candidates.forEach((value) => {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime()) && (!latest || parsed > latest)) {
          latest = parsed;
        }
      });
      return latest ? latest.toISOString() : null;
    }

    function getQaActivityTime(thread) {
      const parsed = new Date(getQaActivityAt(thread));
      return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
    }

    function qaRequiresCurrentUserAction(thread) {
      if (!thread || getQaStatusView(thread.status).value === "CLOSED") {
        return false;
      }
      const personalState = String(thread.personal_state || "").trim().toLowerCase();
      return Boolean(thread.is_assigned_to_me && (personalState === "new" || thread.is_unread));
    }

    function sortQaThreadsForOverview(threads) {
      return (Array.isArray(threads) ? threads : []).slice().sort((left, right) => {
        const leftAction = qaRequiresCurrentUserAction(left) ? 1 : 0;
        const rightAction = qaRequiresCurrentUserAction(right) ? 1 : 0;
        if (leftAction !== rightAction) {
          return rightAction - leftAction;
        }
        return getQaActivityTime(right) - getQaActivityTime(left);
      });
    }

    function sortQaThreadsForAll(threads) {
      const sorted = (Array.isArray(threads) ? threads : []).slice();
      if (qaState.allSort === "title_asc") {
        sorted.sort((left, right) => {
          const leftTitle = String(left && (left.title || left.latest_message_preview) || "").trim().toLocaleLowerCase("da-DK");
          const rightTitle = String(right && (right.title || right.latest_message_preview) || "").trim().toLocaleLowerCase("da-DK");
          return leftTitle.localeCompare(rightTitle, "da-DK") || (getQaActivityTime(right) - getQaActivityTime(left));
        });
        return sorted;
      }
      sorted.sort((left, right) => getQaActivityTime(right) - getQaActivityTime(left));
      return sorted;
    }

    function filterQaThreadsForAll(threads) {
      const query = String(qaState.allSearch || "").trim().toLocaleLowerCase("da-DK");
      const source = sortQaThreadsForAll(threads);
      if (!query) {
        return source;
      }
      return source.filter((thread) => {
        const haystack = [
          thread && thread.title,
          thread && thread.latest_message_preview,
        ].filter(Boolean).join(" ").toLocaleLowerCase("da-DK");
        return haystack.includes(query);
      });
    }

    function formatQaDate(value) {
      if (!value) {
        return "-";
      }
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        return "-";
      }
      try {
        return new Intl.DateTimeFormat("da-DK", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }).format(parsed);
      } catch (_error) {
        return "-";
      }
    }

    function formatQaRelativeDate(value) {
      if (!value) {
        return "-";
      }
      const parsed = new Date(value);
      const timestamp = parsed.getTime();
      if (Number.isNaN(timestamp)) {
        return "-";
      }

      const diffMs = Date.now() - timestamp;
      const absDiffMs = Math.abs(diffMs);
      const minuteMs = 60 * 1000;
      const hourMs = 60 * minuteMs;
      const dayMs = 24 * hourMs;

      if (absDiffMs < minuteMs) {
        return "Lige nu";
      }
      if (diffMs < 0) {
        return formatQaDate(value);
      }
      if (diffMs < hourMs) {
        const minutes = Math.max(1, Math.floor(diffMs / minuteMs));
        return `${minutes} min siden`;
      }
      if (diffMs < dayMs) {
        const hours = Math.max(1, Math.floor(diffMs / hourMs));
        return hours === 1 ? "1 time siden" : `${hours} timer siden`;
      }
      if (diffMs < 7 * dayMs) {
        const days = Math.max(1, Math.floor(diffMs / dayMs));
        return days === 1 ? "1 dag siden" : `${days} dage siden`;
      }

      return formatQaDate(value);
    }

    function setQaStateMessage(message, isError) {
      if (!qaStateNode) {
        return;
      }
      qaStateNode.hidden = !message;
      qaStateNode.textContent = message || "";
      qaStateNode.style.borderColor = isError ? "#f2b3b3" : "";
      qaStateNode.style.background = isError ? "#fff0f0" : "";
      qaStateNode.style.color = isError ? "#991b1b" : "";
    }

    function makeQaBadge(label, className) {
      const badge = document.createElement("span");
      badge.className = `qaBadge ${className || ""}`.trim();
      badge.textContent = label;
      return badge;
    }

    function qaErrorMessage(error, fallback) {
      if (error && error.status === 401) {
        logout();
        return null;
      }

      if (error && error.status === 403) {
        if (error.code === "module_access_denied") {
          return "QA er ikke tilgaengelig for din rolle.";
        }
        return "Du har ikke adgang til denne QA handling.";
      }

      if (error && error.status === 404) {
        return "QA data blev ikke fundet for dette projekt.";
      }

      return getErrorMessage(error, fallback);
    }

    function setQaListActionsDisabled(disabled) {
      if (qaNewThreadToggle) {
        qaNewThreadToggle.disabled = Boolean(disabled);
      }
      if (qaViewAllBtn) {
        qaViewAllBtn.disabled = Boolean(disabled);
      }
      if (qaCreateThreadBtn) {
        qaCreateThreadBtn.disabled = Boolean(disabled);
      }
    }

    function hideQaUnsavedConfirm() {
      if (qaUnsavedConfirm) {
        qaUnsavedConfirm.hidden = true;
      }
    }

    function hasQaUnsavedInput() {
      if (qaState.modalMode === "new") {
        const title = qaNewThreadTitle ? qaNewThreadTitle.value.trim() : "";
        const message = qaNewThreadMessage ? qaNewThreadMessage.value.trim() : "";
        const priority = qaNewThreadPriority ? qaNewThreadPriority.value : "normal";
        return Boolean(title || message || priority !== "normal");
      }
      if (qaState.modalMode === "thread") {
        const message = qaMessageInput ? qaMessageInput.value.trim() : "";
        return Boolean(message);
      }
      return false;
    }

    function showQaUnsavedConfirm() {
      if (qaUnsavedConfirm) {
        qaUnsavedConfirm.hidden = false;
      }
      if (qaStayBtn) {
        qaStayBtn.focus();
      }
    }

    function setQaModalMode(mode) {
      qaState.modalMode = mode;
      hideQaUnsavedConfirm();
      if (qaNewThreadForm) {
        qaNewThreadForm.hidden = mode !== "new";
      }
      if (qaAllThreadsView) {
        qaAllThreadsView.hidden = mode !== "all";
      }
      if (qaDrawerBody) {
        qaDrawerBody.hidden = mode !== "thread";
      }
      if (qaMessageForm) {
        qaMessageForm.hidden = mode !== "thread";
      }
    }

    function openQaDrawerShell() {
      if (!qaDrawerShell) {
        return;
      }
      qaDrawerShell.classList.add("open");
      qaDrawerShell.setAttribute("aria-hidden", "false");
      document.body.classList.add("qa-modal-open");
    }

    function closeQaDrawer(forceClose = false) {
      if (!qaDrawerShell) {
        return;
      }
      if (!forceClose && hasQaUnsavedInput()) {
        showQaUnsavedConfirm();
        return;
      }
      qaDrawerShell.classList.remove("open");
      qaDrawerShell.setAttribute("aria-hidden", "true");
      document.body.classList.remove("qa-modal-open");
      qaState.activeThreadId = null;
      qaState.detailThread = null;
      qaState.messages = [];
      qaState.modalMode = null;
      hideQaUnsavedConfirm();
      if (qaMessageInput) {
        qaMessageInput.value = "";
      }
      if (qaNewThreadTitle) qaNewThreadTitle.value = "";
      if (qaNewThreadMessage) qaNewThreadMessage.value = "";
      if (qaNewThreadPriority) qaNewThreadPriority.value = "normal";
    }

    function openQaNewThreadModal(shouldFocus) {
      setQaModalMode("new");
      if (qaDrawerTitle) {
        qaDrawerTitle.textContent = "Opret tråd";
      }
      if (qaDrawerMeta) {
        qaDrawerMeta.textContent = "Ny projekt-specifik QA";
        qaDrawerMeta.title = "";
      }
      renderQaNewThreadNotice("", false);
      openQaDrawerShell();
      if (shouldFocus && qaNewThreadTitle) {
        qaNewThreadTitle.focus();
      }
    }

    function openQaAllThreadsModal() {
      setQaModalMode("all");
      if (qaDrawerTitle) {
        qaDrawerTitle.textContent = "Alle QA-tråde";
      }
      if (qaDrawerMeta) {
        qaDrawerMeta.textContent = "Kun dette projekt";
        qaDrawerMeta.title = "";
      }
      renderQaAllThreads();
      openQaDrawerShell();
      if (qaAllSearchInput) {
        qaAllSearchInput.focus();
      }
    }

    function renderQaSummary() {
      if (!qaSummaryGrid) {
        return;
      }
      qaSummaryGrid.innerHTML = "";
      QA_STATUS_OPTIONS.forEach((status) => {
        const card = document.createElement("div");
        card.className = "qaSummaryCard";

        const label = document.createElement("span");
        label.className = "qaSummaryLabel";
        label.textContent = status.label;

        const value = document.createElement("span");
        value.className = "qaSummaryValue";
        value.textContent = String(Number(qaState.summary[status.value] || 0));

        card.appendChild(label);
        card.appendChild(value);
        qaSummaryGrid.appendChild(card);
      });
    }

    function createQaThreadCard(thread, options = {}) {
      const statusView = getQaStatusView(thread.status);
      const priorityView = getQaPriorityView(thread.priority);
      const waitingView = getQaWaitingContextView(thread);
      const personalView = getQaPersonalView(thread);
      const requiresAction = qaRequiresCurrentUserAction(thread);
      const activityAt = getQaActivityAt(thread);
      const messageCount = Number(thread.message_count || 0);
      const card = document.createElement("button");
      card.type = "button";
      card.className = [
        "qaThreadCard",
        statusView.value === "WAITING" ? "qaThreadCardWaiting" : "",
        requiresAction ? "qaThreadCardAttention" : "",
      ].filter(Boolean).join(" ");

      const top = document.createElement("div");
      top.className = "qaThreadTop";

      const title = document.createElement("h3");
      title.className = "qaThreadTitle";
      title.textContent = thread.title || thread.latest_message_preview || "QA thread";

      const badges = document.createElement("div");
      badges.className = "qaBadgeRow";
      badges.appendChild(makeQaBadge(statusView.label, statusView.className));
      badges.appendChild(makeQaBadge(priorityView.label, priorityView.className));
      if (personalView.isNew || options.showPersonalState) {
        badges.appendChild(makeQaBadge(personalView.label, personalView.className));
      }
      if (thread.is_assigned_to_me) {
        badges.appendChild(makeQaBadge("Til mig", "qaBadgeWaitingContext"));
      }
      if (waitingView.isActive) {
        badges.appendChild(makeQaBadge(waitingView.label, waitingView.className));
      }

      top.appendChild(title);
      top.appendChild(badges);

      const preview = document.createElement("p");
      preview.className = "qaThreadPreview";
      const previewLabel = document.createElement("span");
      previewLabel.className = "qaThreadPreviewLabel";
      previewLabel.textContent = "Seneste besked";
      preview.appendChild(previewLabel);
      preview.appendChild(document.createTextNode(thread.latest_message_preview || "Ingen beskedpreview."));

      const meta = document.createElement("p");
      meta.className = "qaThreadMeta";
      meta.textContent = messageCount === 1 ? "1 besked" : `${messageCount} beskeder`;

      const updated = document.createElement("p");
      updated.className = "qaThreadUpdated";
      updated.textContent = `Opdateret ${formatQaRelativeDate(activityAt)}`;
      updated.title = formatQaDate(activityAt);

      const metaRow = document.createElement("div");
      metaRow.className = "qaThreadMetaRow";
      metaRow.appendChild(meta);
      metaRow.appendChild(updated);

      card.appendChild(top);
      if (requiresAction) {
        const waitingHint = document.createElement("p");
        waitingHint.className = "qaWaitingHint";
        waitingHint.textContent = "Kræver mit svar";
        card.appendChild(waitingHint);
      }
      card.appendChild(preview);
      card.appendChild(metaRow);
      card.addEventListener("click", () => {
        openQaDrawer(thread.id);
      });

      return card;
    }

    function appendQaThreadGroup(parent, label, threads) {
      if (!threads.length) {
        return;
      }
      const group = document.createElement("div");
      group.className = "qaThreadGroup";
      const heading = document.createElement("p");
      heading.className = "qaThreadGroupLabel";
      heading.textContent = label;
      group.appendChild(heading);
      threads.forEach((thread) => {
        group.appendChild(createQaThreadCard(thread));
      });
      parent.appendChild(group);
    }

    function renderQaThreadList() {
      if (!qaThreadList || !qaMetaText) {
        return;
      }

      qaThreadList.innerHTML = "";
      renderQaSummary();

      const count = qaState.threads.length;
      qaMetaText.textContent = count === 1 ? "1 thread" : `${count} threads`;

      if (qaState.isLoadingThreads) {
        setQaStateMessage("Indlaeser QA threads...", false);
        return;
      }

      if (count === 0) {
        setQaStateMessage("", false);
        const empty = document.createElement("div");
        empty.className = "qaEmptyState";

        const title = document.createElement("h3");
        title.className = "qaEmptyTitle";
        title.textContent = "Ingen QA endnu";

        const text = document.createElement("p");
        text.className = "qaEmptyText";
        text.textContent = "Start den forste projektorienterede afklaring, saa dialogen bliver samlet her.";

        const actions = document.createElement("div");
        actions.className = "qaEmptyActions";

        const action = document.createElement("button");
        action.type = "button";
        action.className = "btn btnPrimary btnCompact";
        action.textContent = "Opret tråd";
        action.addEventListener("click", () => {
          openQaNewThreadModal(true);
        });

        actions.appendChild(action);
        empty.appendChild(title);
        empty.appendChild(text);
        empty.appendChild(actions);
        qaThreadList.appendChild(empty);
        return;
      }

      setQaStateMessage("", false);

      const sortedThreads = sortQaThreadsForOverview(qaState.threads);
      const actionThreads = sortedThreads.filter(qaRequiresCurrentUserAction);
      const otherThreads = sortedThreads.filter((thread) => !qaRequiresCurrentUserAction(thread));
      appendQaThreadGroup(qaThreadList, "Kræver mit svar", actionThreads);
      appendQaThreadGroup(qaThreadList, "Øvrige tråde", otherThreads);
    }

    function scrollQaDrawerToLatest() {
      if (!qaDrawerBody) {
        return;
      }
      window.requestAnimationFrame(() => {
        qaDrawerBody.scrollTop = qaDrawerBody.scrollHeight;
      });
    }

    function renderQaAllThreads() {
      if (!qaAllThreadsBody) {
        return;
      }
      qaAllThreadsBody.innerHTML = "";
      const filtered = filterQaThreadsForAll(qaState.threads);
      const mine = filtered.filter((thread) => thread.is_assigned_to_me || ["new", "sent"].includes(String(thread.personal_state || "").toLowerCase()));
      const mineIds = new Set(mine.map((thread) => String(thread.id)));
      const shared = filtered.filter((thread) => !mineIds.has(String(thread.id)));

      function makeColumn(title, threads) {
        const column = document.createElement("div");
        column.className = "qaAllColumn";
        const heading = document.createElement("h3");
        heading.className = "qaAllColumnTitle";
        heading.textContent = `${title} (${threads.length})`;
        column.appendChild(heading);
        if (!threads.length) {
          const empty = document.createElement("div");
          empty.className = "sectionState";
          empty.textContent = "Ingen tråde matcher.";
          column.appendChild(empty);
          return column;
        }
        threads.forEach((thread) => {
          column.appendChild(createQaThreadCard(thread, { showPersonalState: true }));
        });
        return column;
      }

      qaAllThreadsBody.appendChild(makeColumn("Mine", mine));
      qaAllThreadsBody.appendChild(makeColumn("Fælles", shared));
    }

    function setQaDrawerLoading() {
      if (qaDrawerTitle) {
        qaDrawerTitle.textContent = "QA thread";
      }
      if (qaDrawerMeta) {
        qaDrawerMeta.textContent = "Indlaeser...";
      }
      if (qaDrawerBody) {
        qaDrawerBody.innerHTML = "";
        const state = document.createElement("div");
        state.className = "sectionState";
        state.textContent = "Indlaeser thread...";
        qaDrawerBody.appendChild(state);
      }
    }

    function renderQaDrawerNotice(message, isError) {
      if (!qaDrawerBody || !message) {
        return;
      }
      const notice = document.createElement("div");
      notice.className = "sectionState";
      notice.textContent = message;
      if (isError) {
        notice.style.borderColor = "#f2b3b3";
        notice.style.background = "#fff0f0";
        notice.style.color = "#991b1b";
      }
      qaDrawerBody.prepend(notice);
    }

    function renderQaNewThreadNotice(message, isError) {
      if (!qaNewThreadForm) {
        return;
      }
      const existing = qaNewThreadForm.querySelector("[data-qa-new-notice]");
      if (existing) {
        existing.remove();
      }
      if (!message) {
        return;
      }
      const notice = document.createElement("div");
      notice.dataset.qaNewNotice = "true";
      notice.className = "sectionState";
      notice.textContent = message;
      if (isError) {
        notice.style.borderColor = "#f2b3b3";
        notice.style.background = "#fff0f0";
        notice.style.color = "#991b1b";
      }
      qaNewThreadForm.prepend(notice);
    }

    function renderQaDrawerDetail(shouldScrollToLatest) {
      if (!qaDrawerBody) {
        return;
      }

      const thread = qaState.detailThread;
      if (!thread) {
        setQaDrawerLoading();
        return;
      }

      const statusView = getQaStatusView(thread.status);
      const priorityView = getQaPriorityView(thread.priority);
      const waitingView = getQaWaitingContextView(thread);
      const activityAt = thread.updated_at || thread.created_at;

      if (qaDrawerTitle) {
        qaDrawerTitle.textContent = thread.title || "QA thread";
      }
      if (qaDrawerMeta) {
        qaDrawerMeta.textContent = [
          statusView.label,
          priorityView.label,
          waitingView.isActive ? waitingView.label : null,
          `Opdateret ${formatQaRelativeDate(activityAt)}`,
        ].filter(Boolean).join(" · ");
        qaDrawerMeta.title = [
          statusView.label,
          priorityView.label,
          waitingView.isActive ? waitingView.label : null,
          `Opdateret ${formatQaDate(activityAt)}`,
        ].filter(Boolean).join(" · ");
      }

      qaDrawerBody.innerHTML = "";
      const badgeRow = document.createElement("div");
      badgeRow.className = "qaBadgeRow";
      badgeRow.appendChild(makeQaBadge(statusView.label, statusView.className));
      badgeRow.appendChild(makeQaBadge(priorityView.label, priorityView.className));
      if (waitingView.isActive) {
        badgeRow.appendChild(makeQaBadge(waitingView.label, waitingView.className));
      }
      qaDrawerBody.appendChild(badgeRow);

      if (qaState.messages.length === 0) {
        const empty = document.createElement("div");
        empty.className = "sectionState";
        empty.textContent = "Ingen beskeder endnu.";
        qaDrawerBody.appendChild(empty);
        return;
      }

      qaState.messages.forEach((message) => {
        const card = document.createElement("div");
        card.className = "qaMessageCard";

        const meta = document.createElement("div");
        meta.className = "qaMessageMeta";

        const user = document.createElement("span");
        user.textContent = message.user_name || "Ukendt bruger";

        const date = document.createElement("span");
        date.textContent = formatQaRelativeDate(message.created_at);
        date.title = formatQaDate(message.created_at);

        const text = document.createElement("p");
        text.className = "qaMessageText";
        text.textContent = message.message || "";

        meta.appendChild(user);
        meta.appendChild(date);
        card.appendChild(meta);
        card.appendChild(text);
        qaDrawerBody.appendChild(card);
      });

      if (shouldScrollToLatest) {
        scrollQaDrawerToLatest();
      }
    }

    async function loadQaThreads() {
      if (!qaUi) {
        return;
      }

      qaState.isLoadingThreads = true;
      renderQaThreadList();

      try {
        const response = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/qa/threads`, { method: "GET" });
        qaState.summary = response && response.summary ? response.summary : { NEW: 0, WAITING: 0, ANSWERED: 0, CLOSED: 0 };
        qaState.threads = response && Array.isArray(response.threads) ? response.threads : [];
        setQaListActionsDisabled(false);
      } catch (error) {
        const message = qaErrorMessage(error, "Kunne ikke hente QA threads.");
        if (!message) {
          return;
        }
        qaState.summary = { NEW: 0, WAITING: 0, ANSWERED: 0, CLOSED: 0 };
        qaState.threads = [];
        qaMetaText.textContent = "QA utilgaengelig";
        renderQaSummary();
        setQaStateMessage(message, true);
        if (error && error.status === 403) {
          setQaListActionsDisabled(true);
        }
        return;
      } finally {
        qaState.isLoadingThreads = false;
      }

      renderQaThreadList();
      if (qaState.modalMode === "all") {
        renderQaAllThreads();
      }
    }

    async function loadQaThreadDetail(threadId, options = {}) {
      if (!threadId) {
        return;
      }

      qaState.activeThreadId = String(threadId);
      setQaDrawerLoading();

      try {
        const response = await apiFetch(`/api/qa/threads/${encodeURIComponent(threadId)}`, { method: "GET" });
        qaState.detailThread = response && response.thread ? response.thread : null;
        qaState.messages = response && Array.isArray(response.messages) ? response.messages : [];
        renderQaDrawerDetail(Boolean(options.scrollToLatest));
      } catch (error) {
        const message = qaErrorMessage(error, "Kunne ikke hente QA thread.");
        if (!message) {
          return;
        }
        if (qaDrawerBody) {
          qaDrawerBody.innerHTML = "";
          renderQaDrawerNotice(message, true);
        }
      }
    }

    function openQaDrawer(threadId) {
      setQaModalMode("thread");
      openQaDrawerShell();
      loadQaThreadDetail(threadId, { scrollToLatest: true });
    }

    async function createQaThread(event) {
      event.preventDefault();
      if (!qaNewThreadMessage || !qaCreateThreadBtn) {
        return;
      }

      const message = qaNewThreadMessage.value.trim();
      if (!message) {
        renderQaNewThreadNotice("Besked er påkrævet.", true);
        return;
      }

      qaCreateThreadBtn.disabled = true;
      renderQaNewThreadNotice("", false);
      try {
        const response = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/qa/threads`, {
          method: "POST",
          body: JSON.stringify({
            title: qaNewThreadTitle ? qaNewThreadTitle.value.trim() || null : null,
            message,
            priority: qaNewThreadPriority ? qaNewThreadPriority.value : "normal",
          }),
        });

        if (qaNewThreadTitle) qaNewThreadTitle.value = "";
        if (qaNewThreadMessage) qaNewThreadMessage.value = "";
        if (qaNewThreadPriority) qaNewThreadPriority.value = "normal";

        await loadQaThreads();
        const threadId = response && response.thread ? response.thread.id : null;
        if (threadId) {
          openQaDrawer(threadId);
        } else {
          closeQaDrawer(true);
        }
      } catch (error) {
        const errorMessage = qaErrorMessage(error, "Kunne ikke oprette QA thread.");
        if (errorMessage) {
          renderQaNewThreadNotice(errorMessage, true);
        }
      } finally {
        qaCreateThreadBtn.disabled = false;
      }
    }

    async function addQaMessage(event) {
      event.preventDefault();
      if (!qaState.activeThreadId || !qaMessageInput || !qaAddMessageBtn) {
        return;
      }

      const message = qaMessageInput.value.trim();
      if (!message) {
        renderQaDrawerNotice("Besked er paakraevet.", true);
        return;
      }

      qaAddMessageBtn.disabled = true;
      try {
        await apiFetch(`/api/qa/threads/${encodeURIComponent(qaState.activeThreadId)}/messages`, {
          method: "POST",
          body: JSON.stringify({ message }),
        });
        qaMessageInput.value = "";
        await loadQaThreadDetail(qaState.activeThreadId, { scrollToLatest: true });
        await loadQaThreads();
      } catch (error) {
        const errorMessage = qaErrorMessage(error, "Kunne ikke tilfoeje besked.");
        if (errorMessage) {
          renderQaDrawerNotice(errorMessage, true);
        }
      } finally {
        qaAddMessageBtn.disabled = false;
      }
    }


    function getEquipmentStatusView(status) {
      const normalized = String(status || "registered").trim().toLowerCase();
      return equipmentStatuses.find((item) => item.value === normalized) || equipmentStatuses[0];
    }

    function setEquipmentStateMessage(message, isError) {
      if (!equipmentStateNode) {
        return;
      }
      equipmentStateNode.hidden = !message;
      equipmentStateNode.textContent = message || "";
      equipmentStateNode.style.borderColor = isError ? "#f2b3b3" : "";
      equipmentStateNode.style.background = isError ? "#fff0f0" : "";
      equipmentStateNode.style.color = isError ? "#991b1b" : "";
    }

    function equipmentErrorMessage(error, fallback) {
      if (error && error.status === 401) {
        logout();
        return null;
      }
      if (error && error.status === 403) {
        return "Du har ikke adgang til Projektudstyr beta.";
      }
      if (error && error.status === 409) {
        const field = error.details && error.details.field ? error.details.field : null;
        if (field === "mac_address") {
          return "MAC-adressen findes allerede paa dette projekt.";
        }
        if (field === "serial_number") {
          return "Serienummeret findes allerede paa dette projekt.";
        }
        return "Kameraet matcher en eksisterende aktiv registrering.";
      }
      if (error && error.code === "invalid_mac_address") {
        return "MAC-adressen skal have 12 hex-tegn, fx 00:11:22:33:44:55.";
      }
      return getErrorMessage(error, fallback);
    }

    function renderEquipmentSummary() {
      if (!equipmentSummaryGrid) {
        return;
      }
      equipmentSummaryGrid.innerHTML = "";
      equipmentStatuses.forEach((status) => {
        const card = document.createElement("div");
        card.className = "qaSummaryCard";
        const label = document.createElement("span");
        label.className = "qaSummaryLabel";
        label.textContent = status.label;
        const value = document.createElement("span");
        value.className = "qaSummaryValue";
        value.textContent = String(Number(equipmentState.summary[status.value] || 0));
        card.appendChild(label);
        card.appendChild(value);
        equipmentSummaryGrid.appendChild(card);
      });
    }

    function makeEquipmentMeta(label, value) {
      const item = document.createElement("div");
      item.className = "equipmentMetaItem";
      const labelNode = document.createElement("span");
      labelNode.className = "equipmentMetaLabel";
      labelNode.textContent = label;
      const valueNode = document.createElement("span");
      valueNode.className = "equipmentMetaValue";
      valueNode.textContent = value || "-";
      item.appendChild(labelNode);
      item.appendChild(valueNode);
      return item;
    }

    function renderEquipmentList() {
      if (!equipmentUi || !equipmentList) {
        return;
      }
      equipmentList.innerHTML = "";
      renderEquipmentSummary();
      const count = equipmentState.cameras.length;
      if (equipmentMetaText) {
        equipmentMetaText.textContent = count === 1 ? "1 CCTV-kamera" : `${count} CCTV-kameraer`;
      }
      if (equipmentState.isLoading) {
        setEquipmentStateMessage("Indlaeser CCTV...", false);
        return;
      }
      if (!count) {
        setEquipmentStateMessage(equipmentState.search ? "Ingen kameraer matcher filteret." : "Ingen CCTV-kameraer registreret endnu.", false);
        return;
      }
      setEquipmentStateMessage("", false);
      equipmentState.cameras.forEach((camera) => {
        const statusView = getEquipmentStatusView(camera.status);
        const card = document.createElement("article");
        card.className = "equipmentCard";
        const top = document.createElement("div");
        top.className = "equipmentCardTop";
        const title = document.createElement("h3");
        title.className = "equipmentTitle";
        title.textContent = camera.camera_id || "Kamera";
        const badges = document.createElement("div");
        badges.className = "qaBadgeRow";
        badges.appendChild(makeQaBadge(statusView.label, statusView.className));
        top.appendChild(title);
        top.appendChild(badges);
        const grid = document.createElement("div");
        grid.className = "equipmentMetaGrid";
        grid.appendChild(makeEquipmentMeta("MAC", camera.mac_address));
        grid.appendChild(makeEquipmentMeta("S/N", camera.serial_number));
        grid.appendChild(makeEquipmentMeta("Model", camera.model));
        grid.appendChild(makeEquipmentMeta("Placering", camera.location_text));
        const actions = document.createElement("div");
        actions.className = "equipmentCardActions";
        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "btn btnCompact";
        editBtn.textContent = "Rediger";
        editBtn.addEventListener("click", () => openEquipmentCameraForm(camera));
        const checkBtn = document.createElement("button");
        checkBtn.type = "button";
        checkBtn.className = "btn btnCompact";
        checkBtn.textContent = "Kontroller";
        checkBtn.addEventListener("click", () => openEquipmentCheck(camera.camera_id || camera.mac_address || camera.serial_number || ""));
        actions.appendChild(editBtn);
        actions.appendChild(checkBtn);
        card.appendChild(top);
        card.appendChild(grid);
        if (camera.note) {
          const note = document.createElement("p");
          note.className = "equipmentNote";
          note.textContent = camera.note;
          card.appendChild(note);
        }
        card.appendChild(actions);
        equipmentList.appendChild(card);
      });
    }

    function fillEquipmentForm(camera) {
      if (equipmentCameraIdInput) equipmentCameraIdInput.value = camera?.camera_id || "";
      if (equipmentMacInput) equipmentMacInput.value = camera?.mac_address || "";
      if (equipmentSerialInput) equipmentSerialInput.value = camera?.serial_number || "";
      if (equipmentModelInput) equipmentModelInput.value = camera?.model || "";
      if (equipmentLocationInput) equipmentLocationInput.value = camera?.location_text || "";
      if (equipmentStatusSelect) equipmentStatusSelect.value = camera?.status || "registered";
      if (equipmentNoteInput) equipmentNoteInput.value = camera?.note || "";
      if (equipmentFormStatus) equipmentFormStatus.textContent = "";
    }

    function openEquipmentDrawer() {
      if (!equipmentDrawerShell) {
        return;
      }
      equipmentDrawerShell.classList.add("open");
      equipmentDrawerShell.setAttribute("aria-hidden", "false");
      document.body.classList.add("equipment-modal-open");
    }

    function closeEquipmentDrawer() {
      if (!equipmentDrawerShell) {
        return;
      }
      equipmentDrawerShell.classList.remove("open");
      equipmentDrawerShell.setAttribute("aria-hidden", "true");
      document.body.classList.remove("equipment-modal-open");
      equipmentState.activeCameraId = null;
      equipmentState.mode = null;
      equipmentState.checkCamera = null;
      if (equipmentFormStatus) equipmentFormStatus.textContent = "";
      if (equipmentCheckStatus) equipmentCheckStatus.textContent = "";
      if (equipmentCheckResult) equipmentCheckResult.innerHTML = "";
    }

    function setEquipmentMode(mode) {
      equipmentState.mode = mode;
      if (equipmentCameraForm) equipmentCameraForm.hidden = mode !== "form";
      if (equipmentCheckView) equipmentCheckView.hidden = mode !== "check";
    }

    function openEquipmentCameraForm(camera, prefill = {}) {
      setEquipmentMode("form");
      equipmentState.activeCameraId = camera?.id || null;
      fillEquipmentForm(camera || prefill);
      if (equipmentDrawerTitle) equipmentDrawerTitle.textContent = camera ? "Rediger kamera" : "Tilfoej kamera";
      if (equipmentDrawerMeta) equipmentDrawerMeta.textContent = "Projektudstyr Beta · CCTV";
      if (equipmentArchiveBtn) equipmentArchiveBtn.hidden = !camera;
      openEquipmentDrawer();
      if (equipmentCameraIdInput) equipmentCameraIdInput.focus();
    }

    function openEquipmentCheck(prefillValue) {
      setEquipmentMode("check");
      equipmentState.checkCamera = null;
      if (equipmentDrawerTitle) equipmentDrawerTitle.textContent = "Kontroller kamera";
      if (equipmentDrawerMeta) equipmentDrawerMeta.textContent = "Sog paa MAC, S/N eller Kamera-ID";
      if (equipmentCheckInput) equipmentCheckInput.value = prefillValue || "";
      if (equipmentCheckStatus) equipmentCheckStatus.textContent = "";
      if (equipmentCheckResult) equipmentCheckResult.innerHTML = "";
      openEquipmentDrawer();
      if (equipmentCheckInput) equipmentCheckInput.focus();
    }

    function getEquipmentFormPayload() {
      return {
        camera_id: equipmentCameraIdInput ? equipmentCameraIdInput.value.trim() : "",
        mac_address: equipmentMacInput ? equipmentMacInput.value.trim() || null : null,
        serial_number: equipmentSerialInput ? equipmentSerialInput.value.trim() || null : null,
        model: equipmentModelInput ? equipmentModelInput.value.trim() || null : null,
        location_text: equipmentLocationInput ? equipmentLocationInput.value.trim() || null : null,
        status: equipmentStatusSelect ? equipmentStatusSelect.value : "registered",
        note: equipmentNoteInput ? equipmentNoteInput.value.trim() || null : null,
      };
    }

    async function loadEquipmentCctv() {
      if (!equipmentUi) {
        return;
      }
      equipmentState.isLoading = true;
      renderEquipmentList();
      try {
        const query = equipmentState.search ? `?q=${encodeURIComponent(equipmentState.search)}` : "";
        const response = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/equipment/cctv${query}`, { method: "GET" });
        if (equipmentSection) equipmentSection.hidden = false;
        equipmentState.summary = response && response.summary ? response.summary : equipmentState.summary;
        equipmentState.cameras = response && Array.isArray(response.cameras) ? response.cameras : [];
        if (equipmentExportLink) {
          equipmentExportLink.href = `/api/projects/${encodeURIComponent(projectId)}/equipment/cctv/export.csv`;
        }
      } catch (error) {
        if (equipmentSection) equipmentSection.hidden = true;
        const message = equipmentErrorMessage(error, "Kunne ikke hente CCTV-udstyr.");
        if (!message) {
          return;
        }
        equipmentState.cameras = [];
        setEquipmentStateMessage(message, true);
      } finally {
        equipmentState.isLoading = false;
      }
      renderEquipmentList();
    }

    async function saveEquipmentCamera(event) {
      event.preventDefault();
      const payload = getEquipmentFormPayload();
      if (!payload.camera_id) {
        if (equipmentFormStatus) equipmentFormStatus.textContent = "Kamera-ID er paakraevet.";
        return;
      }
      if (equipmentSaveBtn) equipmentSaveBtn.disabled = true;
      if (equipmentFormStatus) equipmentFormStatus.textContent = "Gemmer...";
      try {
        const isEdit = Boolean(equipmentState.activeCameraId);
        await apiFetch(isEdit
          ? `/api/projects/${encodeURIComponent(projectId)}/equipment/cctv/${encodeURIComponent(equipmentState.activeCameraId)}`
          : `/api/projects/${encodeURIComponent(projectId)}/equipment/cctv`, {
          method: isEdit ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        });
        await loadEquipmentCctv();
        closeEquipmentDrawer();
      } catch (error) {
        const message = equipmentErrorMessage(error, "Kunne ikke gemme kamera.");
        if (equipmentFormStatus && message) equipmentFormStatus.textContent = message;
      } finally {
        if (equipmentSaveBtn) equipmentSaveBtn.disabled = false;
      }
    }

    async function archiveEquipmentCamera() {
      if (!equipmentState.activeCameraId) {
        return;
      }
      if (equipmentArchiveBtn) equipmentArchiveBtn.disabled = true;
      if (equipmentFormStatus) equipmentFormStatus.textContent = "Arkiverer...";
      try {
        await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/equipment/cctv/${encodeURIComponent(equipmentState.activeCameraId)}`, { method: "DELETE" });
        await loadEquipmentCctv();
        closeEquipmentDrawer();
      } catch (error) {
        const message = equipmentErrorMessage(error, "Kunne ikke arkivere kamera.");
        if (equipmentFormStatus && message) equipmentFormStatus.textContent = message;
      } finally {
        if (equipmentArchiveBtn) equipmentArchiveBtn.disabled = false;
      }
    }

    function renderEquipmentCheckResult(result, query) {
      if (!equipmentCheckResult) {
        return;
      }
      equipmentCheckResult.innerHTML = "";
      const card = document.createElement("div");
      card.className = result && result.found ? "equipmentResultCard" : "equipmentResultCard notFound";
      const title = document.createElement("h3");
      title.className = "equipmentTitle";
      title.textContent = result && result.found ? "Kamera fundet" : "Ikke fundet";
      card.appendChild(title);
      if (result && result.warning) {
        const warning = document.createElement("p");
        warning.className = "equipmentNote";
        warning.textContent = result.warning === "multiple_possible_matches" ? "Flere mulige matches. Brug en mere praecis vaerdi." : "Resultatet er et delvist match.";
        card.appendChild(warning);
      }
      if (result && result.found && result.camera) {
        const camera = result.camera;
        equipmentState.checkCamera = camera;
        const grid = document.createElement("div");
        grid.className = "equipmentMetaGrid";
        grid.appendChild(makeEquipmentMeta("Kamera-ID", camera.camera_id));
        grid.appendChild(makeEquipmentMeta("MAC", camera.mac_address));
        grid.appendChild(makeEquipmentMeta("S/N", camera.serial_number));
        grid.appendChild(makeEquipmentMeta("Model", camera.model));
        grid.appendChild(makeEquipmentMeta("Placering", camera.location_text));
        grid.appendChild(makeEquipmentMeta("Status", getEquipmentStatusView(camera.status).label));
        card.appendChild(grid);
        if (camera.note) {
          const note = document.createElement("p");
          note.className = "equipmentNote";
          note.textContent = camera.note;
          card.appendChild(note);
        }
        const actions = document.createElement("div");
        actions.className = "equipmentResultActions";
        const checkedBtn = document.createElement("button");
        checkedBtn.type = "button";
        checkedBtn.className = "btn btnPrimary btnCompact";
        checkedBtn.textContent = "Marker som kontrolleret";
        checkedBtn.addEventListener("click", () => markEquipmentChecked(camera));
        actions.appendChild(checkedBtn);
        card.appendChild(actions);
      } else {
        equipmentState.checkCamera = null;
        const text = document.createElement("p");
        text.className = "equipmentNote";
        text.textContent = "Opret kameraet, hvis vaerdien hoerer til dette projekt.";
        const createBtn = document.createElement("button");
        createBtn.type = "button";
        createBtn.className = "btn btnPrimary btnCompact";
        createBtn.textContent = "Opret nyt kamera";
        createBtn.addEventListener("click", () => openEquipmentCameraForm(null, guessEquipmentPrefill(query)));
        card.appendChild(text);
        card.appendChild(createBtn);
      }
      equipmentCheckResult.appendChild(card);
    }

    function guessEquipmentPrefill(query) {
      const value = String(query || "").trim();
      const compact = value.replace(/[^0-9a-fA-F]/g, "");
      if (/^[0-9a-fA-F]{12}$/.test(compact)) {
        return { camera_id: "", mac_address: value };
      }
      return { camera_id: value, mac_address: "" };
    }

    async function checkEquipmentCamera() {
      const query = equipmentCheckInput ? equipmentCheckInput.value.trim() : "";
      if (!query) {
        if (equipmentCheckStatus) equipmentCheckStatus.textContent = "Indtast MAC, S/N eller Kamera-ID.";
        return;
      }
      if (equipmentCheckSubmitBtn) equipmentCheckSubmitBtn.disabled = true;
      if (equipmentCheckStatus) equipmentCheckStatus.textContent = "Kontrollerer...";
      if (equipmentCheckResult) equipmentCheckResult.innerHTML = "";
      try {
        const result = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/equipment/cctv/check?q=${encodeURIComponent(query)}`, { method: "GET" });
        if (equipmentCheckStatus) equipmentCheckStatus.textContent = "";
        renderEquipmentCheckResult(result, query);
      } catch (error) {
        const message = equipmentErrorMessage(error, "Kunne ikke kontrollere kamera.");
        if (equipmentCheckStatus && message) equipmentCheckStatus.textContent = message;
      } finally {
        if (equipmentCheckSubmitBtn) equipmentCheckSubmitBtn.disabled = false;
      }
    }

    async function markEquipmentChecked(camera) {
      if (!camera || !camera.id) {
        return;
      }
      if (equipmentCheckStatus) equipmentCheckStatus.textContent = "Marker som kontrolleret...";
      try {
        await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/equipment/cctv/${encodeURIComponent(camera.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "checked" }),
        });
        await loadEquipmentCctv();
        await checkEquipmentCamera();
      } catch (error) {
        const message = equipmentErrorMessage(error, "Kunne ikke opdatere status.");
        if (equipmentCheckStatus && message) equipmentCheckStatus.textContent = message;
      }
    }

    async function exportEquipmentCsv(event) {
      event.preventDefault();
      if (!equipmentExportLink) {
        return;
      }
      equipmentExportLink.textContent = "Henter...";
      try {
        const token = getToken();
        const response = await window.fetch(`/api/projects/${encodeURIComponent(projectId)}/equipment/cctv/export.csv`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) {
          throw new Error(`csv_export_failed_${response.status}`);
        }
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "fielddesk-cctv.csv";
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
      } catch (error) {
        setEquipmentStateMessage("Kunne ikke hente CSV eksport.", true);
      } finally {
        equipmentExportLink.textContent = "CSV";
      }
    }
    if (qaUi) {
      renderQaSummary();
      renderQaThreadList();
    }

    if (qaNewThreadToggle) {
      qaNewThreadToggle.addEventListener("click", () => {
        openQaNewThreadModal(true);
      });
    }

    if (qaViewAllBtn) {
      qaViewAllBtn.addEventListener("click", () => {
        openQaAllThreadsModal();
      });
    }

    if (qaCancelNewThreadBtn) {
      qaCancelNewThreadBtn.addEventListener("click", () => {
        closeQaDrawer(false);
      });
    }

    if (qaNewThreadForm) {
      qaNewThreadForm.addEventListener("submit", createQaThread);
    }

    if (qaDrawerOverlay) {
      qaDrawerOverlay.addEventListener("click", () => closeQaDrawer(false));
    }

    if (qaDrawerCloseBtn) {
      qaDrawerCloseBtn.addEventListener("click", () => closeQaDrawer(false));
    }

    if (qaMessageForm) {
      qaMessageForm.addEventListener("submit", addQaMessage);
    }


    if (qaAllSearchInput) {
      qaAllSearchInput.addEventListener("input", () => {
        qaState.allSearch = qaAllSearchInput.value;
        renderQaAllThreads();
      });
    }

    if (qaAllSortSelect) {
      qaAllSortSelect.addEventListener("change", () => {
        qaState.allSort = qaAllSortSelect.value || "activity_desc";
        renderQaAllThreads();
      });
    }

    if (qaStayBtn) {
      qaStayBtn.addEventListener("click", hideQaUnsavedConfirm);
    }

    if (qaDiscardBtn) {
      qaDiscardBtn.addEventListener("click", () => closeQaDrawer(true));
    }


    if (equipmentUi) {
      renderEquipmentSummary();
      renderEquipmentList();
    }

    if (equipmentAddBtn) {
      equipmentAddBtn.addEventListener("click", () => openEquipmentCameraForm(null));
    }

    if (equipmentCheckBtn) {
      equipmentCheckBtn.addEventListener("click", () => openEquipmentCheck(""));
    }

    if (equipmentExportLink) {
      equipmentExportLink.addEventListener("click", exportEquipmentCsv);
    }

    if (equipmentSearchInput) {
      equipmentSearchInput.addEventListener("input", () => {
        equipmentState.search = equipmentSearchInput.value.trim();
        window.clearTimeout(equipmentState.searchTimer);
        equipmentState.searchTimer = window.setTimeout(loadEquipmentCctv, 220);
      });
    }

    if (equipmentCameraForm) {
      equipmentCameraForm.addEventListener("submit", saveEquipmentCamera);
    }

    if (equipmentArchiveBtn) {
      equipmentArchiveBtn.addEventListener("click", archiveEquipmentCamera);
    }

    if (equipmentCancelBtn) {
      equipmentCancelBtn.addEventListener("click", closeEquipmentDrawer);
    }

    if (equipmentDrawerOverlay) {
      equipmentDrawerOverlay.addEventListener("click", closeEquipmentDrawer);
    }

    if (equipmentDrawerCloseBtn) {
      equipmentDrawerCloseBtn.addEventListener("click", closeEquipmentDrawer);
    }

    if (equipmentCheckSubmitBtn) {
      equipmentCheckSubmitBtn.addEventListener("click", checkEquipmentCamera);
    }

    if (equipmentCheckInput) {
      equipmentCheckInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          checkEquipmentCamera();
        }
      });
    }
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && equipmentDrawerShell && equipmentDrawerShell.classList.contains("open")) {
        closeEquipmentDrawer();
        return;
      }
      if (event.key === "Escape" && qaDrawerShell && qaDrawerShell.classList.contains("open")) {
        if (qaUnsavedConfirm && !qaUnsavedConfirm.hidden) {
          hideQaUnsavedConfirm();
          return;
        }
        closeQaDrawer(false);
      }
    });

    try {
      const permissionsLoaded = await loadQaPermissions();
      if (!permissionsLoaded) {
        return;
      }

      const [projectResult, breakdownResult, equipmentResult] = await Promise.allSettled([
        apiFetch(`/api/projects/${encodeURIComponent(projectId)}`, { method: "GET" }),
        apiFetch(`/api/projects/${encodeURIComponent(projectId)}/fitterhours/breakdown`, { method: "GET" }),
        apiFetch(`/api/projects/${encodeURIComponent(projectId)}/equipment/cctv`, { method: "GET" }),
      ]);

      if (projectResult.status === "rejected") {
        throw projectResult.reason;
      }

      const rawProject = projectResult.value && projectResult.value.project ? projectResult.value.project : null;
      const vm = mapProjectToQuickViewModel(rawProject);
      if (!vm) {
        renderProjectDetailError("Projektdata mangler");
      } else {
        renderProjectDetail(vm, { currentUser: projectPageUser });
      }

      const breakdown = breakdownResult.status === "fulfilled" && breakdownResult.value
        ? breakdownResult.value.breakdown
        : null;
      renderFittersSectionFromBreakdown(breakdown);
      renderHoursSectionFromBreakdown(breakdown);
      if (equipmentResult && equipmentResult.status === "fulfilled" && equipmentResult.value) {
        if (equipmentSection) equipmentSection.hidden = false;
        equipmentState.summary = equipmentResult.value.summary || equipmentState.summary;
        equipmentState.cameras = Array.isArray(equipmentResult.value.cameras) ? equipmentResult.value.cameras : [];
        renderEquipmentList();
      } else {
        if (equipmentSection) equipmentSection.hidden = true;
        await loadEquipmentCctv();
      }
      await loadQaThreads();
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
