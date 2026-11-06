import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApplicationTracker } from "./application-tracker";
const { apiFetch, downloadAuthedFile } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  downloadAuthedFile: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ apiFetch, downloadAuthedFile }));
const data = {
  columns: [{ id: "c_contact", name: "Əlaqə" }],
  rows: [
    {
      key: "email:a1",
      title: "Analyst",
      company: "Acme",
      date: "2026-10-15",
      url: "",
      notes: "",
      custom: {},
      stage: "APPLIED",
      evidence: "DELIVERED",
      source: "email",
      hidden: false,
    },
  ],
  page: 1,
  pages: 1,
  total: 1,
};
beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation(
    async (_url, options) =>
      new Response(JSON.stringify(options?.method ? { saved: true } : data)),
  );
});
describe("free application tracker", () => {
  it("shows delivery evidence separately and saves a personal stage without altering evidence", async () => {
    render(<ApplicationTracker />);
    expect(await screen.findByText("Çatdırılıb")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Analyst mərhələm"), {
      target: { value: "INTERVIEW" },
    });
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/application-tracker/email%3Aa1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ stage: "INTERVIEW" }),
        }),
      ),
    );
    expect(screen.getByText("Çatdırılıb")).toBeInTheDocument();
  });
  it("saves a custom cell and exports an authenticated CSV", async () => {
    render(<ApplicationTracker />);
    const input = await screen.findByLabelText("Analyst: Əlaqə");
    fireEvent.blur(input, { target: { value: "Leyla" } });
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/application-tracker/email%3Aa1",
        expect.objectContaining({
          body: JSON.stringify({ custom: { c_contact: "Leyla" } }),
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByText("Saxlanıldı.")).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Excel üçün CSV yüklə" }),
    );
    expect(downloadAuthedFile).toHaveBeenCalledWith(
      "/application-tracker/export.csv",
      "aise-muracietler.csv",
    );
  });
  it("announces a failed save rather than claiming success", async () => {
    apiFetch.mockImplementation(
      async (_url, options) =>
        new Response(JSON.stringify(options?.method ? {} : data), {
          status: options?.method ? 500 : 200,
        }),
    );
    render(<ApplicationTracker />);
    fireEvent.blur(await screen.findByLabelText("Müraciət edilib: notes"), {
      target: { value: "Not saved" },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("saxlanılmadı");
  });
  it("retries a failed edit without losing its value or reloading the table", async () => {
    let failing = true;
    apiFetch.mockImplementation(
      async (_url, options) =>
        new Response(JSON.stringify(options?.method ? {} : data), {
          status: options?.method && failing ? 500 : 200,
        }),
    );
    render(<ApplicationTracker />);
    fireEvent.blur(await screen.findByLabelText("Müraciət edilib: notes"), {
      target: { value: "Keep this note" },
    });
    await screen.findByRole("alert");
    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "Yenidən saxla" }));
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(apiFetch).toHaveBeenLastCalledWith(
      "/application-tracker/email%3Aa1",
      expect.objectContaining({
        body: JSON.stringify({ notes: "Keep this note" }),
      }),
    );
  });
  it("allows candidate to directly record personal stage as HIRED or OFFER without artificial sequence gating", async () => {
    const plannedData = {
      ...data,
      rows: [{ ...data.rows[0], stage: "PLANNED" }],
    };
    apiFetch.mockImplementation(
      async () => new Response(JSON.stringify(plannedData)),
    );
    render(<ApplicationTracker />);
    const stageSelect = (await screen.findByLabelText("Analyst mərhələm")) as HTMLSelectElement;
    const hiredOption = stageSelect.querySelector('option[value="HIRED"]') as HTMLOptionElement;
    expect(hiredOption.disabled).toBe(false);

    fireEvent.change(stageSelect, { target: { value: "HIRED" } });
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/application-tracker/email%3Aa1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ stage: "HIRED" }),
        }),
      ),
    );
  });
  it("submits the Add Application form and refreshes the tracker", async () => {
    render(<ApplicationTracker />);
    await screen.findByDisplayValue("Analyst");
    fireEvent.click(screen.getByRole("button", { name: /Müraciət əlavə et/ }));

    fireEvent.change(screen.getByLabelText("Yeni vəzifə"), {
      target: { value: "Audit Specialist" },
    });
    fireEvent.change(screen.getByLabelText("Yeni şirkət"), {
      target: { value: "Deloitte" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Əlavə et" }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/application-tracker",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            title: "Audit Specialist",
            company: "Deloitte",
            stage: "APPLIED",
          }),
        }),
      ),
    );
  });

  it("filters via backend when switching quickFilter tabs and resets page to 1", async () => {
    render(<ApplicationTracker />);
    await screen.findByDisplayValue("Analyst");

    // Click "Aktivlər" tab
    fireEvent.click(screen.getByRole("button", { name: "Aktivlər" }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/application-tracker\?.*group=active.*page=1/),
        expect.anything(),
      ),
    );

    // Click "Nəticələnmiş" tab
    fireEvent.click(screen.getByRole("button", { name: "Nəticələnmiş" }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/application-tracker\?.*group=closed.*page=1/),
        expect.anything(),
      ),
    );

    // Click "Bütün müraciətlər" tab
    fireEvent.click(screen.getByRole("button", { name: "Bütün müraciətlər" }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/application-tracker\?.*page=1/),
        expect.anything(),
      ),
    );
  });

  it("handles multi-page (>50) datasets, surfacing matching records outside initial page and updating filtered totals", async () => {
    const closedRows = Array.from({ length: 50 }, (_, i) => ({
      key: `email:c_${i}`,
      title: `Closed Analyst ${i}`,
      company: `Closed Corp ${i}`,
      date: "2026-10-10",
      url: "",
      notes: "",
      custom: {},
      stage: "REJECTED",
      evidence: "REJECTED",
      source: "email",
      hidden: false,
    }));
    const activeRows = Array.from({ length: 10 }, (_, i) => ({
      key: `email:a_${i}`,
      title: `Active Developer ${i}`,
      company: `Active Corp ${i}`,
      date: "2026-10-18",
      url: "",
      notes: "",
      custom: {},
      stage: "APPLIED",
      evidence: "DELIVERED",
      source: "email",
      hidden: false,
    }));

    apiFetch.mockImplementation(async (url: string) => {
      if (url.includes("group=active")) {
        return new Response(
          JSON.stringify({
            columns: [{ id: "c_contact", name: "Əlaqə" }],
            rows: activeRows,
            page: 1,
            pages: 1,
            total: 10,
          }),
        );
      }
      return new Response(
        JSON.stringify({
          columns: [{ id: "c_contact", name: "Əlaqə" }],
          rows: closedRows,
          page: 1,
          pages: 2,
          total: 60,
        }),
      );
    });

    render(<ApplicationTracker />);
    // Initially on page 1 of unfiltered tracker: shows 60 total, page 1/2
    expect(await screen.findByText("Cəmi 60 müraciət")).toBeInTheDocument();
    expect(screen.getAllByText("Səhifə 1 / 2")[0]).toBeInTheDocument();
    expect(screen.getByDisplayValue("Closed Analyst 0")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Active Developer 0")).not.toBeInTheDocument();

    // Click "Aktivlər" tab: should request group=active, show active developer and update total to 10
    fireEvent.click(screen.getByRole("button", { name: "Aktivlər" }));
    expect(await screen.findByDisplayValue("Active Developer 0")).toBeInTheDocument();
    expect(screen.getByText("Cəmi 10 müraciət")).toBeInTheDocument();
    expect(screen.getAllByText("Səhifə 1 / 1")[0]).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Closed Analyst 0")).not.toBeInTheDocument();
  });

  it("resolves conflicts between quickFilter tabs and stage dropdown", async () => {
    render(<ApplicationTracker />);
    await screen.findByDisplayValue("Analyst");

    // 1. Select a closed stage (REJECTED) from stage dropdown: auto-switches quickFilter to 'closed'
    const filterSelect = screen.getByLabelText("Mərhələyə görə süzgəc");
    fireEvent.change(filterSelect, { target: { value: "REJECTED" } });
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/application-tracker\?.*stage=REJECTED.*group=closed/),
        expect.anything(),
      ),
    );

    // 2. Now user clicks "Aktivlər" tab: resolves conflict by clearing stage to ""
    fireEvent.click(screen.getByRole("button", { name: "Aktivlər" }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/application-tracker\?.*stage=&group=active.*page=1/),
        expect.anything(),
      ),
    );

    // 3. User selects active stage (INTERVIEW) while on "Aktivlər" tab: keeps quickFilter as 'active'
    fireEvent.change(filterSelect, { target: { value: "INTERVIEW" } });
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/application-tracker\?.*stage=INTERVIEW.*group=active/),
        expect.anything(),
      ),
    );
  });
});
