import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { Dialog } from "./Dialog";

describe("Dialog focus restoration", () => {
  it("keeps an explicit success destination instead of restoring the opener", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      const destinationRef = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button onClick={() => setOpen(true)} type="button">
            Open
          </button>
          <button ref={destinationRef} type="button">
            Created file
          </button>
          <Dialog
            onClose={() => setOpen(false)}
            open={open}
            title="Create file"
          >
            <button
              onClick={() => {
                destinationRef.current?.focus();
                setOpen(false);
              }}
              type="button"
            >
              Finish
            </button>
          </Dialog>
        </>
      );
    }

    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(await screen.findByRole("button", { name: "Finish" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Created file" })).toHaveFocus(),
    );
    expect(opener).not.toHaveFocus();
  });
});
