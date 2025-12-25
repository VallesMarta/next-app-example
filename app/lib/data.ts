// import postgres from "postgres";
import { sql } from "@vercel/postgres";
import {
  CustomerField,
  CustomersTableType,
  InvoiceForm,
  InvoicesTable,
  LatestInvoiceRaw,
  Revenue,
} from "./definitions";
import { formatCurrency } from "./utils";

// const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require" });
export async function fetchRevenue() {
  try {
    console.log("Fetching revenue data...");
    await new Promise((resolve) => setTimeout(resolve, 3000)); // opcional

    const data = await sql<Revenue[]>`SELECT * FROM revenue`;
    console.log("Data fetch completed.");

    return data.rows; // <--- muy importante
  } catch (error) {
    console.error("Database Error:", error);
    return [];
  }
}

export async function fetchLatestInvoices() {
  try {
    // Trae las 5 últimas facturas con información del cliente
    const data = await sql<LatestInvoiceRaw[]>`
      SELECT 
        invoices.id,
        invoices.amount,
        invoices.date,
        invoices.status,
        customers.name,
        customers.email,
        customers.image_url AS image_url
      FROM invoices
      JOIN customers ON invoices.customer_id = customers.id
      ORDER BY invoices.date DESC
      LIMIT 5;
    `;

    // Devuelve un array limpio y formatea el amount
    return data.rows.map((invoice: any) => ({
      ...invoice,
      amount: formatCurrency(Number(invoice.amount)),
      date: invoice.date,
    }));
  } catch (error) {
    console.error("Database Error in fetchLatestInvoices:", error);
    return [];
  }
}

export async function fetchCardData() {
  try {
    const invoiceCountPromise = sql<{
      count: number;
    }>`SELECT COUNT(*) AS count FROM invoices`;
    const customerCountPromise = sql<{
      count: number;
    }>`SELECT COUNT(*) AS count FROM customers`;
    const invoiceStatusPromise = sql<{ paid: number; pending: number }>`
      SELECT
        SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) AS "paid",
        SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END) AS "pending"
      FROM invoices
    `;

    const [invoiceData, customerData, statusData] = await Promise.all([
      invoiceCountPromise,
      customerCountPromise,
      invoiceStatusPromise,
    ]);

    const numberOfInvoices = Number(invoiceData.rows[0]?.count ?? 0);
    const numberOfCustomers = Number(customerData.rows[0]?.count ?? 0);
    const totalPaidInvoices = formatCurrency(statusData.rows[0]?.paid ?? 0);
    const totalPendingInvoices = formatCurrency(
      statusData.rows[0]?.pending ?? 0
    );

    return {
      numberOfInvoices,
      numberOfCustomers,
      totalPaidInvoices,
      totalPendingInvoices,
    };
  } catch (error) {
    console.error("Database Error:", error);
    return {
      numberOfInvoices: 0,
      numberOfCustomers: 0,
      totalPaidInvoices: formatCurrency(0),
      totalPendingInvoices: formatCurrency(0),
    };
  }
}

const ITEMS_PER_PAGE = 6;
export async function fetchFilteredInvoices(
  query: string,
  currentPage: number
) {
  const offset = (currentPage - 1) * ITEMS_PER_PAGE;

  try {
    const invoices = await sql<InvoicesTable[]>`
      SELECT
        invoices.id,
        invoices.amount,
        invoices.date,
        invoices.status,
        customers.name,
        customers.email,
        customers.image_url
      FROM invoices
      JOIN customers ON invoices.customer_id = customers.id
      WHERE
        customers.name ILIKE ${`%${query}%`} OR
        customers.email ILIKE ${`%${query}%`} OR
        invoices.amount::text ILIKE ${`%${query}%`} OR
        invoices.date::text ILIKE ${`%${query}%`} OR
        invoices.status ILIKE ${`%${query}%`}
      ORDER BY invoices.date DESC
      LIMIT ${ITEMS_PER_PAGE} OFFSET ${offset}
    `;

    return invoices.rows;
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch invoices.");
  }
}

export async function fetchInvoicesPages(query: string) {
  try {
    const data = await sql`SELECT COUNT(*)
    FROM invoices
    JOIN customers ON invoices.customer_id = customers.id
    WHERE
      customers.name ILIKE ${`%${query}%`} OR
      customers.email ILIKE ${`%${query}%`} OR
      invoices.amount::text ILIKE ${`%${query}%`} OR
      invoices.date::text ILIKE ${`%${query}%`} OR
      invoices.status ILIKE ${`%${query}%`}
  `;

    const totalPages = Math.ceil(
      Number(data.rows[0]?.count ?? 0) / ITEMS_PER_PAGE
    );
    return totalPages;
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch total number of invoices.");
  }
}

export async function fetchInvoiceById(id: string) {
  try {
    const data = await sql<InvoiceForm[]>`
      SELECT invoices.id, invoices.customer_id, invoices.amount, invoices.status
      FROM invoices
      WHERE invoices.id = ${id};
    `;

    const invoice = data.rows.map((invoice: any) => ({
      ...invoice,
      amount: invoice.amount / 100, // si quieres normalizar
    }));

    return invoice[0] ?? null;
  } catch (error) {
    console.error("Database Error:", error);
    return null;
  }
}

export async function fetchCustomers() {
  try {
    const data = await sql<CustomerField[]>`
      SELECT id, name FROM customers ORDER BY name ASC
    `;
    return data.rows;
  } catch (error) {
    console.error("Database Error:", error);
    return [];
  }
}

export async function fetchFilteredCustomers(query: string) {
  try {
    const data = await sql<CustomersTableType[]>`
      SELECT
        customers.id,
        customers.name,
        customers.email,
        customers.image_url AS image_url,
        COUNT(invoices.id)::int AS total_invoices,
        COALESCE(SUM(CASE WHEN invoices.status = 'pending' THEN invoices.amount ELSE 0 END), 0)::int AS total_pending,
        COALESCE(SUM(CASE WHEN invoices.status = 'paid' THEN invoices.amount ELSE 0 END), 0)::int AS total_paid
      FROM customers
      LEFT JOIN invoices ON customers.id = invoices.customer_id
      WHERE
        customers.name ILIKE ${`%${query}%`} OR
        customers.email ILIKE ${`%${query}%`}
      GROUP BY
        customers.id,
        customers.name,
        customers.email,
        customers.image_url
      ORDER BY customers.name ASC
    `;

    // Devuelve un array limpio y formatea los importes
    return data.rows.map((customer: any) => ({
      ...customer,
      total_pending: formatCurrency(customer.total_pending),
      total_paid: formatCurrency(customer.total_paid),
    }));
  } catch (error) {
    console.error("Database Error:", error);
    return [];
  }
}
