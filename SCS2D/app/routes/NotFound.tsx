import { styled } from "@linaria/react";
import { Link } from "react-router";

const Main = styled.main`
    padding: 1.5rem;
`;

export function NotFound() {
    return (
        <Main>
            <p>There is no page here.</p>
            <Link to="/">Back to the start</Link>
        </Main>
    );
}
