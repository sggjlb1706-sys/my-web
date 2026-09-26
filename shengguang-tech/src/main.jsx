import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { SaintLightChat } from "./SaintLightChat.jsx";
import "./styles.css";
import "./forum.css";

const CurrentApp = window.location.pathname.replace(/\/$/, "") === "/forum"
  ? React.lazy(() => import("./ForumApp.jsx").then(({ ForumApp }) => ({ default: ForumApp })))
  : App;

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <React.Suspense fallback={<main className="forum-page"><div className="forum-empty">正在打开论坛...</div></main>}>
      <CurrentApp />
      <SaintLightChat />
    </React.Suspense>
  </React.StrictMode>,
);
