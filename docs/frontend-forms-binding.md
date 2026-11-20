# Frontend binding — Forms foundation (Wave)

Base: `NEXT_PUBLIC_API_URL` + `/api/v1`  
Auth: `credentials: "include"` + tenant cookie (`novex_tenant` / switch).

---

## 1) أمر بيع — Sales Order

| Action | Method | Path | Permission |
|--------|--------|------|------------|
| Create | `POST` | `/tenant/sales/orders` | `sales:create` \| `sales:manage` |
| Update draft | `PATCH` | `/tenant/sales/orders/:id` | `sales:update` \| `sales:manage` |
| Cancel | `POST` | `/tenant/sales/orders/:id/cancel` | same |
| Get | `GET` | `/tenant/sales/orders/:id` | `sales:view` \| `sales:read` |
| Confirm / Reserve / Deliver | `POST` | `.../confirm` `.../reserve` `.../deliver` | manage |

**Create / PATCH body**
```json
{
  "customerId": "uuid",
  "quotationId": null,
  "priceListId": null,
  "notes": "",
  "promisedDeliveryAt": "2026-11-18T00:00:00.000Z",
  "lines": [
    {
      "productId": "uuid",
      "quantity": 1,
      "unitPrice": 100,
      "discountPercent": 0,
      "discountAmount": 0,
      "taxPercent": 14,
      "notes": ""
    }
  ]
}
```

**Cancel body:** `{ "reason": "نص السبب" }`

**UI rules**
- Edit فقط و`status === "DRAFT"` — غير كده الباك يرجع `400`.
- Cancel ممنوع بعد أي تسليم؛ لو `RESERVED` الباك يفك الحجز تلقائيًا.
- Response shape: `{ success, data: { item } }` — نفس `GET` (customer + lines + totals + status).

---

## 2) منتج — Product (موجود)

| Action | Method | Path |
|--------|--------|------|
| Create | `POST` | `/tenant/master-data/products` |
| Update | `PATCH` | `/tenant/master-data/products/:id` |
| Archive | `POST` | `/tenant/master-data/products/:id/archive` |
| Stock list | `GET` | `/tenant/inventory/stock` |
| Stock one | `GET` | `/tenant/inventory/stock/:productId` |
| Barcode | `GET` | `/tenant/inventory/barcode/:barcode` |

**Create required:** `name`, `sku`, `unitId`  
**Optional:** `nameAr`, `categoryId`, `brandId`, `purchasePrice`, `sellingPrice`, `minStock`, `reorderLevel`, `barcodes: [{ barcode, isPrimary }]`

بعد الإنشاء: المنتج يظهر في `/stock` برصيد `0` في المخزن الوحيد، والباركود الأساسي يشتغل من `/barcode/:barcode`.

---

## 3) موظف — Employee (موجود)

| Action | Method | Path | Notes |
|--------|--------|------|-------|
| Create | `POST` | `/tenant/hr/employees` | `firstName`, `lastName` + optional `compensation` |
| Update | `PATCH` | `/tenant/hr/employees/:id` | **لا يمس الراتب** |
| Salary | `PUT` | `/tenant/hr/employees/:id/compensation` | `hr:salary` |
| List | `GET` | `/tenant/hr/employees` | يظهر بـ `employeeNumber` |

---

## 4) قيد يومية — Journal (موجود + تحصين)

| Action | Method | Path |
|--------|--------|------|
| Create | `POST` | `/tenant/accounting/journals` |
| Update draft | `PATCH` | `/tenant/accounting/journals/:id` |
| Post | `POST` | `/tenant/accounting/journals/:id/post` |
| Reverse | `POST` | `/tenant/accounting/journals/:id/reverse` |

**Body:** `entryDate`, `description`, `lines[{ accountId, debit, credit, memo }]` — سطرين+ ومتوازن.

**UI**
- Unbalanced → `400` وفي الرسالة `difference N`.
- تعديل قيد `POSTED` → `400` بدون تغيير.
- Reverse يعمل قيد عكسي جديد ويخلّي الأصلي `REVERSED` (مش حذف).

---

## 5) مستند — Upload ثم Document

1. `POST /uploads/file` — multipart field `file` (+ optional `organizationId`)  
   → `data.asset.{ publicId, secureUrl, bytes, ... }`
