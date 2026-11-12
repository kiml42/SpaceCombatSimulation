import { styled } from "@linaria/react";
import { NavLink, Outlet, useMatch } from "react-router";

const Layout = styled.div`
    display: flex;
    flex-direction: column;
    height: 100%;

    > main {
        flex: 1;
        min-height: 0;
    }
`;

const Header = styled.header`
    display: flex;
    gap: 1.2rem;
    align-items: baseline;
    padding: 0.6rem 1.5rem;
    border-bottom: 1px solid var(--colour-border);

    a {
        color: var(--colour-muted);
        text-decoration: none;
    }

    > a {
        font-weight: 600;
    }

    > a,
    nav a.active {
        color: var(--colour-heading);
    }
`;

/** What every route is shown inside: a bar of the way between them (but over the menu, which is that already), and the route itself. */
export function Shell() {
    const onMenu = useMatch({ path: "/", end: true }) !== null;
    return (
        <Layout>
            {!onMenu && (
                <Header>
                    <NavLink to="/" end>
                        Space Combat Simulation
                    </NavLink>
                    <nav aria-label="Main">
                        <NavLink to="/battle">Battle</NavLink> <NavLink to="/fleet">Fleet</NavLink> <NavLink to="/ship">Ship</NavLink>{" "}
                        <NavLink to="/skirmish">Skirmish</NavLink> <NavLink to="/evolution">Evolution</NavLink>{" "}
                        <NavLink to="/library">Library</NavLink> <NavLink to="/effects">Effects</NavLink>
                    </nav>
                </Header>
            )}
            <Outlet />
        </Layout>
    );
}
