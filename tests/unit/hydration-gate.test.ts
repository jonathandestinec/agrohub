import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";

// The forms call useRouter; the server render here has no app router mounted.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }) }));

const { HydrationGate } = await import("@/components/hydration-gate");
const { QuoteForm } = await import("@/components/orders/quote-form");
const { DecisionForm } = await import("@/components/orders/decision-form");
const { OrderFieldForm } = await import("@/components/orders/order-actions");
const { ReplyForm } = await import("@/components/messages/reply-form");
const { ReviseForm } = await import("@/app/farmer/lots/[id]/revise-form");
const { LotForm } = await import("@/app/farmer/lots/new/lot-form");
const { OfferForm } = await import("@/app/lots/[id]/offer-form");
const { PriceForm } = await import("@/app/board/price-form");
const { CatalogPanel } = await import("@/app/board/crops/catalog-panel");
const { EarningsCalculator } = await import("@/components/landing/earnings-calculator");

function render(element: ReactElement): string {
  return renderToStaticMarkup(
    // The provider type requires a children prop; the real child is the third argument.
    // eslint-disable-next-line react/no-children-prop
    createElement(NextIntlClientProvider, { locale: "en", messages, timeZone: "Africa/Lagos", children: null }, element),
  );
}

const ok = async () => ({ ok: true as const, data: null });
const terms = { cooperativeCutBps: 500, platformFeeBps: 300 };
const lot = {
  id: "lot",
  status: "LIVE",
  crop: { id: "c", name: "Maize" },
  unit: { id: "u", name: "Bag" },
  quantity: 10,
  grade: "A",
  pickupState: "Kano",
  pickupLga: "Nassarawa",
  pickupNote: null,
  askKobo: 6_500_000,
  floorKobo: 6_000_000,
  note: null,
  deviation: null,
  quoted: terms,
  lockedTerms: terms,
  minOrderQty: 1,
  availableUntil: "2026-12-01",
  counterAskKobo: null,
  counterMessage: null,
  rejectionReason: null,
  photoUrls: [],
  createdAt: "2026-11-01",
  approvedAt: "2026-11-02",
  pendingRevision: null,
} as const;

// The server HTML is what a phone shows before React hydrates. These forms keep their values
// in React state, so anything typed then is reset when React takes over, and a press submits
// the page natively. Each form's controls sit in a disabled fieldset until React is running.
const FORMS: [string, ReactElement][] = [
  ["delivery quote", createElement(QuoteForm, { threadId: "t" })],
  ["dispute decision", createElement(DecisionForm, { orderId: "o", disputeId: "d", outcomes: ["RELEASE", "REFUND_UNITS"], action: ok })],
  ["order field", createElement(OrderFieldForm, { action: ok, label: "Note", submit: "Save", kind: "text", name: "note" })],
  ["message reply", createElement(ReplyForm, { threadId: "t" })],
  ["lot revision", createElement(ReviseForm, { lot: lot as never, boardPrices: [], priceDeviationBps: 2000 })],
  [
    "new lot",
    createElement(LotForm, {
      context: {
        blockedBy: null,
        quotedCutBps: 500,
        platformFeeBps: 300,
        priceDeviationBps: 2000,
        crops: [{ id: "c", name: "Maize" }],
        units: [{ id: "u", name: "Bag" }],
        boardPrices: {},
        pickupState: "Kano",
        pickupLga: "Nassarawa",
        today: "2026-11-20",
      },
      states: ["Kano"],
    }),
  ],
  ["offer", createElement(OfferForm, { lotId: "lot", askKobo: 6_500_000, minOrderQty: 1, quantity: 10, unit: "bag" })],
  [
    "board price",
    createElement(PriceForm, {
      crops: [{ id: "c", name: "Maize", active: true }],
      units: [{ id: "u", name: "Bag", active: true }],
      markets: ["Dawanau"],
      weekOf: "2026-11-16",
    }),
  ],
  ["catalog add", createElement(CatalogPanel, { kind: "crop", items: [{ id: "c", name: "Maize", active: true }] })],
  ["earnings calculator", createElement(EarningsCalculator)],
];

describe("forms before hydration", () => {
  it.each(FORMS)("%s form holds every control in a disabled fieldset", (_, element) => {
    const html = render(element);
    const forms = html.match(/<form[^>]*>/g) ?? [];
    expect(forms.length).toBeGreaterThan(0);
    // Each form's first child is the gate, so nothing in it can be typed into or pressed.
    expect(html.match(/<form[^>]*><fieldset[^>]*disabled=""/g)).toHaveLength(forms.length);
  });
});

describe("HydrationGate", () => {
  it("renders a disabled, busy fieldset on the server", () => {
    const html = renderToStaticMarkup(createElement(HydrationGate, null, createElement("input", { name: "x" })));
    expect(html).toMatch(/^<fieldset[^>]*disabled=""/);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('<input name="x"/>');
  });
});
