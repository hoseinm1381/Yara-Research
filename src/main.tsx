import { StrictMode, Component } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Root } from "./App";
import { ConfirmationHost } from "./services/confirmation";
import "@xyflow/react/dist/style.css";
import "./styles.css";
class Boundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <div className="boot">
        <h1>Yara could not render this view.</h1>
        <p>{this.state.error}</p>
        <p>Your saved research is preserved.</p>
        <button onClick={() => window.location.reload()}>
          Reload workspace
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Boundary>
      <Root />
      <ConfirmationHost />
    </Boundary>
  </StrictMode>,
);
