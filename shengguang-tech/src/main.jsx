import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { ForumApp } from "./ForumApp.jsx";
import "./styles.css";
import "./forum.css";

const CurrentApp = window.location.pathname.replace(/\/$/, "") === "/forum" ? ForumApp : App;

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <CurrentApp />
  </React.StrictMode>,
);
