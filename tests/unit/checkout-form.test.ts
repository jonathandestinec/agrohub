import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import { CheckoutForm } from "@/components/orders/checkout-form";
import messages from "../../messages/en.json";

function render(props: { fixedQuantity?: number; withQuote?: boolean }) {
  return renderToStaticMarkup(
    // The provider type requires a children prop; the real child is the third argument.
    // eslint-disable-next-line react/no-children-prop
    createElement(
      NextIntlClientProvider,
      { locale: "en", messages, timeZone: "Africa/Lagos", children: null },
      createElement(CheckoutForm, {
        source: "LOT",
        lotId: "lot",
        unitKobo: 6_500_000,
        unit: "bag",
        minQuantity: 1,
        maxQuantity: 30,
        pickupLabel: "Pickup",
        quotes: props.withQuote ? [{ id: "q1", amountKobo: 2_500_000, until: "tomorrow" }] : [],
        fixedQuantity: props.fixedQuantity,
      }),
    ),
  );
}

// The server HTML is what a phone shows before React hydrates. A quantity typed then is reset
// to the default when React takes over, so the field and the pay button wait until it has.
describe("CheckoutForm before hydration", () => {
  it("disables the quantity input and the pay button", () => {
    const html = render({});
    const quantity = (html.match(/<input[^>]*>/g) ?? []).find((tag) => tag.includes('name="quantity"'));
    expect(quantity).toContain('disabled=""');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });

  it("disables the pay button when the quantity is fixed", () => {
    expect(render({ fixedQuantity: 5 })).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });

  it("disables the delivery choices too, so a pick made early is not lost", () => {
    const radios = render({ withQuote: true }).match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
    expect(radios).toHaveLength(2);
    for (const radio of radios) expect(radio).toContain('disabled=""');
  });
});
