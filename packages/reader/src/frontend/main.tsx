import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { StorageNotice } from "./storage-notice";
import "./styles.css";
import "./app-theme.css";
import "./chinese-reader.css";
import "./book-table.css";
import "./book-visual.css";
import "./book-detail-content.css";
import "./global-navigation.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <StorageNotice />
  </StrictMode>,
);
