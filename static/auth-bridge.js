import { handleAuthState, login, logout } from "/static/firebase-login.js";

function readCsrf() {
  const meta = document.querySelector('meta[name="csrf-token"]');
  return meta ? meta.getAttribute("content") || "" : "";
}

async function syncServerSession(idToken) {
  const body =
    idToken === null || idToken === undefined
      ? JSON.stringify({ id_token: null })
      : JSON.stringify({ id_token: idToken });

  const res = await fetch("/auth/firebase-session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-CSRF-Token": readCsrf(),
    },
    body,
    credentials: "same-origin",
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText || "Session sync failed");
    err.status = res.status;
    throw err;
  }
  return data;
}

handleAuthState(async (user) => {
  try {
    if (user) {
      const idToken = await user.getIdToken();
      try {
        const data = await syncServerSession(idToken);
        if (data.reload) {
          window.location.reload();
        }
      } catch (err) {
        if (err.status === 401) {
          await logout();
        } else {
          console.error(err);
        }
      }
    } else {
      const data = await syncServerSession(null);
      if (data.reload) {
        window.location.reload();
      }
    }
  } catch (err) {
    console.error(err);
  }
});

const loginBtn = document.getElementById("firebase-login-btn");
if (loginBtn) {
  loginBtn.addEventListener("click", async () => {
    try {
      await login();
    } catch (err) {
      alert(err.message || "Login failed");
    }
  });
}

const logoutBtn = document.getElementById("firebase-logout-btn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      await logout();
    } catch (err) {
      console.error(err);
    }
  });
}