2. `POST /tenant/workflow/documents`
```json
{
  "title": "عقد",
  "categoryId": null,
  "visibility": "TENANT",
  "expiresAt": null,
  "tagIds": [],
  "file": {
    "publicId": "من الرفع",
    "secureUrl": "https://res.cloudinary.com/...",
    "fileName": "contract.pdf",
    "bytes": 12000
  }
}
```
3. Download: `GET /tenant/workflow/documents/:id/download`  
4. Version: `POST /tenant/workflow/documents/:id/versions` بنفس `file`.

**Rules:** `publicId` لازم يكون تحت فولدر نفس التينانت؛ لو تسجيل المستند فشل بعد رفع ناجح، الباك يحاول يمسح الملف من Cloudinary.

---

## 6) شاشة المستخدمين — Tenant Users

صلاحية: `users:manage` (أو Owner/Administrator).

| Action | Method | Path |
|--------|--------|------|
| List | `GET` | `/tenant/users?search=&status=ACTIVE\|SUSPENDED&page=&pageSize=` (max 100) |
| Create | `POST` | `/tenant/users` |
| Sessions | `GET` | `/tenant/users/:userId/sessions` |
| Revoke session | `DELETE` | `/tenant/users/:userId/sessions/:sessionId` |
| Auth events | `GET` | `/tenant/auth-events?type=LOGIN_FAILED&from=&to=&page=` |
| Reset token | `POST` | `/tenant/users/password-reset` `{ userId }` |
| Active | `PATCH` | `/tenant/users/:userId/active` |
| Membership | `PATCH` | `/tenant/users/:userId/membership-status` |

**List item**
```json
{
  "id": "uuid",
  "name": "",
  "email": "",
  "isActive": true,
  "membershipStatus": "ACTIVE",
  "roles": [{ "id": "uuid", "name": "Accountant" }],
  "lastLoginAt": null,
  "failedLoginCount": 0,
  "lockedUntil": null
}
```

**Create body**
```json
{
  "name": "اسم",
  "email": "user@company.com",
  "password": "اختياري",
  "roleIds": ["uuid"],
  "membershipStatus": "ACTIVE"
}
```

- إيميل فريد عالميًا؛ لو موجود في منظمة تانية → ربط عضوية فقط (من غير مستخدم جديد).
- الباسورد **ما يترجعش**. لو مش مبعوت → `resetToken` + `resetTokenExpiresAt` (نفس مسار password-reset).
- `isActive: false` أو عضوية مش `ACTIVE` → ممنوع تسجيل الدخول لهذه العضوية / الحساب.

**Create response `201`:** `{ item, createdUser, resetToken, resetTokenExpiresAt, delivery }`

**Sessions:** `{ id, createdAt, expiresAt, ipAddress, userAgent }`  
إلغاء جلسة المدير الحالية لنفسه يحتاج `allowCurrent=true` (query أو body).

**Auth events:** أعضاء المنظمة فقط؛ محاولة فاشلة بإيميل عضو (حتى لو `userId` فاضي) تظهر؛ إيميل برّا المنظمة ما يظهرش.

Lookups: `GET /tenant/rbac/roles`

---

## 7) الباركود — Inventory barcode ops

| Action | Method | Path | Notes |
|--------|--------|------|-------|
| Lookup | `GET` | `/tenant/inventory/barcode/:barcode` أو `?barcode=` | موجود → منتج+رصيد؛ لأ → 404 |
| Generate | `POST` | `/tenant/inventory/barcode/generate` | JSON |
| Labels PDF | `POST` | `/tenant/inventory/barcode/labels` | **PDF** (`application/pdf`) مش JSON |
| Log scan | `POST` | `/tenant/inventory/barcode/scans` | بعد كل بحث من الشاشة |
| Scan history | `GET` | `/tenant/inventory/barcode/scans?from=&to=&barcode=&result=&page=` | تينانت فقط |

**Generate body**
```json
{ "productId": "uuid", "symbology": "CODE128", "copies": 1, "forceNew": false }
```
رد: `{ barcode, productId, symbology }`  
لو فيه باركود أساسي → يعيده؛ `forceNew: true` يولّد كود إضافي.

