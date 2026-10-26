import { styled } from "@linaria/react";
import { NavLink, Outlet } from "react-router";

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

/** What every route is shown inside: the way between them, and the route itself. */
export function Shell() {
    return (
        <Layout>
            <Header>
                <NavLink to="/" end>
                    Space Combat Simulation
                </NavLink>
                <nav aria-label="Main">
                    <NavLink to="/battle">Battle</NavLink> <NavLink to="/fleet">Fleet</NavLink> <NavLink to="/ship">Ship</NavLink>{" "}
                    <NavLink to="/library">Library</NavLink>
                </nav>
            </Header>
            <Outlet />
        </Layout>
    );
}
