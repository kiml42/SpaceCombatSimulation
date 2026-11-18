import { styled } from "@linaria/react";
import { useState } from "react";
import { RENDERER_CHOICES, rendererChoice, setRendererChoice, type RendererChoice } from "~/render/layerView";

const Field = styled.label`
    display: flex;
    gap: 0.5rem;
    align-items: center;
`;

/** Which renderer draws the battle and the editors, for every page. */
export function RendererField() {
    const [choice, setChoice] = useState<RendererChoice>(rendererChoice);
    return (
        <Field>
            Renderer
            <select
                id="renderer"
                value={choice}
                onChange={(event) => {
                    const next = event.target.value as RendererChoice;
                    setRendererChoice(next);
                    setChoice(next);
                }}
            >
                {RENDERER_CHOICES.map(({ value, label }) => (
                    <option key={value} value={value}>
                        {label}
                    </option>
                ))}
            </select>
        </Field>
    );
}
