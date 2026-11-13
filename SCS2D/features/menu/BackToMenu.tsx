import { useNavigate } from "react-router";
import { HelpButton, type PageHelp } from "~/features/help/Help";
import { Button } from "~/ui/buttons/Button";

/** The menu button of a page with nothing to pause or offer: straight back to the main menu, and the page's help beside it. */
export function BackToMenu({ help }: { readonly help?: PageHelp }) {
    const navigate = useNavigate();
    return (
        <>
            <Button id="menuButton" aria-label="Menu" title="Back to the main menu" onClick={() => void navigate("/")}>
                ◀ Menu
            </Button>
            {help !== undefined && <HelpButton help={help} />}
        </>
    );
}
