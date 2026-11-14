/** Tipe data inti Ruang Dana. Runtime aplikasi saat ini tetap menggunakan JavaScript ES Modules. */
export type TransactionType = "income" | "expense";
export type FinanceCategory = "investasi" | "tabungan" | "darurat" | "bebas";
export interface FinanceTransaction {
  id: string;
  type: TransactionType;
  category: FinanceCategory;
  amount: number;
  date: string;
  note: string;
  walletId?: string;
}
export interface MonthlyFinance {
  income: number;
  allocations: Record<FinanceCategory, number>;
  transactions: FinanceTransaction[];
}
export interface Wallet {
  id: string;
  name: string;
  type: string;
  balance: number;
}
export interface SavingsGoal {
  id: string;
  name: string;
  target: number;
  current: number;
  date: string;
}
export interface DebtRecord {
  id: string;
  type: "payable" | "receivable";
  name: string;
  amount: number;
  due: string;
  paid: boolean;
}
