/*
 * Single source of truth for the shop's public details. Metadata, Open Graph
 * tags and the page copy all read from here so there is one place to edit.
 */

export const site = {
  name: "Henry Hai Studio",
  shortName: "Henry Hai Studio",
  description:
    "Personalized, luxury haircuts in Milpitas and Irvine, California. " +
    "Clipper and scissor cuts, beard work, line-ups and designs by appointment.",
  /* Overridden per deployment; the fallback keeps builds working locally. */
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://henryhaibarbershop.com",
  ogImage: "/img/barbershop-interior.jpg",
  instagram: "https://www.instagram.com/henryhai_",
  linkedin: "https://www.linkedin.com/in/henry-hai-nguyen",
  phone: "408-858-7047",
  foundedYear: 2013
} as const;

/* Milpitas first: that is where the practice started. */
export const locations = [
  {
    id: "milpitas",
    name: "Milpitas",
    address: "Kennedy Dr, Milpitas, CA 95035",
    phone: site.phone,
    image: "/img/adrian-01.jpg",
    note: "Where it started.",
    hours: ["Mon - Fri: TBD", "Sat: TBD", "Sun: TBD"]
  },
  {
    id: "irvine",
    name: "Irvine",
    address: "71000 Verano Rd, Irvine, CA 92617",
    phone: site.phone,
    image: "/img/jason-02.jpg",
    note: "",
    hours: ["Mon - Fri: TBD", "Sat: TBD", "Sun: TBD"]
  }
] as const;

/*
 * `detail` carries the rule that used to live in an asterisked footnote under
 * the price list. Attaching it to the row it governs means the menu states its
 * own terms instead of deferring to a paragraph nobody reads.
 */
export const services = [
  { name: "Haircut: Clipper Cut", price: "$35", detail: "Includes a line-up." },
  { name: "Haircut: Clipper + Scissor Cut", price: "$40", detail: "Includes a line-up." },
  { name: "Goatee & Mustache", price: "+$5", detail: "Add-on. Attaches to a haircut." },
  { name: "Goatee, Mustache, & Beard", price: "+$10", detail: "Add-on. Attaches to a haircut." },
  { name: "Eyebrows (Straight Razor)", price: "+$5", detail: "Add-on. Attaches to a haircut." },
  { name: "Design", price: "+$5-10", detail: "Add-on. Priced by complexity." },
  { name: "Lineup: Hairline + Nape", price: "$15", detail: "A la carte only." },
  { name: "Lineup: Full Service + Beard", price: "$20", detail: "A la carte only." },
  { name: "Braids", price: "$20", detail: "A la carte." },
  { name: "Threaded Eyebrows", price: "$15", detail: "A la carte." },
  { name: "Housecall", price: "$100", detail: "Plus add-on prices." }
] as const;

export const bookingPolicies = [
  "24-hour cancellation notice required.",
  "Late arrivals may need to reschedule.",
  "Being > 15 minutes late will result in a 15$ fee & the appointment may be cancelled.",
  "Being late by ≥ 15min, 3 times will result in a temporary 100-day suspension.",
  "Please wash hair thoroughly before for best results.",
  "Remove all upper cartilage earrings if applicable."
] as const;

/*
 * The hero triptych, in order across the banner.
 *
 * These are fixed compositions, not a photograph chosen elsewhere and reused.
 * Each carries its own crop: the centre frame sits left of centre on purpose,
 * because the HENRYHAI signature runs down the right edge of that photograph
 * and pulling the crop left walks it out of view. Nothing is retouched.
 */
export const heroPanels = [
  { src: "/img/cam-02.jpg", focus: "50% 28%" },
  { src: "/img/adrian-03.jpg", focus: "34% 26%" },
  { src: "/img/hoang-01.jpg", focus: "50% 30%" }
] as const;

/* A phone gets one frame. A tall viewport keeps far more of a 4:5 portrait
   than a wide one, so this crop is not the same as any desktop panel's. */
export const heroMobile = { src: "/img/adrian-03.jpg", focus: "50% 34%" } as const;

export const navLinks = [
  { href: "#about", label: "About" },
  { href: "#services", label: "Services" },
  { href: "#gallery", label: "Gallery" },
  { href: "#locations", label: "Locations" }
] as const;
