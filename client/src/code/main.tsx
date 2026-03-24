import React from "react";
import ReactDOM from "react-dom/client";
import "normalize.css";
import "../css/main.css";
import BaseLayout from "./components/BaseLayout";

/* normalize.css is imported first so its browser resets apply before main.css styles.
   ReactDOM.createRoot is the React 18 replacement for the textbook's ReactDOM.render().
   The startup data fetching (mailboxes and contacts) is handled inside BaseLayout.componentDidMount()
   rather than here, because React 18's createRoot().render() is asynchronous.
   The component must be fully mounted before its state methods can be called. */
const root = ReactDOM.createRoot(document.body as HTMLElement);
root.render(<BaseLayout />);
