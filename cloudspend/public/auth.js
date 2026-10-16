"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);
  const form = $("loginForm") || $("registerForm");
  if (!form) return;

  const isRegister = form.id === "registerForm";
  const submit = form.querySelector(".auth-submit");
  const idleLabel = submit.textContent;

  // ---- validation (mirrors server/validate.js) ----

  const checks = {
    email(value) {
      const v = value.trim();
      if (!v) return "Enter your email address.";
      if (v.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return "Enter a valid email address.";
      return "";
    },
    password(value) {
      if (!isRegister) return value ? "" : "Enter your password.";
      if (value.length < 8) return "Use at least 8 characters.";
      if (new TextEncoder().encode(value).length > 72) return "Use at most 72 characters.";
      if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return "Include at least one letter and one number.";
      return "";
    },
    confirm(value) {
      return value === $("password").value ? "" : "Passwords do not match.";
    }
  };

  const fields = ["email", "password", ...(isRegister ? ["confirm"] : [])];

  function showError(name, message) {
    const input = $(name);
    const out = $(`${name}Error`);
    out.textContent = message;
    input.classList.toggle("invalid", Boolean(message));
    input.setAttribute("aria-invalid", message ? "true" : "false");
    if (message) input.setAttribute("aria-describedby", `${name}Error`);
  }

  function validateField(name) {
    const message = checks[name]($(name).value);
    showError(name, message);
    return !message;
  }

  function setAlert(message) {
    const box = $("formAlert");
    box.textContent = message || "";
    box.hidden = !message;
  }

  fields.forEach((name) => {
    const input = $(name);
    input.addEventListener("blur", () => { if (input.value) validateField(name); });
    input.addEventListener("input", () => {
      if (input.classList.contains("invalid")) validateField(name);
      setAlert("");
    });
  });

  // ---- live password rules on the sign-up page ----

  if (isRegister) {
    const rules = {
      length: (v) => v.length >= 8,
      letter: (v) => /[A-Za-z]/.test(v),
      number: (v) => /\d/.test(v)
    };
    $("password").addEventListener("input", (event) => {
      document.querySelectorAll("#passwordRules [data-rule]").forEach((li) => {
        li.classList.toggle("met", rules[li.dataset.rule](event.target.value));
      });
    });
  }

  // ---- show / hide password ----

  document.querySelectorAll("[data-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = $(button.dataset.toggle);
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      button.textContent = show ? "Hide" : "Show";
      button.setAttribute("aria-pressed", String(show));
    });
  });

  // ---- submit ----

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setAlert("");

    const results = fields.map(validateField);
    if (results.includes(false)) {
      $(fields[results.indexOf(false)]).focus();
      return;
    }

    submit.disabled = true;
    submit.textContent = isRegister ? "Creating account..." : "Logging in...";

    try {
      const response = await fetch(`/api/auth/${isRegister ? "register" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "cloudspend" },
        body: JSON.stringify({ email: $("email").value.trim(), password: $("password").value })
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        window.location.assign("/");
        return;
      }

      if (data.field && fields.includes(data.field)) {
        showError(data.field, data.error);
        $(data.field).focus();
      } else {
        setAlert(data.error || "Something went wrong. Please try again.");
      }
    } catch {
      setAlert("Could not reach the server. Check your connection and try again.");
    }

    submit.disabled = false;
    submit.textContent = idleLabel;
  });
});
