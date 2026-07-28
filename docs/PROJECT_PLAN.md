# Diamond Box Wala — Software Plan (v1)

> Jewellery box / stand / products ke liye **Inventory + Ledger** software.
> Yeh document client ke saath baith kar **approve** karne ke liye hai. Har point pe ✅ / ✏️ (change) mark kar sakte ho.

---

## 1. Business kya hai (short)

```
VENDOR → raw material (kapda/board/foam...) khareedna
      → RAW MATERIAL STOCK (godown)
      → THEKEDAAR/KARIGAR ko material issue (Job banega)
      → ready maal wapas → FINISHED GOODS STOCK
      → SALE (retail + wholesale)
```
Saath mein: **Vendor ka paisa**, **Karigar ka paisa** aur **stock** — sab ek jagah, roz ke reports ke saath.

**Focus:** Inventory + Ledgers (sale usme se ek hissa).

---

## 2. Software kaun chalayega (Users & Roles)

| Role | Kya kar sakta hai |
|---|---|
| **Owner** | Sab kuch — entries, reports, rates, delete, settings |
| **Staff** | Roz ki entry (purchase, job, sale) + basic stock dekhna. Rates/ledger/delete owner ke paas |

> ✏️ *Confirm karein: staff ko kaunse reports dikhne chahiye / nahi?*

---

## 3. Modules (screens ki list)

1. **Masters** — Vendors, Karigars, Customers, Raw Materials, Products
2. **Purchase** — vendor se raw material
3. **Karigar Jobs** — material issue → maal receipt → payment
4. **Sale** — retail / wholesale
5. **Payments** — vendor / karigar / customer
6. **Reports & Dashboard**

---

## 4. Screens & Fields (detail)

### 4.1 Masters

> **Har Master list mein:** upar **text search box** + **filter** + column **sort** — taaki list badhne pe bhi turant koi bhi record mil jaaye.
> Vendors: naam/phone/city · Karigars: naam/phone + product type · Customers: mobile/naam + type · Raw Materials: item naam + category/color/unit · Products: naam + category/variant.

**A) Vendor (raw material supplier)**

| Field | Note |
|---|---|
| Naam | required |
| Phone | |
| Address / City | |
| GST No. | optional |
| Opening balance | pehle se koi paisa baaki ho to |
| Notes | |

Actions: Add/Edit • **Ledger dekho** • **History dekho** (kya-kya khareeda)

**B) Karigar / Thekedaar**

| Field | Note |
|---|---|
| Naam | required |
| Phone | |
| Kaunse product banata hai | tag: box / stand / etc. (dynamic) |
| Opening balance | |
| Notes | |

Actions: Add/Edit • **Ledger** • **Jobs history** (kitna material gaya, kitna maal aaya)

**C) Customer — pehle se NAHI banega (auto)**

> Alag "Customer Master" entry screen nahi. Customer **sale ke waqt apne aap** ban jaata hai; **mobile number uski chaabi** (unique) hai.

- Sale screen pe mobile daalo → pehle aaya hai to **naam auto** aa jaayega; naya hai to bas naam (optional) type karo → record background mein ban jaata hai
- Fields (auto-stored): Mobile, Naam, Type (Retail/Wholesale), Udhaar allowed? (regular ke liye), balance

Ek **"Customers" list sirf dekhne** ke liye (repeat/regular customer + history) — banane ke liye nahi.

**D) Raw Material (Item) — DYNAMIC**

> Koi bhi naya material + unit + color owner khud add kar sake. Kuch bhi pehle se fix nahi.

| Field | Note |
|---|---|
| Item naam | e.g. Kapda, Board, Foam |
| Category | add-your-own (dynamic list) |
| Units | ek ya zyada: **meter / roll / kilo** (jis vendor se jaise aata hai) |
| Colors / Variants | jitne color chahiye add karo |
| Low-stock alert qty | optional (itna kam ho to warning) |

> **Stock inn teen se milkar track hoga:** Item + Color + Unit
> (jaise "Velvet — Red — meter" ka apna stock)

**E) Product (Finished Goods)**

| Field | Note |
|---|---|
| Product naam | e.g. Ring Box, Necklace Stand |
| Category | Box / Stand / etc. (dynamic) |
| Variants | Size / Design (jitne chahiye) |
| Low-stock alert qty | optional |

---

### 4.2 Purchase (Vendor se raw material)

**Ek purchase entry:**
- Vendor, Date, Bill No. (optional)
- **Items table:** har row → Item + Color + Unit + Qty + Rate + Amount
- Total amount
- **Payment abhi:** advance diya (optional) → baaki balance

**Effect:**
- Raw material **stock badhta hai**
- **Vendor ledger:** amount = dena, payment = kam

---

### 4.3 Karigar Jobs (dil of the software)

