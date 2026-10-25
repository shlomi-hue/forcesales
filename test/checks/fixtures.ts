import type { SheetTab } from "../../src/checks/rate-card.js";

// Rate cards in different shapes, as Sheets returns them (formatted cell text).

export const simple: SheetTab[] = [
  {
    title: "Rate card",
    rows: [
      ["SKU", "Product", "List Price", "Floor Price", "Currency"],
      ["PRO-1", "Pro", "60", "50", "USD"],
      ["ENT-1", "Enterprise", "120", "100", "USD"],
      ["SETUP", "Onboarding", "$2,000", "$1,500", "USD"],
    ],
  },
];

export const monthlyAnnual: SheetTab[] = [
  {
    title: "Plans",
    rows: [
      ["Plan", "Monthly", "Annual"],
      ["Starter", "$30", "$300"],
      ["Growth", "$80", "$800"],
    ],
  },
];

export const tiered: SheetTab[] = [
  {
    title: "Seats",
    rows: [
      ["Acme pricing 2026"],
      [],
      ["Product", "Seats", "Price per seat (SGD)"],
      ["Platform", "1-10", "45"],
      ["", "11-50", "40"],
      ["", "51+", "35"],
    ],
  },
];

export const withDiscount: SheetTab[] = [
  {
    title: "List",
    rows: [
      ["Service", "Rate", "Max discount"],
      ["Audit", "10,000", "20%"],
    ],
  },
];

export const european: SheetTab[] = [
  {
    title: "EU",
    rows: [
      ["", "Preis", "Minimum"],
      ["Lizenz", "1.200,00 €", "1.000,00 €"],
    ],
  },
];

export const perCurrencyTabs: SheetTab[] = [
  { title: "USD", rows: [["Item", "Floor"], ["Pro", "US$50"]] },
  { title: "SGD", rows: [["Item", "Floor"], ["Pro", "S$65"]] },
];

export const oddHeaders: SheetTab[] = [
  {
    title: "Sheet1",
    rows: [
      ["Thing", "Ask", "Num"],
      ["Widget", "99", "70"],
    ],
  },
];

export const noPrices: SheetTab[] = [{ title: "Notes", rows: [["Just some notes"], ["nothing here"]] }];
