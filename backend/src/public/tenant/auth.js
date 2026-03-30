(function () {
  const STORAGE_KEY = "fielddesk_access_token";

  function getToken() {
    return window.localStorage.getItem(STORAGE_KEY);
  }

  function setToken(token) {
    window.localStorage.setItem(STORAGE_KEY, token);
  }

  function clearToken() {
    window.localStorage.removeItem(STORAGE_KEY);
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
      const message = payload && payload.error && payload.error.message
        ? payload.error.message
        : `request_failed_${response.status}`;
      throw new Error(message);
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
        showError(error.message);
      }
    });
  }

  async function initAppPage() {
    const userBox = document.getElementById("userBox");
    if (!userBox) {
      return;
    }

    const token = getToken();
    if (!token) {
      window.location.href = "/login";
      return;
    }

    try {
      const me = await apiFetch("/api/me", { method: "GET" });
      userBox.textContent = JSON.stringify(me, null, 2);
    } catch (error) {
      clearToken();
      window.location.href = "/login";
      return;
    }

    const loadProjectsBtn = document.getElementById("loadProjectsBtn");
    const projectsBox = document.getElementById("projectsBox");
    const logoutBtn = document.getElementById("logoutBtn");

    if (loadProjectsBtn && projectsBox) {
      loadProjectsBtn.addEventListener("click", async () => {
        projectsBox.textContent = "Loading...";
        try {
          const projects = await apiFetch("/api/projects?scope=mine", { method: "GET" });
          projectsBox.textContent = JSON.stringify(projects, null, 2);
        } catch (error) {
          projectsBox.textContent = error.message;
        }
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener("click", function () {
        clearToken();
        window.location.href = "/login";
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
