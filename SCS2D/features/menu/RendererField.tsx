import { styled } from "@linaria/react";
import { useState } from "react";
import { isSolid, RENDERER_CHOICES, rendererChoice, setRendererChoice, type RendererChoice } from "~/render/layerView";
import { MOST_TILT, setViewAngle, viewAngle, type ViewAngle } from "~/render/three/viewAngle";

const Fields = styled.div`
    display: grid;
    gap: 0.4rem;

    label {
        display: flex;
        gap: 0.5rem;
        align-items: center;
    }

    input[type="range"] {
        flex: 1;
    }
`;

/** Which renderer draws the battle and the editors, for every page, and in 3D the angle the battle is seen from. */
export function RendererField() {
    const [choice, setChoice] = useState<RendererChoice>(rendererChoice);
    const [angle, setAngle] = useState<ViewAngle>(viewAngle);
    const change = (next: Partial<ViewAngle>): void => {
        setViewAngle(next);
        setAngle(viewAngle());
    };
    return (
        <Fields>
            <label>
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
            </label>
            {isSolid(choice) && (
                <>
                    <label>
                        Tilt {Math.round(angle.tilt)}°
                        <input
                            id="viewTilt"
                            type="range"
                            min={0}
                            max={MOST_TILT}
                            value={angle.tilt}
                            onChange={(event) => change({ tilt: Number(event.target.value) })}
                        />
                    </label>
                    <label>
                        Turn {Math.round(angle.turn)}°
                        <input
                            id="viewTurn"
                            type="range"
                            min={0}
                            max={359}
                            value={angle.turn}
                            onChange={(event) => change({ turn: Number(event.target.value) })}
                        />
                    </label>
                    <label>
                        Lens {Math.round(angle.fov)}°
                        <input
                            id="viewFov"
                            type="range"
                            min={5}
                            max={100}
                            value={angle.fov}
                            onChange={(event) => change({ fov: Number(event.target.value) })}
                        />
                    </label>
                    <label>
                        <input
                            id="viewOrbit"
                            type="checkbox"
                            checked={angle.orbit}
                            onChange={(event) => change({ orbit: event.target.checked })}
                        />
                        Swing the camera round (clicks no longer line up)
                    </label>
                </>
            )}
        </Fields>
    );
}
