import { sb } from "./supabaseClient.js";
import { homeForRole } from "./utils.js";

const tabSignin = document.getElementById("tab-signin");
const tabSignup = document.getElementById("tab-signup");
const formSignin = document.getElementById("form-signin");
const formSignup = document.getElementById("form-signup");
const alertBox = document.getElementById("auth-alert");

function showAlert(msg, kind = "bad") {
  alertBox.textContent = msg;
  alertBox.className = `alert show alert-${kind}`;
}
function hideAlert() { alertBox.className = "alert"; }

function switchTab(which) {
  hideAlert();
  const signin = which === "signin";
  tabSignin.classList.toggle("active", signin);
  tabSignup.classList.toggle("active", !signin);
  formSignin.style.display = signin ? "block" : "none";
  formSignup.style.display = signin ? "none" : "block";
}
tabSignin.addEventListener("click", () => switchTab("signin"));
tabSignup.addEventListener("click", () => switchTab("signup"));

// If already logged in, bounce straight to the right dashboard.
(async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    const { data: profile } = await sb.from("employees").select("role").eq("id", session.user.id).maybeSingle();
    window.location.href = homeForRole(profile?.role || "employee");
  }
})();

formSignin.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideAlert();
  const btn = formSignin.querySelector("button[type=submit]");
  btn.disabled = true; btn.textContent = "Signing in…";
  const email = document.getElementById("si-email").value.trim();
  const password = document.getElementById("si-password").value;

  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    showAlert(error.message);
    btn.disabled = false; btn.textContent = "Sign in";
    return;
  }
  const { data: profile } = await sb.from("employees").select("role").eq("id", data.user.id).maybeSingle();
  window.location.href = homeForRole(profile?.role || "employee");
});

formSignup.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideAlert();
  const btn = formSignup.querySelector("button[type=submit]");
  btn.disabled = true; btn.textContent = "Creating account…";

  const full_name = document.getElementById("su-name").value.trim();
  const employee_no = document.getElementById("su-empno").value.trim();
  const email = document.getElementById("su-email").value.trim();
  const password = document.getElementById("su-password").value;

  // full_name / employee_no travel as auth user metadata. A database trigger
  // (see sql/schema.sql: handle_new_user) creates the matching `employees`
  // profile row server-side — this works whether or not "Confirm email" is
  // enabled, avoiding an RLS failure from inserting before a session exists.
  const { data, error } = await sb.auth.signUp({
    email, password,
    options: { data: { full_name, employee_no } },
  });

  if (error) {
    showAlert(error.message);
    btn.disabled = false; btn.textContent = "Create account";
    return;
  }

  if (data.session) {
    window.location.href = "employee.html";
  } else {
    showAlert("Account created. Check your email to confirm, then sign in.", "ok");
    switchTab("signin");
  }
  btn.disabled = false; btn.textContent = "Create account";
});
