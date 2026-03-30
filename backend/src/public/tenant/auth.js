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

      const email = document.getElementById("email").value;
      const password = document.getElementById("password").value;

      try {
        const data = await apiFetch("/v1/auth/login", {
          method: "POST",
          headers: {},
          body: JSON.stringify({ email, password }),
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
    const userBox = document.getElementById("userBox");
    if (!userBox) {
      return;
    }

    if (!requireToken()) {
      return;
    }

    try {
      const me = await apiFetch("/api/me", { method: "GET" });
      userBox.textContent = JSON.stringify(me, null, 2);
    } catch (error) {
      if (handleAuthFailure(error)) {
        return;
      }
      userBox.textContent = `Failed to load user: ${getErrorMessage(error, "request_failed")}`;
      return;
    }

    const loadProjectsBtn = document.getElementById("loadProjectsBtn");
    const logoutBtn = document.getElementById("logoutBtn");

    function renderProjects(projects) {
      const container = document.getElementById("projectsContainer");
      if (!container) {
        return;
      }

      container.innerHTML = "";

      if (!Array.isArray(projects) || projects.length === 0) {
        container.textContent = "No projects found";
        return;
      }

      projects.forEach((project) => {
        const row = document.createElement("div");
        row.className = "projectRow";

        const name = document.createElement("div");
        name.className = "projectName";
        name.textContent = project && project.name ? project.name : "(no name)";

        const ref = document.createElement("div");
        ref.textContent = `Ref: ${project && project.external_project_ref ? project.external_project_ref : "-"}`;

        const status = document.createElement("div");
        status.textContent = `Status: ${project && project.status ? project.status : "-"}`;

        const updatedAt = document.createElement("div");
        updatedAt.textContent = `Updated: ${project && project.updated_at ? project.updated_at : "-"}`;

        row.appendChild(name);
        row.appendChild(ref);
        row.appendChild(status);
        row.appendChild(updatedAt);
        container.appendChild(row);
      });
    }

    const projectsContainer = document.getElementById("projectsContainer");
    const loadProjects = async () => {
      if (projectsContainer) {
        projectsContainer.textContent = "Loading...";
      }
      try {
        const response = await apiFetch("/api/projects?scope=mine", { method: "GET" });
        const projects = response && Array.isArray(response.projects)
          ? response.projects
          : [];
        renderProjects(projects);
      } catch (error) {
        if (handleAuthFailure(error)) {
          return;
        }
        if (projectsContainer) {
          projectsContainer.textContent = `Failed to load projects: ${getErrorMessage(error, "request_failed")}`;
        }
      }
    };

    if (loadProjectsBtn && projectsContainer) {
      loadProjectsBtn.addEventListener("click", async () => {
        await loadProjects();
      });
    }

    if (projectsContainer) {
      await loadProjects();
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
})();