**Step 1 — Job banao (material issue):**
- Job No. (auto), Karigar/Thekedaar, Date
- Kya banwana hai (expected product) — optional
- **Material issued table:** Item + Color + Unit + Qty

**Step 2 — Maal receipt (thoda-thoda bhi chalega):**
- Date, **Finished product + variant + Qty** received
- (optional) bacha hua material wapas aaya to note

**Step 3 — Payment:**
- Poore order ka thekedaar ko payment (labour)

**Effect:**
- Raw stock **kam** (issued), Finished stock **badhta hai** (received)
- **Karigar ledger** update
- **"Kitna diya vs kitna aaya"** apne aap — "itne kapde mein itne box bane" ka rough record

---

### 4.4 Sale (retail + wholesale)

**Ek sale entry:**
- **Mobile number** daalo → customer auto-find / auto-create (walk-in ke liye mobile optional)
- Date, Type: Retail / Wholesale
- **Items table:** Product + Variant + Qty + **Price (har item ke saamne, us waqt haath se)** → Amount
- Total, Payment: **Cash** (default) ya **Udhaar** (sirf regular customer)

**Effect:**
- Finished stock **kam**
- Udhaar hua to customer ledger

---

### 4.5 Payments

- **Vendor ko** — advance / final settlement
- **Karigar ko** — order payment
- **Customer se** — udhaar wapas aaya to receipt

---

## 5. Reports (sabse important — aapki priority list)

| # | Report | Kya dikhega | Filter |
|---|---|---|---|
| i | **Daily Stock** | Finished goods product-wise qty + raw material qty | date |
| ii | **Raw Material Bacha** | Kitna bacha + **kis vendor se aaya tha** | item / vendor |
| iii | **Karigar Material** | Kis karigar ko kitna, kaunsa material, **kab** diya; pending kitna | karigar / date |
| iv | **History** | Kisi bhi vendor / karigar ka poora record | — |
| v | **Ledger** | Vendor & Karigar ka ledger (opening → transactions → balance) | date range |

**Dashboard (home screen):** aaj ki sale, total stock, kis-kis ka paisa baaki (dues), **low-stock alerts**.

> Aage: har report ko **PDF / Excel** mein download karne ka option.

---

## 6. Data Model (technical — high level)

Tables: `vendors`, `karigars`, `customers`, `items` (+ `item_variants`, `item_units`), `products` (+ `product_variants`), `purchases` (+ `purchase_items`), `jobs` (+ `job_issues`, `job_receipts`), `sales` (+ `sale_items`), `payments`, `stock_ledger` (raw + finished movements), `users`.

Har stock number aur ledger **transactions se auto-calculate** hoga (manual nahi) — isse hisaab hamesha sahi rahega.

---

## 7. Banane ka plan (Phases)

| Phase | Kya milega |
|---|---|
| **Phase 1 — Foundation** | Setup, Login, Masters, Purchase + Raw stock, Vendor ledger |
| **Phase 2 — Karigar** | Job system (issue → receipt), Finished stock, Karigar ledger, diya-vs-aaya |
| **Phase 3 — Sale + Reports** | Sale/Customer, Dashboard aur saare reports |

---

## 8. Tech Stack (locked)

- **Frontend:** Next.js + Tailwind + shadcn/ui (computer + mobile responsive)
- **Backend:** Express (Node.js) REST API
- **Database:** PostgreSQL — raw SQL (`pg`), parameterized queries + repository layer + SQL migrations
- **Auth:** JWT, Owner/Staff roles
- **Aage:** Mail / WhatsApp / Payment / reminders — alag backend module

**Colour theme — Royal Indigo & Gold** (light / dark):
- Primary Indigo `#2E3577` / `#7C86D6` · Accent Gold `#C6A24C` / `#D4B15E`
- Background `#F3F4F8` / `#14151F` · Surface `#FFFFFF` / `#1E2030` · Text `#1E2033` / `#ECEDF5`
- Status — Green `#2E7D5B` · Amber `#C9871F` · Red `#C0442E` (stock/paisa ke liye)
- Gold sirf halke accents (tab/tag/highlight) mein — bade button nahi.

---

## 9. Confirm karne wale points (client se)

1. Staff ko kaunse reports dikhein?
2. Product ki bikri **piece** mein hoti hai ya **set/dozen** mein bhi?
3. Ek job mein **ek hi product** banta hai ya **multiple** ek saath?
4. Raw material ka **rate/valuation** stock report mein chahiye (paise mein value), ya sirf **quantity**?
5. GST / bill number ki zaroorat hai ya sirf internal record?
6. Kitne **users** (owner + kitne staff)?

> In sab pe ✅/✏️ mil jaaye to hum Phase 1 coding shuru kar denge.
