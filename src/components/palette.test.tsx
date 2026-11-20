import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import type { PaletteColor } from "@/domain/palette";

import { ColorPicker } from "./palette";

function Picker() {
  const [color, setColor] = useState<PaletteColor>("blue");
  return <ColorPicker value={color} onChange={setColor} />;
}

describe("ColorPicker", () => {
  it("CA4: só a cor marcada recebe o Tab, e as setas, Home e End marcam e focam outra", () => {
    render(<Picker />);
    const radios = screen.getAllByRole("radio");
    const blue = screen.getByRole("radio", { name: "Azul" });
    expect(radios.filter((r) => r.tabIndex === 0)).toEqual([blue]);

    blue.focus();
    fireEvent.keyDown(blue, { key: "ArrowRight" });
    const violet = screen.getByRole("radio", { name: "Violeta" });
    expect(violet).toHaveProperty("ariaChecked", "true");
    expect(document.activeElement).toBe(violet);
    expect(violet.tabIndex).toBe(0);
    expect(blue.tabIndex).toBe(-1);

    fireEvent.keyDown(violet, { key: "ArrowUp" });
    expect(document.activeElement).toBe(blue);

    fireEvent.keyDown(blue, { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Cinza" }));
    // Wraps around from the last to the first.
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Vermelho" }));
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toHaveProperty("ariaChecked", "true");

    // From the focused option, even unchecked (a screen reader can focus one).
    const teal = screen.getByRole("radio", { name: "Verde-azulado" });
    teal.focus();
    fireEvent.keyDown(teal, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "Céu" })).toHaveProperty("ariaChecked", "true");
  });
});
