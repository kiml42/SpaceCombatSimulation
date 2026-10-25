import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "~/ui/tokens/tokens.css";
import { Home } from "./Home";

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <Home />
    </StrictMode>,
);
