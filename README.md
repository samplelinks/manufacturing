# sparkling.co.in — Kalis Sparkling Water Pvt Ltd

The website of Kalis Sparkling Water Pvt Ltd, the manufacturing and trading unit for
Kalimark: products, trade enquiries and careers.

## Pages

| Page | What it is |
|---|---|
| `index.html` | Home: what we make, featured products, the plant, careers and trade CTAs |
| `products.html` | Full product catalogue with category filters and a detail pop-up |
| `career-portal/` | Careers portal and HR/Admin dashboard — see `career-portal/README.md` |
| `contact.html` | Trade, distributor and bulk-order enquiries |
| `careers.html`, `admin.html` | Redirects to the career portal (kept for old links) |

Every page shares one design. `css/styles.css` is the base stylesheet and
`css/pages.css` adds the header, hero, footer and the Home/Products/Contact
layouts (the career portal loads both from `../css/`). Home, Products and Contact use
`js/sparkling.js` (search, range filters, product pop-up, contact form); the
careers portal has its own scripts in `career-portal/js/`.
`css/site.css`, `js/site.js`, and the old root copies of `Code.gs`, `js/config.js`,
`js/api.js`, `js/main.js` and `js/admin.js` are no longer used and can be deleted.
Product photos are in `images/products/`.
Statutory PDFs go in `docs/` (see `docs/README.txt`).

To edit a product, change its card in `products.html`: the short line shows on
the card, and the text inside its `<template>` shows in the pop-up.
