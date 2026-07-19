import React from "react";
import ReactDOM from "react-dom/client";
import AuthGate from "./auth/AuthGate.jsx";
import PuroductiveApp from "./App.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthGate>{(session) => <PuroductiveApp session={session} />}</AuthGate>
  </React.StrictMode>
);