**Labels body** → حمّل الملف مباشرة (`blob`)
```json
{
  "items": [{ "productId": "uuid", "barcode": "123", "copies": 2 }],
  "layout": { "columns": 2, "widthMm": 50, "heightMm": 30 }
}
```
كل نسخة = صفحة. باركود مش تابع للمنتج → `400` مع رقم السطر.

**Scan log**
```json
{ "barcode": "123", "source": "MANUAL", "result": "FOUND", "productId": "uuid أو null" }
```
`source`: `MANUAL` | `CAMERA` — `result`: `FOUND` | `NOT_FOUND`  
البحث يفضل على `GET`؛ الـ POST بيسجّل حتى لو النتيجة NOT_FOUND.

---

## 7c) العمليات — مهام / مشاريع / أصول / صيانة

Base: `/api/v1/tenant/operations`  
صلاحيات: `operations:read` | `operations:manage` — الصيانة تقبل أيضًا `maintenance:view` | `maintenance:manage`.

| Area | Endpoints |
|------|-----------|
| Tasks | `GET/POST /tasks`, `GET/PATCH /tasks/:id`, `PUT /tasks/:id/assignees`, `POST /tasks/:id/comments` |
| Projects | `GET/POST /projects`, `GET/PATCH /projects/:id`, `POST .../members`, `POST .../milestones`, `GET .../report` |
| Assets | `GET/POST /asset-categories`, `GET/POST /assets`, `GET/PATCH /assets/:id`, `POST .../documents` |
| Maintenance | `GET/POST /maintenance`, `PATCH .../status`, `GET/POST /maintenance-schedules`, `POST .../complete` |

فلاتر المهام: `?status=&projectId=&employeeId=&overdue=true`  
تقرير المشروع يشمل `budget` + `tasks.byStatus` + progress.  
`complete` على جدول الصيانة يقدّم `nextDueAt` بـ `intervalDays`. أصل من تينانت تاني أو `DISPOSED` → `404`.

---

## 7b) رسم المبيعات الشهرية

`GET /tenant/reports/sales/by-period?from=&to=&bucket=month`

- بدون `bucket`: الرد القديم (إجمالي + compare) لكروت الشاشة.
- مع `bucket=day|week|month`: نفس الإجماليات + `points[]` (أصفار للفجوات، مرتّبة) + سلسلة مستقلة `returns[]` (مش مطروحة من الرسم).
- حدود: 366 يوم / 53 أسبوع / 36 شهر — أوسع → `400`.

كل نقطة: `period`, `label`, `totalSales`, `invoiceSales`, `posSales`, `invoiceCount`, `posCount`.

---

## 8) تصدير التقارير + الجدولة

### تصدير فوري
كل `GET /tenant/reports/...` يدعم `?format=json|csv|xlsx|pdf` مع نفس الفلاتر (`from`/`to`/…).

| Format | صلاحية | ملاحظات |
|--------|--------|---------|
| `json` | قراءة التقارير | الافتراضي |
| `csv` / `xlsx` / `pdf` | `reports:export` | كل الصفوف؛ PDF بخط عربي + ترقيم صفحات؛ اسم الملف في `Content-Disposition` (UTF-8) |

من غير صلاحية التصدير → `403` على غير JSON.

### جدولة الإرسال (إشعار داخلي — مفيش إيميل في الباك)

| Action | Method | Path |
|--------|--------|------|
| Create | `POST` | `/tenant/reports/schedules` |
| List | `GET` | `/tenant/reports/schedules` |
| Update | `PATCH` | `/tenant/reports/schedules/:id` |
| Delete | `DELETE` | `/tenant/reports/schedules/:id` |
| Run now | `POST` | `/tenant/reports/schedules/:id/run` → `{ runId, run, downloadPath }` |
| Download | `GET` | `/tenant/reports/schedules/runs/:runId/download` |

**Create body**
```json
{
  "name": "مبيعات الشهر",
  "reportPath": "/tenant/reports/sales/by-product",
  "format": "xlsx",
  "frequency": "MONTHLY",
  "hour": 8,
  "dayOfMonth": 1,
  "dayOfWeek": null,
  "range": "PREVIOUS_MONTH",
  "recipientUserIds": ["uuid"]
}
```
`reportPath` من كتالوج ثابت فقط. التشغيل يولّد الملف ويحفظه ويرسل إشعار `REPORT_READY` للمستلمين فيه رابط التحميل.  
سجل التشغيل: `id, scheduleId, startedAt, finishedAt, status, fileId, error`.

