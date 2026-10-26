import { styled } from "@linaria/react";

/** A setting: its name, then its box or boxes. */
export const Field = styled.div`
    display: flex;
    gap: 0.4rem;
    align-items: center;
    margin-bottom: 0.3rem;

    > label {
        flex: 0 0 6.5rem;
        color: var(--colour-muted);
    }

    > input,
    > select,
    > textarea {
        flex: 1;
        min-width: 0;
    }

    > input[type="checkbox"] {
        flex: 0 0 auto;
    }
`;

/** A panel's actions, sharing its width. */
export const Buttons = styled.div`
    display: flex;
    gap: 0.4rem;
    margin-top: 0.6rem;

    > button {
        flex: 1;
        padding-inline: 0.3rem;
    }
`;
