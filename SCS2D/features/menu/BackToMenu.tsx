import { useNavigate } from "react-router";
import { Button } from "~/ui/buttons/Button";

/** The menu button of a page with nothing to pause or offer: straight back to the main menu. */
export function BackToMenu() {
    const navigate = useNavigate();
    return (
        <Button id="menuButton" aria-label="Menu" title="Back to the main menu" onClick={() => void navigate("/")}>
            ◀ Menu
        </Button>
    );
}