---

## 9) الفروع — Branches

Base: `/tenant/branches`  
صلاحيات: `branches:read` للقائمة، `branches:manage` للإضافة/التعديل. المالك عنده الاتنين.

| Action | Method | Path |
|--------|--------|------|
| List | `GET` | `/tenant/branches` |
| Create | `POST` | `/tenant/branches` |
| Deactivate / update | `PATCH` | `/tenant/branches/:id` |

**GET response** (`data`):
```json
{
  "items": [
    {
      "id": "uuid",
      "name": "فرع القاهرة",
      "code": "CAI",
      "type": "OFFICE",
      "city": "Cairo",
      "phone": null,
      "address": null,
      "isActive": true,
      "employeeCount": 4
    }
  ],
  "limit": 5,
  "used": 1
}
```
- `limit` = `TenantSystemConfig.maxActiveBranches` (افتراضي 5؛ قابل للتعديل عبر `PATCH /tenant/company/system-config`).
- `used` = عدد الفروع النشطة فقط (HQ يتحسب). اقفل زر الإضافة لما `used >= limit`.
- عند الحد: `POST` → `403` برسالة `Branch limit reached`.

**POST body**
```json
{
  "name": "فرع الإسكندرية",
  "code": "ALX",
  "type": "OFFICE",
  "city": "Alexandria",
  "phone": null,
  "address": null
}
```
`type`: `HEADQUARTERS` | `OFFICE` | `RETAIL_STORE` | `FACTORY` | `WAREHOUSE`. الكود فريد داخل الشركة.

**PATCH body** (أي حقل اختياري): `{ "isActive": false }` لإيقاف الفرع (يخرج من `used`). يمكن أيضًا `name` / `city` / `phone` / `address` / `type`.

**موظف:** `POST/PATCH /tenant/hr/employees` يقبل `branchId` ويرجع `branch: { id, name, code }`.  
**مستخدم:** `POST /tenant/users` يمرّر `branchId` على `MemberRole` (مش null).

---

## 10) حضور / انصراف — Self + HR

ساعات العمل من سجل الحضور: `checkInAt` / `checkOutAt` / `workedMinutes` (الراحة تُخصم لو فيه وردية). مفيش جدول جديد.

### الموظف لنفسه (أي مستخدم داخل مربوط بموظف)
| Action | Method | Path |
|--------|--------|------|
| حالة اليوم | `GET` | `/tenant/hr/attendance/me` |
| حضور | `POST` | `/tenant/hr/attendance/me/check-in` |
| انصراف | `POST` | `/tenant/hr/attendance/me/check-out` |

يلاقي الموظف من `userId` للحساب. لو مش مربوط → `404` + `No employee profile is linked to this account`.  
الرد: السجل فيه الأوقات و`workedMinutes`. حضور مكرر لنفس اليوم → `409`.  
**يوم العمل** = توقيت الشركة (`Africa/Cairo` افتراضيًا)، مش UTC. `GET .../me` يرجع أيضًا `workDate` و`timezone`.

### الموارد البشرية (عن موظف)
صلاحية: `hr:attendance` | `hr:manage` | `hr:update`

| Action | Method | Path |
|--------|--------|------|
| حضور | `POST` | `/tenant/hr/attendance/check-in` |
| انصراف | `POST` | `/tenant/hr/attendance/check-out` |

```json
{ "employeeId": "uuid", "at": "2026-11-19T17:30:00.000Z", "source": "MANUAL" }
```
- `at` اختياري؛ فاضي = وقت الضغط.
- لو الحضور متسجل وHR ضغطت حضور تاني → `409`؛ المطلوب انصراف فقط.

---

## Lookups سريعة للنماذج

| Form | Lookups |
|------|---------|
| Sales order | customers, products, price-lists |
| Product | units, categories, brands |
| Employee | departments, job-titles, **`GET /tenant/branches`** |
| Journal | `GET /tenant/accounting/accounts` |
| Document | categories/tags under `/tenant/workflow/...` |
| User | `GET /tenant/rbac/roles`, **`GET /tenant/branches`**, departments |
| Branches | — |
