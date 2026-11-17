import { describe, expect, it } from "vitest";
import { isSoftwareRenderer } from "../render/softwareGl.js";

describe("telling a software renderer by its name", () => {
    it("knows the CPU renderers", () => {
        expect(isSoftwareRenderer("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)")).toBe(
            true,
        );
        expect(isSoftwareRenderer("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe(true);
        expect(isSoftwareRenderer("ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)")).toBe(true);
    });

    it("leaves a graphics card's alone", () => {
        expect(isSoftwareRenderer("ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe(false);
        expect(isSoftwareRenderer("Apple M2")).toBe(false);
        expect(isSoftwareRenderer("Mesa Intel(R) UHD Graphics 620 (KBL GT2)")).toBe(false);
    });
});
