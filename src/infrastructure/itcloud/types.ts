// Formes brutes des réponses de l'API partenaire ITCloud (doc v1.4.0).
// Ces types reflètent le JSON tel que reçu ; les mappers les traduisent
// ensuite en entités du domaine.

export type ItcloudRepresentative = {
  id: number;
  firstName: string;
  lastName: string;
};

// GET /api/partner/services-report → { items: ItcloudServiceItem[] }
export type ItcloudServiceItem = {
  clientId: number;
  clientCode: string;
  clientOwner: string;
  clientCompany: string;
  clientEmail: string;
  clientPhoneNumber: string;
  externalClientId: string;
  externalServiceId: string;
  productGroup: string;
  product: string;
  serviceId: number; // identifiant STABLE du service → rapprochement (externalId)
  username: string;
  status: string; // Active, Suspended, Cancelled…
  paymentMethod: string; // CreditCard, BankPayment, DirectDebit, MailIn…
  billingMode: string; // Indirect, Direct
  billingCycle: string; // Monthly, Annually
  registrationDate: string; // YYYY-MM-DD
  nextInvoiceDate: string; // YYYY-MM-DD ("0000-00-00" possible)
  quantity: number;
  amount: number;
  commitmentEndDate: string;
  promoCode?: string;
  promoType?: string;
  promoValue?: string;
  representative: ItcloudRepresentative | null;
};

// GET /api/partner/invoice-items-report?from&to → { items: ItcloudInvoiceItem[] }
export type ItcloudInvoiceItem = {
  invoiceId: number;
  invoiceDate: string;
  invoiceStatus: string; // Paid, Unpaid…
  clientId: number;
  clientCode: string;
  owner: string;
  companyName: string;
  email: string;
  productGroup: string | null;
  productId: number;
  productName: string | null;
  serviceId: number;
  invoiceItemId: number;
  type: string; // Usage, Recurring…
  description: string;
  skuNumber: string;
  unitMsrp: number;
  quantity: number;
  msrp: number;
  mspDiscountPercent: number; // remise partenaire → coût réel
  preTaxAmount: number; // montant payé par le partenaire (coût)
  dueDate: string;
  nextDueDate: string;
  billingCycle: string;
};

// GET /api/partner/azure-consumption-report?from&to → { items: ItcloudAzureItem[] }
export type ItcloudAzureItem = {
  invoiceId: number;
  invoiceDate: string;
  clientId: number;
  clientCode: string;
  owner: string;
  companyName: string;
  email: string;
  subscriptionId: string;
  resourceName: string;
  category: string;
  subcategory: string;
  name: string;
  unit: string;
  rate: number;
  billed: number;
  amount: number;
};

export type ItcloudReport<T> = { items: T[] };
