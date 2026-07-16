import React from "react";
import { createRoot } from "react-dom/client";
import "../app/globals.css";
import "./pages.css";
import { StaticDemoApp } from "./static-app";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <StaticDemoApp />
  </React.StrictMode>,
);

