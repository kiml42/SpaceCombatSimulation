import { styled } from "@linaria/react";
import { Outlet } from "react-router";

const Layout = styled.div`
    display: flex;
    flex-direction: column;
    height: 100%;

    > main {
        flex: 1;
        min-height: 0;
    }
`;

/** What every route is shown inside; each finds its way back through its own menu. */
export function Shell() {
    return (
        <Layout>
            <Outlet />
        </Layout>
    );
}
